import { DataSource } from 'typeorm';

// Arbitrary but fixed key — any process using this same number contends for the same lock.
const MIGRATION_LOCK_KEY = 4711_2026;

// Cloud Run starts production with min_instance_count = 2, so instances boot concurrently.
// Without serialization both would read an empty migrations table and both try to apply
// the baseline; the loser crashes on "relation already exists" and crash-loops.
//
// A Postgres session-level advisory lock is the cheapest fix: the second instance blocks
// until the first commits, then finds the migration already recorded and no-ops. The lock
// is held on one connection and released in `finally`, and Postgres drops it automatically
// if the instance dies mid-migration.
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
