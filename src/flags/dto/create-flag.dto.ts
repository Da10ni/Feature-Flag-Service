import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsArray,
  ValidateNested,
  IsObject,
  IsDefined,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FlagType } from '../entities/feature-flag.entity';
import { Environment } from '../entities/flag-environment.entity';

export class VariantDto {
  @ApiProperty({
    description:
      'Value served when this variant is selected. Should match the flag type.',
    example: 'treatment',
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
  })
  @IsDefined()
  value: any;

  @ApiProperty({
    description:
      'Share of the bucket space for this variant. Weights across all variants should total 100.',
    example: 50,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  weight: number;
}

export class EnvironmentConfigDto {
  @ApiProperty({
    description: 'Environment this configuration applies to.',
    enum: Environment,
    enumName: 'Environment',
    example: Environment.PRODUCTION,
  })
  @IsEnum(Environment)
  environment: Environment;

  @ApiPropertyOptional({
    description:
      'Master on/off switch for this environment. When false the flag always resolves to defaultValue.',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Percentage of users receiving the enabled value. Membership is deterministic per user — see the evaluation algorithm in the README.',
    example: 25,
    minimum: 0,
    maximum: 100,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @ApiPropertyOptional({
    description:
      'Reserved for attribute-based targeting rules. Accepted and persisted, not yet consulted during evaluation.',
    type: 'object',
    additionalProperties: true,
    example: {},
  })
  @IsOptional()
  @IsObject()
  targeting?: Record<string, any>;

  @ApiPropertyOptional({
    description:
      'Weighted variants for A/B testing. String flags only. Variant selection is independent of rollout membership.',
    type: [VariantDto],
    example: [
      { value: 'control', weight: 50 },
      { value: 'treatment', weight: 50 },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants?: VariantDto[];
}

export class CreateFlagDto {
  @ApiProperty({
    description:
      'Tenant-scoped identifier used in evaluation calls and URLs. Unique per tenant, not globally.',
    example: 'new-checkout-flow',
  })
  @IsString()
  @IsNotEmpty()
  flagKey: string;

  @ApiProperty({
    description: 'Human-readable flag name.',
    example: 'New Checkout Flow',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Free-text description of what the flag controls.',
    example: 'Routes traffic to the rebuilt checkout funnel.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Value type this flag resolves to.',
    enum: FlagType,
    enumName: 'FlagType',
    example: FlagType.BOOLEAN,
  })
  @IsEnum(FlagType)
  type: FlagType;

  @ApiProperty({
    description:
      'Value returned when the flag is disabled or the user falls outside the rollout. Should match `type`.',
    example: false,
    oneOf: [{ type: 'boolean' }, { type: 'string' }, { type: 'number' }],
  })
  @IsDefined()
  defaultValue: any;

  @ApiPropertyOptional({
    description:
      'Per-environment configuration. All three environments are always created; any omitted here default to disabled at 0% rollout.',
    type: [EnvironmentConfigDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnvironmentConfigDto)
  environments?: EnvironmentConfigDto[];
}
