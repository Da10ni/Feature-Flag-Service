import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
  ) {}

  async getHistory(tenantId: string, flagKey: string): Promise<AuditLog[]> {
    return this.auditRepo.find({
      where: { tenantId, flagKey },
      order: { createdAt: 'DESC' },
    });
  }
}
