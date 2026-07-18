import {
  Controller,
  Get,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { Tenant } from '../tenants/entities/tenant.entity';

@Controller('tenants/:tenantId/flags/:flagKey/history')
@UseGuards(ApiKeyGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  getHistory(
    @Param('tenantId') tenantId: string,
    @Param('flagKey') flagKey: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    if (tenant.id !== tenantId)
      throw new ForbiddenException("Cannot access another tenant's history");
    return this.auditService.getHistory(tenantId, flagKey);
  }
}
