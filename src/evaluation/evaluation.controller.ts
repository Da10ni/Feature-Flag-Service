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
import { EvaluationService } from './evaluation.service';
import { EvaluateDto } from './dto/evaluate.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { Tenant } from '../tenants/entities/tenant.entity';

// tenantId comes from the authenticated API key, never the request body — that's what enforces isolation.
@Controller('evaluate')
@UseGuards(ApiKeyGuard)
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async evaluate(@Body() dto: EvaluateDto, @CurrentTenant() tenant: Tenant) {
    if (!dto.flagKey) throw new BadRequestException('flagKey is required');
    return this.evaluationService.evaluate(
      this.scope(dto, tenant),
      dto.flagKey,
    );
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  async evaluateBulk(
    @Body() dto: EvaluateDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    const results = await this.evaluationService.evaluateBulk(
      this.scope(dto, tenant),
    );
    return { flags: results, count: results.length };
  }

  // The tenant always comes from the API key. A tenant_id in the body is accepted
  // (the spec documents it) but only ever checked for agreement — never trusted.
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
