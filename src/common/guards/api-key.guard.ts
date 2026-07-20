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

const AUTH_CACHE_TTL_MS = 60_000;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly verified = new Map<
    string,
    { tenant: Tenant; expiresAt: number }
  >();

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
    const tenant = await this.tenantRepo.findOne({
      where: { apiKeyLookup: lookup, isActive: true },
      select: { id: true, name: true, slug: true, apiKeyHash: true },
    });
    if (!tenant || !(await bcrypt.compare(apiKey, tenant.apiKeyHash))) {
      return null;
    }

    delete (tenant as Partial<Tenant>).apiKeyHash;
    this.verified.set(lookup, {
      tenant,
      expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    });
    return tenant;
  }
}
