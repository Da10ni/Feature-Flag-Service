import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Records latency + final status for every request.
 *
 * Deliberately middleware rather than an interceptor. An interceptor cannot see:
 *   - guard rejections (401/403 from ApiKeyGuard) — guards run BEFORE interceptors, so
 *     every auth failure was previously invisible to metrics;
 *   - the real status code on a thrown error — the rxjs error path runs before the
 *     exception filter writes the status, so a request that ended 403 got recorded as 200.
 *
 * Hooking res 'finish' sidesteps both: it fires after the response is fully written, so the
 * status is whatever the client actually received. Without this, "error rate by tenant and
 * endpoint" is a metric that can only ever report success.
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      // Route pattern (/tenants/:tenantId/flags), not the raw URL — a per-tenant-id label
      // would make cardinality grow without bound. Unmatched paths collapse to 'unknown'.
      const route = req.route?.path
        ? `${req.baseUrl ?? ''}${req.route.path}`
        : 'unknown';
      // The guard has populated req.tenant by the time the response finishes.
      const tenant =
        (req as { tenant?: { id: string } }).tenant?.id ?? 'anonymous';
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.recordHttp(
        req.method,
        route,
        res.statusCode,
        tenant,
        seconds,
      );
    });

    next();
  }
}
