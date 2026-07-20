import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { HealthResponseDto } from '../common/dto/api-responses.dto';

@ApiTags('Operations')
@Controller('health')
export class HealthController {
  constructor(
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
  ) {}

  // Must return a non-2xx when unhealthy. Everything downstream keys off the status
  // code, not the body: the Cloud Run liveness probe, the uptime-check alert policy,
  // and the CI canary gate that rolls back on a failed health check. Answering 200
  // with {status:'error'} makes all three read a broken service as healthy.
  @Get()
  @ApiOperation({
    summary: 'Liveness / readiness check',
    description:
      'Verifies the service can reach PostgreSQL, then reports the result **through the status code**, not just the body.\n\n' +
      'That distinction matters: the Cloud Run liveness probe, the Cloud Monitoring uptime check, and the CI canary gate that rolls back a bad deploy all key off the status code. Returning `200` with `{"status":"error"}` would make every one of them read a broken service as healthy.\n\n' +
      'Requires no authentication.',
  })
  @ApiOkResponse({
    description: 'Service is healthy and the database is reachable.',
    type: HealthResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'The database is unreachable. Probes and the deploy gate treat this as a failure.',
    type: HealthResponseDto,
  })
  async check() {
    try {
      await this.tenantRepo.query('SELECT 1');
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'connected',
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
      });
    }
  }
}
