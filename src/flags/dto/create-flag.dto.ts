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
import { FlagType } from '../entities/feature-flag.entity';
import { Environment } from '../entities/flag-environment.entity';

export class VariantDto {
  // Polymorphic (string/number/bool) — @IsDefined keeps it past whitelist stripping.
  @IsDefined() value: any;
  @IsNumber() @Min(0) @Max(100) weight: number;
}

export class EnvironmentConfigDto {
  @IsEnum(Environment) environment: Environment;
  @IsOptional() @IsBoolean() isEnabled?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(100) rolloutPercentage?: number;
  @IsOptional() @IsObject() targeting?: Record<string, any>;
  @IsOptional() @IsArray() variants?: VariantDto[];
}

export class CreateFlagDto {
  @IsString() @IsNotEmpty() flagKey: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(FlagType) type: FlagType;
  // Polymorphic default (bool/string/number) — @IsDefined survives whitelist stripping.
  @IsDefined() defaultValue: any;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnvironmentConfigDto)
  environments?: EnvironmentConfigDto[];
}
