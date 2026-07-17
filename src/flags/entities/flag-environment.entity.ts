import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { FeatureFlag } from './feature-flag.entity';

export enum Environment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
}

@Entity('flag_environments')
@Index(['flagId', 'environment'], { unique: true })
export class FlagEnvironment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'flag_id' })
  flagId: string;

  @ManyToOne(() => FeatureFlag, f => f.environments)
  @JoinColumn({ name: 'flag_id' })
  flag: FeatureFlag;

  @Column({ type: 'enum', enum: Environment })
  environment: Environment;

  @Column({ name: 'is_enabled', default: false })
  isEnabled: boolean;

  @Column({ name: 'rollout_percentage', type: 'float', default: 0 })
  rolloutPercentage: number;

  @Column({ type: 'jsonb', default: {} })
  targeting: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  variants: Array<{ value: any; weight: number }> | null;
}
