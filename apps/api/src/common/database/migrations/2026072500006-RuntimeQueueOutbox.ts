import type { MigrationInterface, QueryRunner } from "typeorm";

export class RuntimeQueueOutbox2026072500006 implements MigrationInterface {
  name = "RuntimeQueueOutbox2026072500006";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "runtime_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "run_kind" character varying(128) NOT NULL,
        "schema_version" character varying(48) NOT NULL DEFAULT 'hermes.runtime-run/v1',
        "status" character varying(24) NOT NULL DEFAULT 'queued',
        "idempotency_key" character varying(200) NOT NULL,
        "request_digest" character(64) NOT NULL,
        "correlation_id" character varying(200),
        "attempt_count" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL,
        "available_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deadline_at" TIMESTAMP WITH TIME ZONE,
        "cancellation_requested_at" TIMESTAMP WITH TIME ZONE,
        "lease_token" uuid,
        "lease_owner" character varying(160),
        "lease_generation" integer NOT NULL DEFAULT 0,
        "lease_expires_at" TIMESTAMP WITH TIME ZONE,
        "heartbeat_at" TIMESTAMP WITH TIME ZONE,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "last_error_code" character varying(128),
        CONSTRAINT "PK_runtime_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_runtime_runs_workspace_id"
          UNIQUE ("workspace_id", "id"),
        CONSTRAINT "UQ_runtime_runs_workspace_kind_key"
          UNIQUE ("workspace_id", "run_kind", "idempotency_key"),
        CONSTRAINT "FK_runtime_runs_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_runtime_runs_kind"
          CHECK ("run_kind" ~ '^[a-z][a-z0-9-]*([.][a-z][a-z0-9-]*)+$'),
        CONSTRAINT "CHK_runtime_runs_schema_version"
          CHECK ("schema_version" = 'hermes.runtime-run/v1'),
        CONSTRAINT "CHK_runtime_runs_status"
          CHECK (
            "status" IN (
              'cancelled', 'cancelling', 'failed', 'queued',
              'running', 'succeeded', 'timedOut', 'waiting'
            )
          ),
        CONSTRAINT "CHK_runtime_runs_idempotency_key"
          CHECK (length(btrim("idempotency_key")) BETWEEN 1 AND 200),
        CONSTRAINT "CHK_runtime_runs_request_digest"
          CHECK ("request_digest" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_runtime_runs_attempts"
          CHECK (
            "attempt_count" >= 0
            AND "max_attempts" > 0
            AND "attempt_count" <= "max_attempts"
          ),
        CONSTRAINT "CHK_runtime_runs_lease_generation"
          CHECK ("lease_generation" >= 0),
        CONSTRAINT "CHK_runtime_runs_lease_shape"
          CHECK (
            (
              "lease_token" IS NULL
              AND "lease_owner" IS NULL
              AND "lease_expires_at" IS NULL
              AND "heartbeat_at" IS NULL
            ) OR (
              "lease_token" IS NOT NULL
              AND "lease_owner" IS NOT NULL
              AND "lease_expires_at" IS NOT NULL
              AND "heartbeat_at" IS NOT NULL
              AND "lease_expires_at" > "heartbeat_at"
            )
          ),
        CONSTRAINT "CHK_runtime_runs_running_lease"
          CHECK (
            ("status" IN ('running', 'cancelling') AND "lease_token" IS NOT NULL)
            OR (
              "status" NOT IN ('running', 'cancelling')
              AND "lease_token" IS NULL
            )
          ),
        CONSTRAINT "CHK_runtime_runs_started_state"
          CHECK (
            "status" NOT IN ('running', 'cancelling')
            OR "started_at" IS NOT NULL
          ),
        CONSTRAINT "CHK_runtime_runs_finished_state"
          CHECK (
            (
              "status" IN ('succeeded', 'failed', 'cancelled', 'timedOut')
              AND "finished_at" IS NOT NULL
            ) OR (
              "status" IN ('queued', 'running', 'cancelling', 'waiting')
              AND "finished_at" IS NULL
            )
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_2c05a754cd252145bebf8084a9"
      ON "runtime_runs" ("workspace_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_runtime_runs_workspace_status_created"
      ON "runtime_runs" ("workspace_id", "status", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_runtime_runs_dispatch_scan"
      ON "runtime_runs" ("status", "available_at", "lease_expires_at", "id")
      WHERE "status" IN ('queued', 'running', 'cancelling')
    `);

    await queryRunner.query(`
      CREATE TABLE "runtime_outbox_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "topic" character varying(128) NOT NULL DEFAULT 'runtime.run.dispatch',
        "schema_version" character varying(48) NOT NULL DEFAULT 'hermes.runtime-dispatch/v1',
        "dedupe_key" character varying(200) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL,
        "available_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "lease_token" uuid,
        "lease_owner" character varying(160),
        "lease_expires_at" TIMESTAMP WITH TIME ZONE,
        "published_at" TIMESTAMP WITH TIME ZONE,
        "last_error_code" character varying(128),
        CONSTRAINT "PK_runtime_outbox_messages" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_runtime_outbox_workspace_id"
          UNIQUE ("workspace_id", "id"),
        CONSTRAINT "UQ_runtime_outbox_workspace_topic_dedupe"
          UNIQUE ("workspace_id", "topic", "dedupe_key"),
        CONSTRAINT "UQ_runtime_outbox_workspace_run_topic"
          UNIQUE ("workspace_id", "run_id", "topic"),
        CONSTRAINT "FK_runtime_outbox_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_runtime_outbox_run"
          FOREIGN KEY ("workspace_id", "run_id")
          REFERENCES "runtime_runs"("workspace_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_runtime_outbox_topic"
          CHECK ("topic" = 'runtime.run.dispatch'),
        CONSTRAINT "CHK_runtime_outbox_schema_version"
          CHECK ("schema_version" = 'hermes.runtime-dispatch/v1'),
        CONSTRAINT "CHK_runtime_outbox_dedupe_key"
          CHECK (length(btrim("dedupe_key")) BETWEEN 1 AND 200),
        CONSTRAINT "CHK_runtime_outbox_payload"
          CHECK (
            jsonb_typeof("payload") = 'object'
            AND "payload" ?& ARRAY['schemaVersion', 'dispatchId', 'runId']
            AND ("payload" - 'schemaVersion' - 'dispatchId' - 'runId') = '{}'::jsonb
            AND "payload"->>'schemaVersion' = 'hermes.runtime-dispatch/v1'
            AND "payload"->>'dispatchId' = "id"::text
            AND "payload"->>'runId' = "run_id"::text
          ),
        CONSTRAINT "CHK_runtime_outbox_status"
          CHECK ("status" IN ('pending', 'publishing', 'published', 'dead')),
        CONSTRAINT "CHK_runtime_outbox_attempts"
          CHECK (
            "attempt_count" >= 0
            AND "max_attempts" > 0
            AND "attempt_count" <= "max_attempts"
          ),
        CONSTRAINT "CHK_runtime_outbox_lease_shape"
          CHECK (
            (
              "lease_token" IS NULL
              AND "lease_owner" IS NULL
              AND "lease_expires_at" IS NULL
            ) OR (
              "lease_token" IS NOT NULL
              AND "lease_owner" IS NOT NULL
              AND "lease_expires_at" IS NOT NULL
            )
          ),
        CONSTRAINT "CHK_runtime_outbox_publishing_lease"
          CHECK (
            ("status" = 'publishing' AND "lease_token" IS NOT NULL)
            OR ("status" <> 'publishing' AND "lease_token" IS NULL)
          ),
        CONSTRAINT "CHK_runtime_outbox_published_state"
          CHECK (
            ("status" = 'published' AND "published_at" IS NOT NULL)
            OR ("status" <> 'published' AND "published_at" IS NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_103b777ca5770c6b250ece0d42"
      ON "runtime_outbox_messages" ("workspace_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_runtime_outbox_workspace_status_created"
      ON "runtime_outbox_messages" ("workspace_id", "status", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_runtime_outbox_dispatch_scan"
      ON "runtime_outbox_messages" ("status", "available_at", "lease_expires_at", "id")
      WHERE "status" IN ('pending', 'publishing')
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_runtime_outbox_published_reconcile"
      ON "runtime_outbox_messages" ("published_at", "id")
      WHERE "status" = 'published'
    `);
  }

  async down(): Promise<void> {
    throw new Error(
      "RuntimeQueueOutbox2026072500006 cannot be rolled back safely while durable runs or pending dispatches may exist.",
    );
  }
}
