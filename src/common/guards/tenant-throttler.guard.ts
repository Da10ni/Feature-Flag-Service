import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Rate-limit per tenant so one noisy tenant can't starve others.
// Keys on the raw API key header (each key maps 1:1 to a tenant), falling back to IP
// for unauthenticated routes. Uses the header directly rather than req.tenant because
// this global guard runs before the per-controller ApiKeyGuard populates req.tenant.
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const apiKey = req.headers?.['x-api-key'] as string | undefined;
    const ip = req.ip as string;
    return Promise.resolve(apiKey ? `key:${apiKey}` : `ip:${ip}`);
  }
}
