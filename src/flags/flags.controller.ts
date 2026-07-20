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
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiParam,
  ApiQuery,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { FlagsService } from './flags.service';
import { CreateFlagDto } from './dto/create-flag.dto';
import { UpdateFlagDto } from './dto/update-flag.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Environment } from './entities/flag-environment.entity';
import {
  FeatureFlagDto,
  ErrorResponseDto,
} from '../common/dto/api-responses.dto';

@ApiTags('Feature Flags')
@ApiSecurity('api-key')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `x-api-key`.',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description:
    'The API key belongs to a different tenant than the `tenantId` in the path.',
  type: ErrorResponseDto,
})
@ApiParam({
  name: 'tenantId',
  format: 'uuid',
  description:
    'Tenant that owns the flag. Must match the tenant behind the API key.',
})
@Controller('tenants/:tenantId/flags')
@UseGuards(ApiKeyGuard)
export class FlagsController {
  constructor(private readonly flagsService: FlagsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a feature flag',
    description:
      'Creates a flag and all three environment configurations at once. Environments omitted from `environments` default to disabled at 0% rollout, so a new flag is inert until explicitly turned on.\n\n' +
      '`flagKey` is unique per tenant rather than globally, so two tenants may each own a flag called `new-checkout`.',
  })
  @ApiCreatedResponse({ description: 'Flag created.', type: FeatureFlagDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed (unknown flag type, variant weight out of range, …).',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'A flag with this key already exists for the tenant.',
    type: ErrorResponseDto,
  })
  create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateFlagDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    this.validateTenantAccess(tenantId, tenant);
    return this.flagsService.create(tenantId, dto, tenant.id);
  }

  @Get()
  @ApiOperation({
    summary: 'List feature flags',
    description:
      "Returns the tenant's flags. Filtering by `environment` narrows each flag's `environments` array to just that environment, which is the shape a single-environment dashboard wants.",
  })
  @ApiQuery({
    name: 'environment',
    required: false,
    enum: Environment,
    description:
      "Return only this environment's configuration for each flag. Omit for all three.",
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'archived'],
    description:
      'Filter by archive state. Omit to return both active and archived flags.',
  })
  @ApiOkResponse({ description: 'Matching flags.', type: [FeatureFlagDto] })
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
  @ApiOperation({
    summary: 'Update a flag',
    description:
      'Partial update — send only the fields that change. Toggle, rollout percentage, targeting and variants are per-environment and require `environment` in the body; name, description and default value apply across all environments.\n\n' +
      "Every change is written to the append-only audit log with the full before and after state, and invalidates the tenant's evaluation cache so it takes effect on the very next evaluation.",
  })
  @ApiParam({
    name: 'flagKey',
    description: 'Flag key.',
    example: 'new-checkout-flow',
  })
  @ApiOkResponse({ description: 'Updated flag.', type: FeatureFlagDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed — for example an unrecognised `environment` value.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No such flag for this tenant.',
    type: ErrorResponseDto,
  })
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
  @ApiOperation({
    summary: 'Archive a flag (soft delete)',
    description:
      'Sets `isArchived`; the row is never removed. Archived flags stop being evaluated and drop out of `?status=active`, but stay readable via `?status=archived` and keep their full audit history — hard-deleting would destroy the compliance trail the audit log exists to provide.',
  })
  @ApiParam({
    name: 'flagKey',
    description: 'Flag key.',
    example: 'legacy-banner',
  })
  @ApiNoContentResponse({ description: 'Flag archived. No response body.' })
  @ApiNotFoundResponse({
    description: 'No such flag for this tenant.',
    type: ErrorResponseDto,
  })
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
