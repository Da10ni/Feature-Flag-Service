import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { EvaluationService } from './evaluation.service';
import { EvaluateDto } from './dto/evaluate.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { Tenant } from '../tenants/entities/tenant.entity';
import {
  EvaluationResultDto,
  BulkEvaluationResponseDto,
  ErrorResponseDto,
} from '../common/dto/api-responses.dto';

@ApiTags('Evaluation')
@ApiSecurity('api-key')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid `x-api-key`.',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description:
    'A `tenant_id` was supplied in the body and does not match the authenticated API key.',
  type: ErrorResponseDto,
})
@ApiTooManyRequestsResponse({
  description:
    "Per-tenant rate limit exceeded. Limits are keyed on the API key so one tenant cannot consume another tenant's budget.",
  type: ErrorResponseDto,
})
@Controller('evaluate')
@UseGuards(ApiKeyGuard)
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Evaluate a single flag for a user',
    description:
      'Resolves one flag for one user in one environment.\n\n' +
      '**Deterministic:** the same `user_id` always receives the same value for a given flag configuration. Bucketing is a SHA-256 hash of the flag key and user id mapped to 0–99, so no state is stored per user and any instance computes the same answer.\n\n' +
      '**Tenant scoping:** the tenant comes from the API key. `tenant_id` in the body is optional and only cross-checked.\n\n' +
      'Returns `200` with the resolved value; `reason` explains why, and is never masked by caching.',
  })
  @ApiOkResponse({ description: 'Evaluated value.', type: EvaluationResultDto })
  @ApiBadRequestResponse({
    description:
      '`flag_key` is missing, or `environment` is not one of development / staging / production.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No active flag with that key for this tenant.',
    type: ErrorResponseDto,
  })
  async evaluate(@Body() dto: EvaluateDto, @CurrentTenant() tenant: Tenant) {
    if (!dto.flagKey) throw new BadRequestException('flagKey is required');
    return this.evaluationService.evaluate(
      this.scope(dto, tenant),
      dto.flagKey,
    );
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Evaluate every active flag for a user',
    description:
      "Resolves all of the tenant's active (non-archived) flags for one user in a single call — the shape an SDK wants at client start-up.\n\n" +
      '`flag_key` is ignored here. Archived flags are excluded.\n\n' +
      "This costs no more database round trips than a single evaluation: the tenant's flag definitions are fetched once from cache and every flag is then evaluated in memory.",
  })
  @ApiOkResponse({
    description: 'All active flags, evaluated for this user.',
    type: BulkEvaluationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      '`environment` is not one of development / staging / production, or `user_id` is missing.',
    type: ErrorResponseDto,
  })
  async evaluateBulk(
    @Body() dto: EvaluateDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    const results = await this.evaluationService.evaluateBulk(
      this.scope(dto, tenant),
    );
    return { flags: results, count: results.length };
  }

  private scope(dto: EvaluateDto, tenant: Tenant) {
    if (dto.tenantId && dto.tenantId !== tenant.id) {
      throw new ForbiddenException(
        'tenant_id does not match the authenticated API key',
      );
    }
    return {
      tenantId: tenant.id,
      environment: dto.environment,
      userId: dto.userId,
      context: dto.context,
    };
  }
}
