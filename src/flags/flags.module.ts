import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FlagEnvironment } from './entities/flag-environment.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { FlagsService } from './flags.service';
import { FlagsController } from './flags.controller';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TypeOrmModule.forFeature([FeatureFlag, FlagEnvironment, AuditLog]), TenantsModule],
  providers: [FlagsService],
  controllers: [FlagsController],
  exports: [FlagsService, TypeOrmModule],
})
export class FlagsModule {}
