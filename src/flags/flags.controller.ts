import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { FlagsService } from './flags.service';
import { CreateFlagDto } from './dto/create-flag.dto';
import { UpdateFlagDto } from './dto/update-flag.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { Tenant } from '../tenants/entities/tenant.entity';

@Controller('tenants/:tenantId/flags')
@UseGuards(ApiKeyGuard)
export class FlagsController {
  constructor(private readonly flagsService: FlagsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateFlagDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    this.validateTenantAccess(tenantId, tenant);
    return this.flagsService.create(tenantId, dto, tenant.id);
  }

  @Get()
  findAll(
    @Param('tenantId') tenantId: string,
    @Query('environment') environment?: string,
    @Query('status') status?: string,
    @CurrentTenant() tenant?: Tenant,
  ) {
    this.validateTenantAccess(tenantId, tenant!);
    return this.flagsService.findAll(tenantId, environment, status);
  }

  @Put(':flagKey')
  update(
    @Param('tenantId') tenantId: string,
    @Param('flagKey') flagKey: string,
    @Body() dto: UpdateFlagDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    this.validateTenantAccess(tenantId, tenant);
    return this.flagsService.update(tenantId, flagKey, dto, tenant.id);
  }

  @Delete(':flagKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @Param('tenantId') tenantId: string,
    @Param('flagKey') flagKey: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    this.validateTenantAccess(tenantId, tenant);
    return this.flagsService.archive(tenantId, flagKey, tenant.id);
  }

  private validateTenantAccess(tenantId: string, tenant: Tenant) {
    if (tenant.id !== tenantId) {
      throw new ForbiddenException("Cannot access another tenant's flags");
    }
  }
}
