import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsArray,
  IsObject,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Environment } from '../entities/flag-environment.entity';
import { VariantDto } from './create-flag.dto';

export class UpdateFlagDto {
  @ApiPropertyOptional({
    description: 'New human-readable name. Applies across all environments.',
    example: 'New Checkout Flow (v2)',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'New description. Applies across all environments.',
    example: 'Rebuilt checkout funnel, now including express pay.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'New fallback value for disabled / not-in-rollout evaluations. Applies across all environments.',
    example: false,
    oneOf: [{ type: 'boolean' }, { type: 'string' }, { type: 'number' }],
  })
  @IsOptional()
  defaultValue?: any;

  @ApiPropertyOptional({
    description:
      'Environment to modify. REQUIRED for any of the per-environment fields below to take effect.',
    enum: Environment,
    enumName: 'Environment',
    example: Environment.PRODUCTION,
  })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;

  @ApiPropertyOptional({
    description:
      'Toggle the flag on or off in the given `environment`. Requires `environment`.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'New rollout percentage in the given `environment`. Requires `environment`. Users already inside the rollout remain inside when this increases.',
    example: 50,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @ApiPropertyOptional({
    description:
      'Targeting rules for the given `environment`. Requires `environment`.',
    type: 'object',
    additionalProperties: true,
    example: {},
  })
  @IsOptional()
  @IsObject()
  targeting?: Record<string, any>;

  @ApiPropertyOptional({
    description:
      'Replacement variant set for the given `environment`. Requires `environment`. Re-weighting does not reshuffle who is inside the rollout.',
    type: [VariantDto],
    example: [
      { value: 'control', weight: 30 },
      { value: 'treatment', weight: 70 },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants?: VariantDto[];
}
