import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const route = req.route?.path
        ? `${req.baseUrl ?? ''}${req.route.path}`
        : 'unknown';

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
