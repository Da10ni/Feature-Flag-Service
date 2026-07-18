import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsArray,
  IsObject,
} from 'class-validator';

export class UpdateFlagDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() defaultValue?: any;
  @IsOptional() @IsBoolean() isEnabled?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(100) rolloutPercentage?: number;
  @IsOptional() @IsObject() targeting?: Record<string, any>;
  @IsOptional() @IsArray() variants?: Array<{ value: any; weight: number }>;
  @IsOptional() @IsString() environment?: string;
}
