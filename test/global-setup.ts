import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/database/data-source';
import { runMigrations } from '../src/database/run-migrations';

export default async function globalSetup(): Promise<void> {
  const dataSource = new DataSource(dataSourceOptions());
  await dataSource.initialize();
  try {
    await runMigrations(dataSource);
  } finally {
    await dataSource.destroy();
  }
}
