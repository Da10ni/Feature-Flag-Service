import { Injectable } from '@nestjs/common';
import {
  Registry,
  Histogram,
  Counter,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly evalLatency = new Histogram({
    name: 'flag_evaluation_duration_seconds',
    help: 'Flag evaluation latency in seconds',
    labelNames: ['tenant', 'type'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [this.registry],
  });

  private readonly evalCount = new Counter({
    name: 'flag_evaluations_total',
    help: 'Total flag evaluations',
    labelNames: ['tenant', 'type'],
    registers: [this.registry],
  });

  private readonly cacheAccess = new Counter({
    name: 'flag_evaluation_cache_total',
    help: 'Flag evaluation cache accesses',
    labelNames: ['result'],
    registers: [this.registry],
  });

  private readonly httpLatency = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['method', 'route', 'status', 'tenant'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  recordEvaluation(tenant: string, type: string, seconds: number): void {
    this.evalLatency.observe({ tenant, type }, seconds);
    this.evalCount.inc({ tenant, type });
  }

  recordCache(hit: boolean): void {
    this.cacheAccess.inc({ result: hit ? 'hit' : 'miss' });
  }

  recordHttp(
    method: string,
    route: string,
    status: number,
    tenant: string,
    seconds: number,
  ): void {
    this.httpLatency.observe(
      { method, route, status: String(status), tenant },
      seconds,
    );
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
