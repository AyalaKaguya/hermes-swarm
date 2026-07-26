import type { MigrationInterface, QueryRunner } from "typeorm";

const DEFAULT_WORKSPACE_ROLES = ["workspace-owner", "workspace-admin"] as const;

const QUERY_RUN_PERMISSIONS = [
  {
    code: "analytics.ticket_dataset.query_run_submit:workspace",
    description: "提交当前工作空间的异步工单分析查询。",
    isDangerous: false,
    operation: "query_run_submit",
    operationLabel: "提交异步分析",
    operationOrder: 30,
  },
  {
    code: "analytics.ticket_dataset.query_run_read:workspace",
    description: "读取当前工作空间的异步分析状态。",
    isDangerous: false,
    operation: "query_run_read",
    operationLabel: "查看异步分析",
    operationOrder: 40,
  },
  {
    code: "analytics.ticket_dataset.query_run_cancel:workspace",
    description: "取消当前工作空间尚未完成的异步分析。",
    isDangerous: true,
    operation: "query_run_cancel",
    operationLabel: "取消异步分析",
    operationOrder: 50,
  },
  {
    code: "analytics.ticket_dataset.query_run_result:workspace",
    description: "读取当前工作空间已完成的异步分析结果。",
    isDangerous: false,
    operation: "query_run_result",
    operationLabel: "读取异步分析结果",
    operationOrder: 60,
  },
  {
    code: "analytics.ticket_dataset.artifact_download:workspace",
    description: "鉴权后下载当前工作空间的分析制品。",
    isDangerous: false,
    operation: "artifact_download",
    operationLabel: "下载分析制品",
    operationOrder: 70,
  },
] as const;

