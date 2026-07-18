import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsEnum,
  IsUUID,
} from 'class-validator';
import { Expose, Transform } from 'class-transformer';
import { Environment } from '../../flags/entities/flag-environment.entity';

// The spec documents this body as snake_case ({ tenant_id, environment, user_id, context }).
// We accept both that and camelCase so either client shape works.
const alias = (snake: string) =>
  Transform(
    ({ obj, value }: { obj: Record<string, unknown>; value: unknown }) =>
      value ?? obj[snake],
  );

export class EvaluateDto {
  // Validated as an enum, not a bare string: a typo'd environment must 400 rather than
  // silently miss every env config and report every flag as disabled.
  @IsEnum(Environment) environment: Environment;

  @Expose()
  @alias('user_id')
  @IsString()
  @IsNotEmpty()
  userId: string;

  // Optional, and only ever cross-checked against the API key's tenant — never trusted
  // as the source of tenant identity. Isolation comes from the key alone.
  @Expose()
  @alias('tenant_id')
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional() @IsObject() context?: Record<string, any>;

  @Expose()
  @alias('flag_key')
  @IsOptional()
  @IsString()
  flagKey?: string;
}
