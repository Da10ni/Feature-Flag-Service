import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';

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
