import type { MigrationInterface, QueryRunner } from "typeorm";

export class RuntimeCheckpoints2026072500008 implements MigrationInterface {
  name = "RuntimeCheckpoints2026072500008";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "runtime_checkpoints" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "namespace" character varying(500) NOT NULL DEFAULT '',
        "checkpoint_key" uuid NOT NULL,
        "parent_checkpoint_id" uuid,
        "sequence" integer NOT NULL,
        "lease_generation" integer NOT NULL,
        "schema_version" character varying(48) NOT NULL DEFAULT 'hermes.graph-checkpoint/v1',
        "idempotency_key" character varying(200) NOT NULL,
        "state_digest" character(64) NOT NULL,
        "adapter_state" jsonb NOT NULL,
        CONSTRAINT "PK_runtime_checkpoints" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_runtime_checkpoints_workspace_id"
          UNIQUE ("workspace_id", "id"),
        CONSTRAINT "UQ_runtime_checkpoints_workspace_run_id"
          UNIQUE ("workspace_id", "run_id", "id"),
        CONSTRAINT "UQ_runtime_checkpoints_workspace_run_sequence"
          UNIQUE ("workspace_id", "run_id", "sequence"),
        CONSTRAINT "UQ_runtime_checkpoints_workspace_run_namespace_checkpoint_key"
          UNIQUE ("workspace_id", "run_id", "namespace", "checkpoint_key"),
        CONSTRAINT "UQ_runtime_checkpoints_workspace_run_namespace_idempotency_key"
          UNIQUE ("workspace_id", "run_id", "namespace", "idempotency_key"),
        CONSTRAINT "FK_runtime_checkpoints_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_runtime_checkpoints_run"
          FOREIGN KEY ("workspace_id", "run_id")
          REFERENCES "runtime_runs"("workspace_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_runtime_checkpoints_parent"
          FOREIGN KEY ("workspace_id", "run_id", "parent_checkpoint_id")
          REFERENCES "runtime_checkpoints"("workspace_id", "run_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_runtime_checkpoints_sequence"
          CHECK ("sequence" > 0),
        CONSTRAINT "CHK_runtime_checkpoints_lease_generation"
          CHECK ("lease_generation" > 0),
        CONSTRAINT "CHK_runtime_checkpoints_schema_version"
          CHECK ("schema_version" = 'hermes.graph-checkpoint/v1'),
        CONSTRAINT "CHK_runtime_checkpoints_namespace"
          CHECK ("namespace" ~ '^[A-Za-z0-9._:/|@-]{0,500}$'),
        CONSTRAINT "CHK_runtime_checkpoints_idempotency_key"
          CHECK (
            "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
          ),
        CONSTRAINT "CHK_runtime_checkpoints_state_digest"
          CHECK ("state_digest" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_runtime_checkpoints_adapter_state"
          CHECK (
            jsonb_typeof("adapter_state") = 'object'
            AND "adapter_state" ?& ARRAY['adapter', 'state']
            AND ("adapter_state" - 'adapter' - 'state') = '{}'::jsonb
            AND jsonb_typeof("adapter_state"->'adapter') = 'object'
            AND ("adapter_state"->'adapter')
              ?& ARRAY['kind', 'checkpointVersion']
            AND (
              ("adapter_state"->'adapter') - 'kind' - 'checkpointVersion'
            ) = '{}'::jsonb
            AND jsonb_typeof("adapter_state"->'adapter'->'kind') = 'string'
            AND length("adapter_state"->'adapter'->>'kind') BETWEEN 1 AND 128
            AND ("adapter_state"->'adapter'->>'kind')
              ~ '^[a-z][a-z0-9-]*([.][a-z][a-z0-9-]*)+$'
            AND jsonb_typeof(
              "adapter_state"->'adapter'->'checkpointVersion'
            ) = 'string'
            AND length(
              "adapter_state"->'adapter'->>'checkpointVersion'
            ) BETWEEN 1 AND 128
            AND ("adapter_state"->'adapter'->>'checkpointVersion')
              ~ '^[A-Za-z0-9][A-Za-z0-9./:_-]*$'
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_3b5688feb2ec5571296db5b0e3"
      ON "runtime_checkpoints" ("workspace_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "runtime_checkpoint_writes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "checkpoint_id" uuid NOT NULL,
        "task_id" character varying(128) NOT NULL,
        "write_index" integer NOT NULL,
        "channel" character varying(128) NOT NULL,
        "type" character varying(32) NOT NULL,
        "value" jsonb NOT NULL,
        CONSTRAINT "PK_runtime_checkpoint_writes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_runtime_checkpoint_writes_workspace_id"
          UNIQUE ("workspace_id", "id"),
        CONSTRAINT "UQ_runtime_checkpoint_writes_identity"
          UNIQUE (
            "workspace_id", "run_id", "checkpoint_id", "task_id", "write_index"
          ),
        CONSTRAINT "FK_runtime_checkpoint_writes_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_runtime_checkpoint_writes_checkpoint"
          FOREIGN KEY ("workspace_id", "run_id", "checkpoint_id")
          REFERENCES "runtime_checkpoints"("workspace_id", "run_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_runtime_checkpoint_writes_task_id"
          CHECK ("task_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
        CONSTRAINT "CHK_runtime_checkpoint_writes_channel"
          CHECK ("channel" ~ '^[A-Za-z0-9_][A-Za-z0-9._:/-]{0,127}$'),
        CONSTRAINT "CHK_runtime_checkpoint_writes_type"
          CHECK ("type" ~ '^[a-z][a-z0-9._+-]{0,31}$'),
        CONSTRAINT "CHK_runtime_checkpoint_writes_value"
          CHECK (jsonb_typeof("value") IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_27ee9790ee0af1f5d6c0df98fe"
      ON "runtime_checkpoint_writes" ("workspace_id")
    `);

    await queryRunner.query(`
      CREATE FUNCTION enforce_runtime_checkpoint_sequence()
      RETURNS trigger AS $$
      DECLARE
        latest_sequence integer;
      BEGIN
        PERFORM 1
        FROM "runtime_runs"
        WHERE "workspace_id" = NEW."workspace_id"
          AND "id" = NEW."run_id"
        FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'runtime checkpoint Run does not exist in its workspace';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM "runtime_checkpoints"
          WHERE "workspace_id" = NEW."workspace_id"
            AND "run_id" = NEW."run_id"
            AND "namespace" = NEW."namespace"
            AND (
              "idempotency_key" = NEW."idempotency_key"
              OR "checkpoint_key" = NEW."checkpoint_key"
            )
        ) THEN
          RETURN NEW;
        END IF;

        SELECT COALESCE(MAX("sequence"), 0)
        INTO latest_sequence
        FROM "runtime_checkpoints"
        WHERE "workspace_id" = NEW."workspace_id"
          AND "run_id" = NEW."run_id";

        IF NEW."sequence" <> latest_sequence + 1 THEN
          RAISE EXCEPTION 'runtime checkpoint sequence must advance by exactly one';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_runtime_checkpoints_monotonic_sequence"
      BEFORE INSERT ON "runtime_checkpoints"
      FOR EACH ROW EXECUTE FUNCTION enforce_runtime_checkpoint_sequence()
    `);
    await queryRunner.query(`
      CREATE FUNCTION prevent_runtime_checkpoint_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'runtime checkpoints are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_runtime_checkpoints_immutable"
      BEFORE UPDATE OR DELETE ON "runtime_checkpoints"
      FOR EACH ROW EXECUTE FUNCTION prevent_runtime_checkpoint_mutation()
    `);
    await queryRunner.query(`
      CREATE FUNCTION enforce_runtime_checkpoint_write_mutation()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'runtime checkpoint pending writes cannot be deleted';
        END IF;

        IF OLD."write_index" >= 0
          OR NEW."id" IS DISTINCT FROM OLD."id"
          OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
          OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
          OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
          OR NEW."checkpoint_id" IS DISTINCT FROM OLD."checkpoint_id"
          OR NEW."task_id" IS DISTINCT FROM OLD."task_id"
          OR NEW."write_index" IS DISTINCT FROM OLD."write_index"
          OR NEW."channel" IS DISTINCT FROM OLD."channel"
        THEN
          RAISE EXCEPTION 'only negative-index pending write values may be replaced';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_runtime_checkpoint_writes_controlled_mutation"
      BEFORE UPDATE OR DELETE ON "runtime_checkpoint_writes"
      FOR EACH ROW EXECUTE FUNCTION enforce_runtime_checkpoint_write_mutation()
    `);
  }

  async down(): Promise<void> {
    throw new Error(
      "RuntimeCheckpoints2026072500008 cannot be rolled back safely while durable checkpoints or pending writes may exist.",
    );
  }
}
