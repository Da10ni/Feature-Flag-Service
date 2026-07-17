import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { HealthController } from './health.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  controllers: [HealthController],
})
export class HealthModule {}
