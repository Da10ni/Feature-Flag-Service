import { DataSource, DataSourceOptions } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { FeatureFlag } from '../flags/entities/feature-flag.entity';
import { FlagEnvironment } from '../flags/entities/flag-environment.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { InitialSchema1750000000000 } from './migrations/1750000000000-InitialSchema';

export const dataSourceOptions = (
  env: NodeJS.ProcessEnv = process.env,
): DataSourceOptions => ({
  type: 'postgres',
  host: env.DB_HOST ?? 'localhost',
  port: Number(env.DB_PORT ?? 5432),
  username: env.DB_USER ?? 'postgres',
  password: env.DB_PASSWORD ?? 'postgres',
  database: env.DB_NAME ?? 'featureflags',
  entities: [Tenant, FeatureFlag, FlagEnvironment, AuditLog],
  migrations: [InitialSchema1750000000000],

  poolSize: Number(env.DB_POOL_SIZE ?? 10),

  synchronize: false,

  logging: env.NODE_ENV === 'development',
  ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

export default new DataSource(dataSourceOptions());
