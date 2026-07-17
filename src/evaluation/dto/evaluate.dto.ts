import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class EvaluateDto {
  @IsString() @IsNotEmpty() tenantId: string;
  @IsString() @IsNotEmpty() environment: string;
  @IsString() @IsNotEmpty() userId: string;
  @IsOptional() @IsObject() context?: Record<string, any>;
  @IsOptional() @IsString() flagKey?: string;
}
