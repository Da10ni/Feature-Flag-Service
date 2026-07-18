import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

export function apiKeyLookup(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
  ) {}

  async create(
    dto: CreateTenantDto,
  ): Promise<{ tenant: Tenant; apiKey: string }> {
    const existing = await this.tenantRepo.findOne({
      where: [{ name: dto.name }, { slug: dto.slug }],
    });
    if (existing)
      throw new ConflictException(
        'Tenant with this name or slug already exists',
      );

    const rawApiKey = `ffs_${uuidv4().replace(/-/g, '')}`;
    const apiKeyHash = await bcrypt.hash(rawApiKey, 12);

    const tenant = this.tenantRepo.create({
      ...dto,
      apiKeyHash,
      apiKeyLookup: apiKeyLookup(rawApiKey),
    });
    const saved = await this.tenantRepo.save(tenant);
    return { tenant: saved, apiKey: rawApiKey };
  }

  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return tenant;
  }
}
