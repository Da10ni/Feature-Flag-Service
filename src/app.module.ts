import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './database/data-source';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TenantThrottlerGuard } from './common/guards/tenant-throttler.guard';
import { MetricsModule } from './metrics/metrics.module';
import { MetricsMiddleware } from './metrics/metrics.middleware';
import { TenantsModule } from './tenants/tenants.module';
import { FlagsModule } from './flags/flags.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { AuditModule } from './audit/audit.module';
import { SseModule } from './sse/sse.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Shares one definition with the TypeORM CLI (src/database/data-source.ts) so
    // generated migrations always diff against the schema the app actually boots.
    TypeOrmModule.forRootAsync({
      useFactory: () => dataSourceOptions(),
    }),
    // Per-tenant quota (see TenantThrottlerGuard). The default is ~100 rps sustained per
    // tenant: flag evaluation sits on the request path of every client page load, so a
    // limit low enough to be "safe" just breaks the callers it is meant to protect. The
    // point here is noisy-neighbour containment, not a billing quota — one tenant's traffic
    // spike must not starve the others.
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 6_000),
      },
    ]),
    EventEmitterModule.forRoot(),
    MetricsModule,
    RedisModule,
    TenantsModule,
    FlagsModule,
    EvaluationModule,
    AuditModule,
    SseModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: TenantThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Order matters: correlation ID first so it wraps the request in the ALS store that
    // every subsequent log line reads from. Metrics second — as middleware it sees guard
    // rejections and final status codes that an interceptor never would.
    consumer.apply(CorrelationIdMiddleware, MetricsMiddleware).forRoutes('*');
  }
}
