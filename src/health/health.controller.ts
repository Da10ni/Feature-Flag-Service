import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';

@Controller('health')
export class HealthController {
  constructor(
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
  ) {}

  @Get()
  async check() {
    try {
      await this.tenantRepo.query('SELECT 1');
      return { status: 'ok', timestamp: new Date().toISOString(), database: 'connected' };
    } catch {
      return { status: 'error', timestamp: new Date().toISOString(), database: 'disconnected' };
    }
  }
}
