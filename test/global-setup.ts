import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/database/data-source';
import { runMigrations } from '../src/database/run-migrations';

// The app no longer builds its schema on DataSource.initialize() (migrationsRun is off, so
// the advisory lock in runMigrations is not bypassed — see data-source.ts). The e2e suite
// therefore builds it once here, before any spec boots the app, through the same locked
// path production uses.
export default async function globalSetup(): Promise<void> {
  const dataSource = new DataSource(dataSourceOptions());
  await dataSource.initialize();
  try {
    await runMigrations(dataSource);
  } finally {
    await dataSource.destroy();
  }
}
