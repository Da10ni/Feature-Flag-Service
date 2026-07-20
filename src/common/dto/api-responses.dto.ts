import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FlagType } from '../../flags/entities/feature-flag.entity';
import { Environment } from '../../flags/entities/flag-environment.entity';
import { VariantDto } from '../../flags/dto/create-flag.dto';

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    description:
      'Either a single message or, for validation failures, one entry per invalid field.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: [
      'environment must be one of the following values: development, staging, production',
    ],
  })
  message: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;
}

export class CreateTenantResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Acme Corporation' })
  name: string;

  @ApiProperty({ example: 'acme-corp' })
  slug: string;

  @ApiProperty({
    description:
      'The plaintext API key. Returned ONCE, at creation, and never retrievable again — only a bcrypt hash is stored.',

    example: 'ffs_EXAMPLE0000000000000000000000',
  })
  apiKey: string;

  @ApiProperty({
    example: 'Store this API key securely — it will not be shown again',
  })
  message: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class TenantDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Acme Corporation' })
  name: string;

  @ApiProperty({ example: 'acme-corp' })
  slug: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ type: 'object', additionalProperties: true, example: {} })
  metadata: Record<string, any>;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class FlagEnvironmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The flag this configuration belongs to.',
  })
  flagId: string;

  @ApiProperty({ enum: Environment, enumName: 'Environment' })
  environment: Environment;

  @ApiProperty({ example: true })
  isEnabled: boolean;

  @ApiProperty({ example: 25, minimum: 0, maximum: 100 })
  rolloutPercentage: number;

  @ApiProperty({ type: 'object', additionalProperties: true, example: {} })
  targeting: Record<string, any>;

  @ApiProperty({
    type: [VariantDto],
    nullable: true,
    description: 'Null when the flag has no variants configured.',
    example: [
      { value: 'control', weight: 50 },
      { value: 'treatment', weight: 50 },
    ],
  })
  variants: VariantDto[] | null;
}

export class FeatureFlagDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiProperty({ example: 'new-checkout-flow' })
  flagKey: string;

  @ApiProperty({ example: 'New Checkout Flow' })
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ enum: FlagType, enumName: 'FlagType' })
  type: FlagType;

  @ApiProperty({
    description: 'Value returned when disabled or outside the rollout.',
    example: false,
    oneOf: [{ type: 'boolean' }, { type: 'string' }, { type: 'number' }],
  })
  defaultValue: any;

  @ApiProperty({
    description:
      'Soft-delete marker. Archived flags are excluded from evaluation.',
    example: false,
  })
  isArchived: boolean;

  @ApiProperty({
    type: [FlagEnvironmentDto],
    description:
      'One entry per environment. Filtered to a single entry when the list endpoint is called with `?environment=`.',
  })
  environments: FlagEnvironmentDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export enum EvaluationReason {
  ENABLED = 'ENABLED',
  FLAG_DISABLED = 'FLAG_DISABLED',
  NOT_IN_ROLLOUT = 'NOT_IN_ROLLOUT',
  VARIANT_MATCH = 'VARIANT_MATCH',
}

export class EvaluationResultDto {
  @ApiProperty({ example: 'new-checkout-flow' })
  flagKey: string;

  @ApiProperty({
    description: 'Resolved value for this user. Type follows the flag type.',
    example: true,
    oneOf: [{ type: 'boolean' }, { type: 'string' }, { type: 'number' }],
  })
  value: any;

  @ApiProperty({
    enum: EvaluationReason,
    enumName: 'EvaluationReason',
    description:
      'Why the flag resolved this way. Always the real cause — a cache hit does not mask it, because the cache stores flag definitions rather than results.',
    example: EvaluationReason.ENABLED,
  })
  reason: EvaluationReason;
}

export class BulkEvaluationResponseDto {
  @ApiProperty({ type: [EvaluationResultDto] })
  flags: EvaluationResultDto[];

  @ApiProperty({ description: 'Number of flags evaluated.', example: 5 })
  count: number;
}

export class AuditLogDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tenantId: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  flagId: string | null;

  @ApiProperty({ example: 'new-checkout-flow' })
  flagKey: string;

  @ApiProperty({
    description: 'What happened.',
    enum: ['CREATED', 'UPDATED', 'ARCHIVED'],
    example: 'UPDATED',
  })
  action: string;

  @ApiProperty({
    description: 'Identity that made the change.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  changedBy: string;

  @ApiProperty({
    nullable: true,
    description:
      'Full flag snapshot as it was BEFORE the change. Null for CREATED.',
    type: 'object',
    additionalProperties: true,
  })
  previousValue: Record<string, any> | null;

  @ApiProperty({
    nullable: true,
    description: 'Full flag snapshot as it was AFTER the change.',
    type: 'object',
    additionalProperties: true,
  })
  newValue: Record<string, any> | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status: string;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;

  @ApiProperty({ enum: ['connected', 'disconnected'], example: 'connected' })
  database: string;
}
