import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTenantDto {
  @ApiProperty({
    description:
      'Human-readable application name. Must be unique across the platform.',
    example: 'Acme Corporation',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description:
      'URL-safe identifier. Lowercase alphanumeric and hyphens only. Must be unique.',
    example: 'acme-corp',
    pattern: '^[a-z0-9-]+$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must be lowercase alphanumeric with hyphens',
  })
  slug: string;

  @ApiPropertyOptional({
    description:
      'Arbitrary key/value metadata stored against the tenant. Not interpreted by the service.',
    example: { team: 'payments', costCentre: 'CC-1042' },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
