import type { MigrationInterface, QueryRunner } from "typeorm";

export class RuntimeRunEvents2026072500007 implements MigrationInterface {
  name = "RuntimeRunEvents2026072500007";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "runtime_runs"
      ADD COLUMN "event_sequence" integer NOT NULL DEFAULT 0,
      ADD CONSTRAINT "CHK_runtime_runs_event_sequence"
        CHECK ("event_sequence" >= 0)
    `);

    await queryRunner.query(`
      CREATE TABLE "runtime_run_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "sequence" integer NOT NULL,
        "schema_version" character varying(48) NOT NULL DEFAULT 'hermes.run-event/v1',
        "event_key" character varying(128) NOT NULL,
        "type" character varying(64) NOT NULL,
        "node_id" character varying(128),
        "call_id" uuid,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "payload" jsonb NOT NULL,
        CONSTRAINT "PK_runtime_run_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_runtime_run_events_workspace_id"
          UNIQUE ("workspace_id", "id"),
        CONSTRAINT "UQ_runtime_run_events_workspace_run_sequence"
          UNIQUE ("workspace_id", "run_id", "sequence"),
        CONSTRAINT "UQ_runtime_run_events_workspace_run_event_key"
          UNIQUE ("workspace_id", "run_id", "event_key"),
        CONSTRAINT "FK_runtime_run_events_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_runtime_run_events_run"
          FOREIGN KEY ("workspace_id", "run_id")
          REFERENCES "runtime_runs"("workspace_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_runtime_run_events_sequence"
          CHECK ("sequence" > 0),
        CONSTRAINT "CHK_runtime_run_events_schema_version"
          CHECK ("schema_version" = 'hermes.run-event/v1'),
        CONSTRAINT "CHK_runtime_run_events_event_key"
          CHECK ("event_key" ~ '^[A-Za-z][A-Za-z0-9._:-]*$'),
        CONSTRAINT "CHK_runtime_run_events_node_id"
          CHECK (
            "node_id" IS NULL
            OR "node_id" ~ '^[A-Za-z][A-Za-z0-9._:-]*$'
          ),
        CONSTRAINT "CHK_runtime_run_events_type"
          CHECK (
            "type" IN (
              'artifact.created', 'checkpoint.created', 'model.output.delta',
              'node.completed', 'node.failed', 'node.started',
              'run.cancellation.requested', 'run.completed', 'run.failed',
              'run.started', 'run.status.changed', 'tool.call.completed',
              'tool.call.started', 'usage.recorded'
            )
          ),
        CONSTRAINT "CHK_runtime_run_events_payload"
          CHECK (jsonb_typeof("payload") = 'object')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_da295429542592f0b206eb05cb"
      ON "runtime_run_events" ("workspace_id")
    `);
    await queryRunner.query(`
      CREATE FUNCTION prevent_runtime_run_event_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'runtime Run events are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_runtime_run_events_immutable"
      BEFORE UPDATE OR DELETE ON "runtime_run_events"
      FOR EACH ROW EXECUTE FUNCTION prevent_runtime_run_event_mutation()
    `);
  }

  async down(): Promise<void> {
    throw new Error(
      "RuntimeRunEvents2026072500007 cannot be rolled back safely while durable Run events may exist.",
    );
  }
}
