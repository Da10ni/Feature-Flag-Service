import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { apiKeyLookup } from '../../tenants/tenants.service';
import * as bcrypt from 'bcryptjs';

// bcrypt at cost 12 takes ~300ms per verify. Paying that on every request would make it
// the dominant cost of a flag evaluation — far larger than the DB read and cache lookup
// combined — and would blow the p95 latency budget the evaluation endpoint is measured on.
//
// So verified keys are memoised briefly. The expensive bcrypt compare still runs on every
// cache miss; the cache only skips repeat work for a key already proven valid. Keyed by the
// SHA-256 lookup digest, never the raw key.
//
// ponytail: per-instance Map, so a revoked key stays usable on an already-warm instance for
// up to TTL. That is the deliberate trade — 60s of staleness for ~300ms off every request.
// Move to a shared Redis entry with explicit invalidation if revocation needs to be instant.
const AUTH_CACHE_TTL_MS = 60_000;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly verified = new Map<
    string,
    { tenant: Tenant; expiresAt: number }
  >();

  // In-flight verifications, so N concurrent requests bearing the same uncached key run
  // ONE bcrypt between them instead of N.
  //
  // Without this the cache only helps once it is warm, and the moment it is cold — cold
  // start, a TTL expiry, a traffic spike — every concurrent request independently starts a
  // ~300ms bcrypt. bcryptjs is pure JavaScript, so those run ON the event loop rather than
  // in the threadpool: 200 concurrent verifications don't take 300ms, they queue head-to-tail
  // and stall every other request on the instance with them. That is a self-inflicted
  // thundering herd at exactly the moment traffic is highest.
  private readonly inFlight = new Map<string, Promise<Tenant | null>>();

  constructor(
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string;
    if (!apiKey) throw new UnauthorizedException('Missing API key');

    const lookup = apiKeyLookup(apiKey);
    const hit = this.verified.get(lookup);
    if (hit && hit.expiresAt > Date.now()) {
      request['tenant'] = hit.tenant;
      return true;
    }
    if (hit) this.verified.delete(lookup);

    let pending = this.inFlight.get(lookup);
    if (!pending) {
      pending = this.verifyKey(apiKey, lookup).finally(() =>
        this.inFlight.delete(lookup),
      );
      this.inFlight.set(lookup, pending);
    }

    const tenant = await pending;
    if (!tenant) throw new UnauthorizedException('Invalid API key');
    request['tenant'] = tenant;
    return true;
  }

  private async verifyKey(
    apiKey: string,
    lookup: string,
  ): Promise<Tenant | null> {
    // Indexed lookup narrows to a single tenant, then one bcrypt verify — O(1),
    // not a bcrypt.compare against every tenant in the table.
    // apiKeyHash is `select: false` on the entity, so it must be requested explicitly here.
    const tenant = await this.tenantRepo.findOne({
      where: { apiKeyLookup: lookup, isActive: true },
      select: { id: true, name: true, slug: true, apiKeyHash: true },
    });
    if (!tenant || !(await bcrypt.compare(apiKey, tenant.apiKeyHash))) {
      return null;
    }
    // Don't leave the hash on the request object where a controller could echo it back.
    delete (tenant as Partial<Tenant>).apiKeyHash;
    this.verified.set(lookup, {
      tenant,
      expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    });
    return tenant;
  }
}
