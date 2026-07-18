import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { AdminKeyGuard } from '../common/guards/admin-key.guard';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { Tenant } from './entities/tenant.entity';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @UseGuards(AdminKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTenantDto) {
    const { tenant, apiKey } = await this.tenantsService.create(dto);
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      apiKey,
      message: 'Store this API key securely — it will not be shown again',
      createdAt: tenant.createdAt,
    };
  }

  // Scoped to the caller's own tenant. There is deliberately no "list all tenants"
  // route: the spec doesn't ask for one, and on a public URL it would enumerate every
  // tenant on the platform.
  @Get('me')
  @UseGuards(ApiKeyGuard)
  async me(@CurrentTenant() tenant: Tenant) {
    return this.tenantsService.findOne(tenant.id);
  }
}
