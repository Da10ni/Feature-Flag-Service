import { DataSource } from 'typeorm';

const MIGRATION_LOCK_KEY = 4711_2026;

export async function runMigrations(dataSource: DataSource): Promise<void> {
  const runner = dataSource.createQueryRunner();
  try {
    await runner.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await dataSource.runMigrations({ transaction: 'all' });
  } finally {
    await runner.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    await runner.release();
  }
}
