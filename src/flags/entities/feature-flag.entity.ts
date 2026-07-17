import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { FlagEnvironment } from './flag-environment.entity';

export enum FlagType {
  BOOLEAN = 'boolean',
  STRING = 'string',
  NUMBER = 'number',
}

@Entity('feature_flags')
@Index(['tenantId', 'flagKey'], { unique: true })
export class FeatureFlag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @ManyToOne(() => Tenant, t => t.flags)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'flag_key' })
  flagKey: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'enum', enum: FlagType, default: FlagType.BOOLEAN })
  type: FlagType;

  @Column({ name: 'default_value', type: 'jsonb' })
  defaultValue: any;

  @Column({ name: 'is_archived', default: false })
  isArchived: boolean;

  @OneToMany(() => FlagEnvironment, env => env.flag, { cascade: true, eager: true })
  environments: FlagEnvironment[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
