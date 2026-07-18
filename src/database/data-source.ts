import { DataSource, DataSourceOptions } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { FeatureFlag } from '../flags/entities/feature-flag.entity';
import { FlagEnvironment } from '../flags/entities/flag-environment.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { InitialSchema1750000000000 } from './migrations/1750000000000-InitialSchema';

// Single source of truth for connection settings, shared by the Nest app (app.module)
// and the TypeORM CLI (`npm run migration:generate`). Keeping one definition means the
// CLI can never diff against a different schema than the one the app actually boots.
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
  // Explicit, because the ceiling is a product of instances × pool: production scales to 20
  // Cloud Run instances, so 10 each is 200 connections against Cloud SQL. Left implicit, a
  // driver-default change could silently exhaust the instance's connection limit and take
  // the service down under exactly the load it was scaling up to serve.
  poolSize: Number(env.DB_POOL_SIZE ?? 10),
  // synchronize is off everywhere, including local dev. Migrations are the only way the
  // schema is ever built.
  //
  // The alternative — synchronize in dev, migrations in production — means the schema you
  // develop against is produced by a different mechanism than the one you ship, and the
  // migration is never exercised until it runs in production for the first time. It also
  // creates a database that cannot later be pointed at a production build: tables exist but
  // the migrations table is empty, so every migration fails with "relation already exists".
  //
  // The cost is that changing an entity now requires `npm run migration:generate`. That is
  // the point: it fails at development time instead of at deploy time.
  synchronize: false,
  // Deliberately NOT migrationsRun. TypeORM runs migrations inside DataSource.initialize()
  // when that flag is set — which happens during NestFactory.create(), before main.ts can
  // take the advisory lock. Two Cloud Run instances booting together would then both apply
  // the baseline and the loser would crash-loop on "relation already exists": exactly the
  // race runMigrations() exists to prevent. Migrations run only via runMigrations(), which
  // holds the lock. The e2e suite builds its schema the same way, in test/global-setup.ts.
  logging: env.NODE_ENV === 'development',
  ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Default export is what the TypeORM CLI looks for.
export default new DataSource(dataSourceOptions());
