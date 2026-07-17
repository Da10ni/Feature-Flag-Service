import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TenantsModule } from './tenants/tenants.module';
import { FlagsModule } from './flags/flags.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { AuditModule } from './audit/audit.module';
import { SseModule } from './sse/sse.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { Tenant } from './tenants/entities/tenant.entity';
import { FeatureFlag } from './flags/entities/feature-flag.entity';
import { FlagEnvironment } from './flags/entities/flag-environment.entity';
import { AuditLog } from './audit/entities/audit-log.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USER', 'postgres'),
        password: config.get('DB_PASSWORD', 'postgres'),
        database: config.get('DB_NAME', 'featureflags'),
        entities: [Tenant, FeatureFlag, FlagEnvironment, AuditLog],
        synchronize: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') === 'development',
        ssl: config.get('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]),
    EventEmitterModule.forRoot(),
    RedisModule,
    TenantsModule,
    FlagsModule,
    EvaluationModule,
    AuditModule,
    SseModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
