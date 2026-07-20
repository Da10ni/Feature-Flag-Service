import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { AdminKeyGuard } from '../common/guards/admin-key.guard';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { Tenant } from './entities/tenant.entity';
import {
  CreateTenantResponseDto,
  TenantDto,
  ErrorResponseDto,
} from '../common/dto/api-responses.dto';

@ApiTags('Tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @UseGuards(AdminKeyGuard)
  @ApiSecurity('admin-key')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new tenant',
    description:
      'Creates a tenant (an application) and mints its API key. The key is returned exactly once and cannot be retrieved afterwards — only a bcrypt hash is stored.\n\n' +
      'Guarded by the `x-admin-key` header whenever `ADMIN_API_KEY` is configured. It is unset locally and in CI, so the guard is a no-op there; Terraform sets it from Secret Manager in staging and production, where the service is publicly reachable and an open registration endpoint would let anyone provision themselves credentials.',
  })
  @ApiCreatedResponse({
    description: 'Tenant created. Store `apiKey` now — it is not shown again.',
    type: CreateTenantResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed (e.g. slug is not lowercase-alphanumeric).',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid `x-admin-key` (when admin auth is enabled).',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'A tenant with this name or slug already exists.',
    type: ErrorResponseDto,
  })
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

  @Get('me')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Get the tenant owning the presented API key',
    description:
      'There is deliberately no endpoint that lists all tenants: it is not required, and on a public URL it would enumerate every tenant on the platform. API key material (`apiKeyHash`, `apiKeyLookup`) is marked `select: false` on the entity and never appears in any response.',
  })
  @ApiOkResponse({ description: 'The authenticated tenant.', type: TenantDto })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid `x-api-key`.',
    type: ErrorResponseDto,
  })
  async me(@CurrentTenant() tenant: Tenant) {
    return this.tenantsService.findOne(tenant.id);
  }
}
