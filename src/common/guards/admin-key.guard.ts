import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

// Guards tenant registration. Tenant creation mints an API key, so on a public Cloud Run
// URL an open endpoint lets anyone provision themselves credentials.
//
// Opt-in outside production: with ADMIN_API_KEY unset the guard is a no-op, so local dev,
// docker compose and CI need no extra config. Terraform sets the variable from Secret
// Manager in staging and production.
//
// In production an unset key is treated as a misconfiguration, not as "open": if the
// Secret Manager wiring ever breaks, failing open would silently turn credential minting
// into a public endpoint with the service still reporting healthy. Only this endpoint is
// refused — evaluation is the hot path clients depend on, so a bad admin key must not
// become a full outage.
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('ADMIN_API_KEY');
    if (!expected) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException(
          'Tenant registration is unavailable: ADMIN_API_KEY is not configured',
        );
      }
      return true;
    }

    const provided = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
    }>().headers['x-admin-key'];

    if (!provided || !safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid or missing admin key');
    }
    return true;
  }
}

// Constant-time compare so a wrong key can't be recovered byte-by-byte from timing.
// Length is compared first because timingSafeEqual throws on a length mismatch.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
