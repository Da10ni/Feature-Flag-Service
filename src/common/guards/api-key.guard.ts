import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string;
    if (!apiKey) throw new UnauthorizedException('Missing API key');

    const tenants = await this.tenantRepo.find({ where: { isActive: true } });
    for (const tenant of tenants) {
      const match = await bcrypt.compare(apiKey, tenant.apiKeyHash);
      if (match) {
        request['tenant'] = tenant;
        return true;
      }
    }
    throw new UnauthorizedException('Invalid API key');
  }
}
