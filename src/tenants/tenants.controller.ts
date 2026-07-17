import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
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

  @Get()
  async findAll() {
    return this.tenantsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }
}
