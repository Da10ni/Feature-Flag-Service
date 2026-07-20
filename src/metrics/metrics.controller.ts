import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';

@ApiTags('Operations')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  // Prometheus scrape target. Global prefix is api/v1, so this serves at /api/v1/metrics.
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  @ApiOperation({
    summary: 'Prometheus metrics scrape endpoint',
    description:
      'Exposes application metrics in Prometheus text format. In GCP the Managed Service for Prometheus sidecar scrapes this and forwards to Cloud Monitoring, which is what "custom metrics exported to Cloud Monitoring" means here — no per-request write API calls.\n\n' +
      'Exported series:\n' +
      '- `flag_evaluation_duration_seconds` — histogram, labelled by tenant and flag type. Yields p50/p95/p99.\n' +
      '- `flag_evaluations_total` — counter by tenant; `rate()` gives evaluations per second per tenant.\n' +
      '- `flag_evaluation_cache_total` — counter labelled `hit` / `miss` for the cache hit ratio.\n' +
      '- `http_request_duration_seconds` — histogram by method, route, status and tenant. Yields error rate per tenant and endpoint.\n' +
      '- Plus Node.js default process metrics.\n\n' +
      'The `route` label is the route pattern (`/tenants/:tenantId/flags`), never the raw URL, so cardinality does not grow with the number of tenants.\n\n' +
      'Requires no authentication.',
  })
  @ApiOkResponse({
    description: 'Metrics in Prometheus exposition format.',
    content: {
      'text/plain': {
        schema: { type: 'string' },
        example:
          '# HELP flag_evaluations_total Total flag evaluations\n' +
          '# TYPE flag_evaluations_total counter\n' +
          'flag_evaluations_total{tenant="a1b2c3d4-...",type="boolean"} 42\n',
      },
    },
  })
  async scrape(): Promise<string> {
    return this.metrics.render();
  }
}
