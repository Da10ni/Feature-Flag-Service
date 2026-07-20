import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1750000000000 implements MigrationInterface {
  name = 'InitialSchema1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "tenants" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"           varchar NOT NULL,
        "slug"           varchar NOT NULL,
        "api_key_hash"   varchar NOT NULL,
        "api_key_lookup" varchar,
        "is_active"      boolean NOT NULL DEFAULT true,
        "metadata"       jsonb   NOT NULL DEFAULT '{}',
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tenants_name" UNIQUE ("name"),
        CONSTRAINT "UQ_tenants_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_tenants_api_key_lookup" ON "tenants" ("api_key_lookup")`,
    );

    await queryRunner.query(
      `CREATE TYPE "feature_flags_type_enum" AS ENUM('boolean', 'string', 'number')`,
    );
    await queryRunner.query(`
      CREATE TABLE "feature_flags" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id"     uuid NOT NULL,
        "flag_key"      varchar NOT NULL,
        "name"          varchar NOT NULL,
        "description"   varchar,
        "type"          "feature_flags_type_enum" NOT NULL DEFAULT 'boolean',
        "default_value" jsonb NOT NULL,
        "is_archived"   boolean NOT NULL DEFAULT false,
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP NOT NULL DEFAULT now(),
        -- Constraint names match the ones TypeORM derives from the entity metadata, so
        -- \`npm run migration:generate\` reports a clean diff instead of proposing a
        -- pointless drop/recreate on every run.
        CONSTRAINT "FK_b0564fcd9cfb5b4b9bd00429dea"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_feature_flags_tenant_key" ON "feature_flags" ("tenant_id", "flag_key")`,
    );

    await queryRunner.query(
      `CREATE TYPE "flag_environments_environment_enum" AS ENUM('development', 'staging', 'production')`,
    );
    await queryRunner.query(`
      CREATE TABLE "flag_environments" (
        "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "flag_id"            uuid NOT NULL,
        "environment"        "flag_environments_environment_enum" NOT NULL,
        "is_enabled"         boolean NOT NULL DEFAULT false,
        "rollout_percentage" double precision NOT NULL DEFAULT 0,
        "targeting"          jsonb NOT NULL DEFAULT '{}',
        "variants"           jsonb,
        CONSTRAINT "FK_ea633a9c9109211655580cad413"
          FOREIGN KEY ("flag_id") REFERENCES "feature_flags"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_flag_environments_flag_env" ON "flag_environments" ("flag_id", "environment")`,
    );

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id"      uuid NOT NULL,
        "flag_id"        uuid,
        "flag_key"       varchar NOT NULL,
        "action"         varchar NOT NULL,
        "changed_by"     varchar NOT NULL,
        "previous_value" jsonb,
        "new_value"      jsonb,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_tenant_flag" ON "audit_logs" ("tenant_id", "flag_key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "flag_environments"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "flag_environments_environment_enum"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "feature_flags"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "feature_flags_type_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenants"`);
  }
}