export class AnalyticsQueryArtifacts2026072600001
  implements MigrationInterface
{
  name = "AnalyticsQueryArtifacts2026072600001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_integration_tokens_workspace_id"
      ON "integration_tokens" ("workspace_id", "id")
    `);

    for (const permission of QUERY_RUN_PERMISSIONS) {
      await queryRunner.query(
        `
          INSERT INTO "permissions" (
            "code", "entity", "entity_label", "entity_order", "purpose",
            "purpose_label", "purpose_order", "operation", "operation_label",
            "operation_order", "action", "scope", "description", "is_dangerous",
            "source", "default_roles"
          )
          VALUES (
            $1, 'analytics', '数据分析', 80, 'ticket_dataset', '工单数据集', 10,
            $2, $3, $4, $2, 'workspace', $5, $6, 'controller', $7::jsonb
          )
          ON CONFLICT ("code") DO UPDATE SET
            "entity" = EXCLUDED."entity",
            "entity_label" = EXCLUDED."entity_label",
            "entity_order" = EXCLUDED."entity_order",
            "purpose" = EXCLUDED."purpose",
            "purpose_label" = EXCLUDED."purpose_label",
            "purpose_order" = EXCLUDED."purpose_order",
            "operation" = EXCLUDED."operation",
            "operation_label" = EXCLUDED."operation_label",
            "operation_order" = EXCLUDED."operation_order",
            "action" = EXCLUDED."action",
            "scope" = EXCLUDED."scope",
            "description" = EXCLUDED."description",
            "is_dangerous" = EXCLUDED."is_dangerous",
            "source" = EXCLUDED."source",
            "default_roles" = EXCLUDED."default_roles",
            "updated_at" = now()
        `,
        [
          permission.code,
          permission.operation,
          permission.operationLabel,
          permission.operationOrder,
          permission.description,
          permission.isDangerous,
          JSON.stringify(DEFAULT_WORKSPACE_ROLES),
        ],
      );
    }

    await queryRunner.query(
      `
        INSERT INTO "role_permissions" ("role_id", "permission_id", "enabled")
        SELECT "role"."id", "permission"."id", true
        FROM "roles" AS "role"
        INNER JOIN "permissions" AS "permission"
          ON "permission"."code" = ANY($1::varchar[])
        WHERE "role"."scope" = 'workspace'
          AND "role"."workspace_id" IS NOT NULL
          AND "role"."name" = ANY($2::varchar[])
        ON CONFLICT ("role_id", "permission_id") DO UPDATE SET
          "enabled" = true,
          "updated_at" = now()
      `,
      [
        QUERY_RUN_PERMISSIONS.map((permission) => permission.code),
        [...DEFAULT_WORKSPACE_ROLES],
      ],
    );

    await queryRunner.query(`
      CREATE TABLE "analysis_query_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "schema_version" character varying(48) NOT NULL
          DEFAULT 'hermes.analytics.query-run/v1',
        "normalized_query" jsonb NOT NULL,
        "query_digest" character(64) NOT NULL,
        "source_key" character varying(128) NOT NULL,
        "source_revision" character varying(128) NOT NULL,
        "policy_revision" character varying(128) NOT NULL,
        "policy_digest" character(64),
        "requested_by_account_id" uuid NOT NULL,
        "principal_type" character varying(24) NOT NULL,
        "integration_token_id" uuid,
        "request_id" character varying(200) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'queued',
        "queued_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "started_at" TIMESTAMP WITH TIME ZONE,
        "waiting_at" TIMESTAMP WITH TIME ZONE,
        "cancelling_at" TIMESTAMP WITH TIME ZONE,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "succeeded_at" TIMESTAMP WITH TIME ZONE,
        "failed_at" TIMESTAMP WITH TIME ZONE,
        "timed_out_at" TIMESTAMP WITH TIME ZONE,
        "failure_code" character varying(128),
        "inline_result" jsonb,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_analysis_query_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_analysis_query_runs_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_analysis_query_runs_runtime_run"
          FOREIGN KEY ("workspace_id", "id")
          REFERENCES "runtime_runs"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_analysis_query_runs_requester"
          FOREIGN KEY ("requested_by_account_id") REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_analysis_query_runs_integration_token"
          FOREIGN KEY ("workspace_id", "integration_token_id")
          REFERENCES "integration_tokens"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_analysis_query_runs_schema_version"
          CHECK ("schema_version" = 'hermes.analytics.query-run/v1'),
        CONSTRAINT "CHK_analysis_query_runs_status"
          CHECK (
            "status" IN (
              'cancelled', 'cancelling', 'failed', 'queued',
              'running', 'succeeded', 'timedOut', 'waiting'
            )
          ),
        CONSTRAINT "CHK_analysis_query_runs_normalized_query"
          CHECK (jsonb_typeof("normalized_query") = 'object'),
        CONSTRAINT "CHK_analysis_query_runs_query_digest"
          CHECK ("query_digest" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_analysis_query_runs_policy_digest"
          CHECK (
            "policy_digest" IS NULL
            OR "policy_digest" ~ '^[a-f0-9]{64}$'
          ),
        CONSTRAINT "CHK_analysis_query_runs_source_key"
          CHECK ("source_key" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
        CONSTRAINT "CHK_analysis_query_runs_revisions"
          CHECK (
            length(btrim("source_revision")) BETWEEN 1 AND 128
            AND length(btrim("policy_revision")) BETWEEN 1 AND 128
          ),
        CONSTRAINT "CHK_analysis_query_runs_request_id"
          CHECK (length(btrim("request_id")) BETWEEN 1 AND 200),
        CONSTRAINT "CHK_analysis_query_runs_principal"
          CHECK (
            (
              "principal_type" = 'integration'
              AND "integration_token_id" IS NOT NULL
            ) OR (
              "principal_type" = 'workspace'
              AND "integration_token_id" IS NULL
            )
          ),
        CONSTRAINT "CHK_analysis_query_runs_inline_result"
          CHECK (
            "inline_result" IS NULL
            OR (
              "status" = 'succeeded'
              AND jsonb_typeof("inline_result") = 'object'
            )
          ),
        CONSTRAINT "CHK_analysis_query_runs_policy_state"
          CHECK ("status" <> 'succeeded' OR "policy_digest" IS NOT NULL),
        CONSTRAINT "CHK_analysis_query_runs_failure_state"
          CHECK (
            (
              "status" IN ('failed', 'timedOut')
              AND "failure_code" IS NOT NULL
            ) OR (
              "status" NOT IN ('failed', 'timedOut')
              AND "failure_code" IS NULL
            )
          ),
        CONSTRAINT "CHK_analysis_query_runs_terminal_state"
          CHECK (
            (
              "status" = 'cancelled'
              AND "cancelled_at" IS NOT NULL
              AND "succeeded_at" IS NULL
              AND "failed_at" IS NULL
              AND "timed_out_at" IS NULL
            ) OR (
              "status" = 'succeeded'
              AND "cancelled_at" IS NULL
              AND "succeeded_at" IS NOT NULL
              AND "failed_at" IS NULL
              AND "timed_out_at" IS NULL
            ) OR (
              "status" = 'failed'
              AND "cancelled_at" IS NULL
              AND "succeeded_at" IS NULL
              AND "failed_at" IS NOT NULL
              AND "timed_out_at" IS NULL
            ) OR (
              "status" = 'timedOut'
              AND "cancelled_at" IS NULL
              AND "succeeded_at" IS NULL
              AND "failed_at" IS NULL
              AND "timed_out_at" IS NOT NULL
            ) OR (
              "status" IN ('queued', 'running', 'waiting', 'cancelling')
              AND "cancelled_at" IS NULL
              AND "succeeded_at" IS NULL
              AND "failed_at" IS NULL
              AND "timed_out_at" IS NULL
            )
          ),
        CONSTRAINT "CHK_analysis_query_runs_active_state"
          CHECK (
            ("status" <> 'running' OR "started_at" IS NOT NULL)
            AND (
              "status" <> 'waiting'
              OR ("started_at" IS NOT NULL AND "waiting_at" IS NOT NULL)
            )
            AND (
              "status" <> 'cancelling'
              OR "cancelling_at" IS NOT NULL
            )
          ),
        CONSTRAINT "CHK_analysis_query_runs_timestamps"
          CHECK (
            ("started_at" IS NULL OR "started_at" >= "queued_at")
            AND ("waiting_at" IS NULL OR "waiting_at" >= "queued_at")
            AND ("cancelling_at" IS NULL OR "cancelling_at" >= "queued_at")
            AND ("cancelled_at" IS NULL OR "cancelled_at" >= "queued_at")
            AND ("succeeded_at" IS NULL OR "succeeded_at" >= "queued_at")
            AND ("failed_at" IS NULL OR "failed_at" >= "queued_at")
            AND ("timed_out_at" IS NULL OR "timed_out_at" >= "queued_at")
            AND "expires_at" > "queued_at"
          )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_analysis_query_runs_workspace_id"
      ON "analysis_query_runs" ("workspace_id", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_cec57a613c957f46c29399afea"
      ON "analysis_query_runs" ("workspace_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_analysis_query_runs_workspace_status_created"
      ON "analysis_query_runs" ("workspace_id", "status", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_analysis_query_runs_expiration"
      ON "analysis_query_runs" ("expires_at", "id")
      WHERE "status" IN ('cancelled', 'failed', 'succeeded', 'timedOut')
    `);

    await queryRunner.query(`
      CREATE TABLE "dataset_artifacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "query_run_id" uuid NOT NULL,
        "schema_version" character varying(48) NOT NULL
          DEFAULT 'hermes.analytics.dataset-artifact/v1',
        "status" character varying(24) NOT NULL DEFAULT 'pending',
        "lineage" jsonb,
        "result_schema" jsonb,
        "preview" jsonb,
        "row_count" integer,
        "byte_size" integer,
        "sha256" character(64),
        "file_object_id" uuid,
        "ready_at" TIMESTAMP WITH TIME ZONE,
        "failed_at" TIMESTAMP WITH TIME ZONE,
        "failure_code" character varying(128),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_dataset_artifacts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_dataset_artifacts_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_dataset_artifacts_query_run"
          FOREIGN KEY ("workspace_id", "query_run_id")
          REFERENCES "analysis_query_runs"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_dataset_artifacts_file_object"
          FOREIGN KEY ("workspace_id", "file_object_id")
          REFERENCES "file_objects"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_dataset_artifacts_schema_version"
          CHECK (
            "schema_version" = 'hermes.analytics.dataset-artifact/v1'
          ),
        CONSTRAINT "CHK_dataset_artifacts_status"
          CHECK ("status" IN ('expired', 'failed', 'pending', 'ready')),
        CONSTRAINT "CHK_dataset_artifacts_lineage"
          CHECK (
            "lineage" IS NULL OR (
              jsonb_typeof("lineage") = 'object'
              AND "lineage" ?& ARRAY[
                'generatedAt', 'policyDigest', 'queryDigest',
                'sourceKey', 'sourceRevision'
              ]
              AND jsonb_typeof("lineage"->'generatedAt') = 'string'
              AND jsonb_typeof("lineage"->'policyDigest') = 'string'
              AND ("lineage"->>'policyDigest') ~ '^[a-f0-9]{64}$'
              AND jsonb_typeof("lineage"->'queryDigest') = 'string'
              AND ("lineage"->>'queryDigest') ~ '^[a-f0-9]{64}$'
              AND jsonb_typeof("lineage"->'sourceKey') = 'string'
              AND jsonb_typeof("lineage"->'sourceRevision') = 'string'
            )
          ),
        CONSTRAINT "CHK_dataset_artifacts_result_schema"
          CHECK (
            "result_schema" IS NULL OR (
              jsonb_typeof("result_schema") = 'array'
              AND jsonb_array_length("result_schema") > 0
            )
          ),
        CONSTRAINT "CHK_dataset_artifacts_preview"
          CHECK (
            "preview" IS NULL OR (
              jsonb_typeof("preview") = 'array'
              AND jsonb_array_length("preview") <= 100
              AND pg_column_size("preview") <= 262144
            )
          ),
        CONSTRAINT "CHK_dataset_artifacts_counts"
          CHECK (
            ("row_count" IS NULL OR "row_count" >= 0)
            AND ("byte_size" IS NULL OR "byte_size" >= 0)
            AND (
              "preview" IS NULL
              OR "row_count" IS NULL
              OR jsonb_array_length("preview") <= "row_count"
            )
          ),
        CONSTRAINT "CHK_dataset_artifacts_sha256"
          CHECK ("sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_dataset_artifacts_ready_state"
          CHECK (
            (
              "status" = 'ready'
              AND "file_object_id" IS NOT NULL
              AND "lineage" IS NOT NULL
              AND "result_schema" IS NOT NULL
              AND "preview" IS NOT NULL
              AND "row_count" IS NOT NULL
              AND "byte_size" IS NOT NULL
              AND "sha256" IS NOT NULL
              AND "ready_at" IS NOT NULL
              AND "failed_at" IS NULL
              AND "failure_code" IS NULL
            ) OR (
              "status" = 'expired'
              AND "file_object_id" IS NULL
              AND "lineage" IS NOT NULL
              AND "result_schema" IS NOT NULL
              AND "preview" IS NULL
              AND "row_count" IS NOT NULL
              AND "byte_size" IS NOT NULL
              AND "sha256" IS NOT NULL
              AND "ready_at" IS NOT NULL
              AND "failed_at" IS NULL
              AND "failure_code" IS NULL
            ) OR (
              "status" = 'pending'
              AND "ready_at" IS NULL
              AND "failed_at" IS NULL
              AND "failure_code" IS NULL
            ) OR (
              "status" = 'failed'
              AND "ready_at" IS NULL
              AND "failed_at" IS NOT NULL
              AND "failure_code" IS NOT NULL
            )
          ),
        CONSTRAINT "CHK_dataset_artifacts_timestamps"
          CHECK (
            ("ready_at" IS NULL OR "ready_at" >= "created_at")
            AND ("failed_at" IS NULL OR "failed_at" >= "created_at")
            AND "expires_at" > "created_at"
          )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_dataset_artifacts_workspace_id"
      ON "dataset_artifacts" ("workspace_id", "id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_dataset_artifacts_workspace_query_run"
      ON "dataset_artifacts" ("workspace_id", "query_run_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_dataset_artifacts_workspace_file_object"
      ON "dataset_artifacts" ("workspace_id", "file_object_id")
      WHERE "file_object_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_5920e2d37623a20c7fe31e6842"
      ON "dataset_artifacts" ("workspace_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_dataset_artifacts_workspace_status_created"
      ON "dataset_artifacts" ("workspace_id", "status", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_dataset_artifacts_expiration"
      ON "dataset_artifacts" ("expires_at", "id")
      WHERE "status" IN ('failed', 'pending', 'ready')
    `);
  }

  async down(): Promise<void> {
    throw new Error(
      "AnalyticsQueryArtifacts2026072600001 cannot be rolled back safely while durable query runs, artifacts, or FileObjects may exist.",
    );
  }
}
