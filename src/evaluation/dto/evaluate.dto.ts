import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsEnum,
  IsUUID,
} from 'class-validator';
import { Expose, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Environment } from '../../flags/entities/flag-environment.entity';

const alias = (snake: string) =>
  Transform(
    ({ obj, value }: { obj: Record<string, unknown>; value: unknown }) =>
      value ?? obj[snake],
  );

export class EvaluateDto {
  @ApiProperty({
    description: 'Environment to evaluate against.',
    enum: Environment,
    enumName: 'Environment',
    example: Environment.PRODUCTION,
  })
  @IsEnum(Environment)
  environment: Environment;

  @ApiProperty({
    name: 'user_id',
    description:
      'Stable identifier for the end user being evaluated. Drives deterministic bucketing — the same user always receives the same value for a given flag configuration. Also accepted as `userId`.',
    example: 'user-7a3f9b',
  })
  @Expose()
  @alias('user_id')
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    name: 'tenant_id',
    format: 'uuid',
    description:
      'Optional. The tenant is always derived from the API key; if supplied this is only cross-checked against it and returns 403 on mismatch. It is never trusted as the source of tenant identity. Also accepted as `tenantId`.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @Expose()
  @alias('tenant_id')
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({
    description:
      'Arbitrary user attributes. Accepted and reserved for attribute-based targeting; not yet consulted during evaluation.',
    type: 'object',
    additionalProperties: true,
    example: { country: 'US', plan: 'enterprise' },
  })
  @IsOptional()
  @IsObject()
  context?: Record<string, any>;

  @ApiPropertyOptional({
    name: 'flag_key',
    description:
      'Flag to evaluate. REQUIRED for POST /evaluate; ignored by POST /evaluate/bulk, which evaluates every active flag. Also accepted as `flagKey`.',
    example: 'new-checkout-flow',
  })
  @Expose()
  @alias('flag_key')
  @IsOptional()
  @IsString()
  flagKey?: string;
}
