import {
  Controller,
  Get,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiParam,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { Tenant } from '../tenants/entities/tenant.entity';
import { AuditLogDto, ErrorResponseDto } from '../common/dto/api-responses.dto';

@ApiTags('Audit')
@ApiSecurity('api-key')
@Controller('tenants/:tenantId/flags/:flagKey/history')
@UseGuards(ApiKeyGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({
    summary: "Get a flag's change history",
    description:
      'Chronological change history for one flag, newest first.\n\n' +
      'Every create, update and archive is recorded automatically with who changed it, when, and the complete flag state before and after. Records are append-only — nothing in the service ever issues an UPDATE or DELETE against this table, and archiving a flag preserves its history rather than removing it.',
  })
  @ApiParam({
    name: 'tenantId',
    format: 'uuid',
    description: 'Must match the tenant behind the API key.',
  })
  @ApiParam({
    name: 'flagKey',
    description: 'Flag key.',
    example: 'new-checkout-flow',
  })
  @ApiOkResponse({
    description:
      'Audit entries, newest first. Empty array if the flag has no history or does not exist.',
    type: [AuditLogDto],
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid `x-api-key`.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'The API key belongs to a different tenant.',
    type: ErrorResponseDto,
  })
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
