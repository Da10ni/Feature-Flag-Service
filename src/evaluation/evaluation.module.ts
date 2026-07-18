import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureFlag } from '../flags/entities/feature-flag.entity';
import { FlagEnvironment } from '../flags/entities/flag-environment.entity';
import { EvaluationService } from './evaluation.service';
import { EvaluationController } from './evaluation.controller';
import { RedisModule } from '../redis/redis.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeatureFlag, FlagEnvironment]),
    RedisModule,
    TenantsModule,
  ],
  providers: [EvaluationService],
  controllers: [EvaluationController],
  exports: [EvaluationService],
})
export class EvaluationModule {}
