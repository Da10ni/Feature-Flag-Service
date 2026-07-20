import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const apiKey = req.headers?.['x-api-key'] as string | undefined;
    const ip = req.ip as string;
    return Promise.resolve(apiKey ? `key:${apiKey}` : `ip:${ip}`);
  }
}
