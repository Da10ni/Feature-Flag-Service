import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_logs')
@Index('IDX_audit_logs_tenant_flag', ['tenantId', 'flagKey'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Explicit uuid: these reference tenants.id / feature_flags.id, and without the type
  // hint TypeORM infers varchar from the TS `string`, which indexes and compares worse.
  // Deliberately NOT foreign keys — an audit row must survive the flag it describes.
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'flag_id', type: 'uuid', nullable: true })
  flagId: string;

  @Column({ name: 'flag_key' })
  flagKey: string;

  @Column()
  action: string;

  @Column({ name: 'changed_by' })
  changedBy: string;

  @Column({ name: 'previous_value', type: 'jsonb', nullable: true })
  previousValue: any;

  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
