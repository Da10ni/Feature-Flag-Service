import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FlagEnvironment, Environment } from './entities/flag-environment.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CreateFlagDto } from './dto/create-flag.dto';
import { UpdateFlagDto } from './dto/update-flag.dto';

@Injectable()
export class FlagsService {
  constructor(
    @InjectRepository(FeatureFlag) private flagRepo: Repository<FeatureFlag>,
    @InjectRepository(FlagEnvironment) private envRepo: Repository<FlagEnvironment>,
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
    private eventEmitter: EventEmitter2,
  ) {}

  async create(tenantId: string, dto: CreateFlagDto, changedBy: string): Promise<FeatureFlag> {
    const existing = await this.flagRepo.findOne({ where: { tenantId, flagKey: dto.flagKey } });
    if (existing) throw new ConflictException(`Flag with key '${dto.flagKey}' already exists`);

    const envs = Object.values(Environment).map(env => {
      const config = dto.environments?.find(e => e.environment === env);
      return this.envRepo.create({
        environment: env,
        isEnabled: config?.isEnabled ?? false,
        rolloutPercentage: config?.rolloutPercentage ?? 0,
        targeting: config?.targeting ?? {},
        variants: config?.variants ?? null,
      });
    });

    const flag = this.flagRepo.create({ tenantId, ...dto, environments: envs });
    const saved = await this.flagRepo.save(flag);

    await this.auditRepo.save(this.auditRepo.create({
      tenantId, flagId: saved.id, flagKey: saved.flagKey,
      action: 'CREATED', changedBy, previousValue: null, newValue: saved,
    }));

    this.eventEmitter.emit('flag.changed', { tenantId, flagKey: saved.flagKey, action: 'CREATED', flag: saved });
    return saved;
  }

  async findAll(tenantId: string, environment?: string, status?: string): Promise<FeatureFlag[]> {
    const qb = this.flagRepo.createQueryBuilder('flag')
      .leftJoinAndSelect('flag.environments', 'env')
      .where('flag.tenantId = :tenantId', { tenantId });

    if (status === 'archived') qb.andWhere('flag.isArchived = true');
    else if (status === 'active') qb.andWhere('flag.isArchived = false');

    if (environment) qb.andWhere('env.environment = :environment', { environment });

    return qb.getMany();
  }

  async findOne(tenantId: string, flagKey: string): Promise<FeatureFlag> {
    const flag = await this.flagRepo.findOne({ where: { tenantId, flagKey }, relations: ['environments'] });
    if (!flag) throw new NotFoundException(`Flag '${flagKey}' not found`);
    return flag;
  }

  async update(tenantId: string, flagKey: string, dto: UpdateFlagDto, changedBy: string): Promise<FeatureFlag> {
    const flag = await this.findOne(tenantId, flagKey);
    const previousValue = { ...flag };

    if (dto.name !== undefined) flag.name = dto.name;
    if (dto.description !== undefined) flag.description = dto.description;
    if (dto.defaultValue !== undefined) flag.defaultValue = dto.defaultValue;

    if (dto.environment && (dto.isEnabled !== undefined || dto.rolloutPercentage !== undefined || dto.targeting !== undefined || dto.variants !== undefined)) {
      const envRecord = flag.environments.find(e => e.environment === dto.environment);
      if (envRecord) {
        if (dto.isEnabled !== undefined) envRecord.isEnabled = dto.isEnabled;
        if (dto.rolloutPercentage !== undefined) envRecord.rolloutPercentage = dto.rolloutPercentage;
        if (dto.targeting !== undefined) envRecord.targeting = dto.targeting;
        if (dto.variants !== undefined) envRecord.variants = dto.variants;
        await this.envRepo.save(envRecord);
      }
    }

    const saved = await this.flagRepo.save(flag);

    await this.auditRepo.save(this.auditRepo.create({
      tenantId, flagId: flag.id, flagKey,
      action: 'UPDATED', changedBy, previousValue, newValue: saved,
    }));

    this.eventEmitter.emit('flag.changed', { tenantId, flagKey, action: 'UPDATED', flag: saved, environment: dto.environment });
    return saved;
  }

  async archive(tenantId: string, flagKey: string, changedBy: string): Promise<void> {
    const flag = await this.findOne(tenantId, flagKey);
    const previousValue = { ...flag };
    flag.isArchived = true;
    await this.flagRepo.save(flag);

    await this.auditRepo.save(this.auditRepo.create({
      tenantId, flagId: flag.id, flagKey,
      action: 'ARCHIVED', changedBy, previousValue, newValue: { ...flag },
    }));

    this.eventEmitter.emit('flag.changed', { tenantId, flagKey, action: 'ARCHIVED' });
  }
}
