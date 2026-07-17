import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('audit_logs')
@Index(['tenantId', 'flagKey'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'flag_id', nullable: true })
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
