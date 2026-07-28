import type { MigrationInterface, QueryRunner } from "typeorm";

export class AiConversationPersistence2026072800001
  implements MigrationInterface
{
  name = "AiConversationPersistence2026072800001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_versions_workspace_id"
      ON "agent_versions" ("workspace_id", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "ai_conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "schema_version" character varying(48) NOT NULL
          DEFAULT 'hermes.ai-conversation/v1',
        "owner_account_id" uuid NOT NULL,
        "agent_version_id" uuid NOT NULL,
        "title" character varying(240) NOT NULL DEFAULT '',
        "status" character varying(24) NOT NULL DEFAULT 'active',
        "message_sequence" integer NOT NULL DEFAULT 0,
        "last_message_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_ai_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_conversations_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_ai_conversations_owner"
          FOREIGN KEY ("workspace_id", "owner_account_id")
          REFERENCES "user_workspace_roles"("workspace_id", "user_id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_ai_conversations_agent_version"
          FOREIGN KEY ("workspace_id", "agent_version_id")
          REFERENCES "agent_versions"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_ai_conversations_schema_version"
          CHECK ("schema_version" = 'hermes.ai-conversation/v1'),
        CONSTRAINT "CHK_ai_conversations_status"
          CHECK ("status" IN ('active', 'archived')),
        CONSTRAINT "CHK_ai_conversations_message_sequence"
          CHECK ("message_sequence" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_conversations_workspace_id"
      ON "ai_conversations" ("workspace_id", "id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_conversations_workspace_owner_id"
      ON "ai_conversations" ("workspace_id", "owner_account_id", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_ai_conversations_owner_updated"
      ON "ai_conversations" ("workspace_id", "owner_account_id", "updated_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "ai_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "schema_version" character varying(48) NOT NULL
          DEFAULT 'hermes.ai-message/v1',
        "conversation_id" uuid NOT NULL,
        "sequence" integer NOT NULL,
        "role" character varying(24) NOT NULL,
        "status" character varying(24) NOT NULL,
        "content" text,
        "reply_to_message_id" uuid,
        "runtime_run_id" uuid,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "failure_code" character varying(160),
        CONSTRAINT "PK_ai_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_messages_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_ai_messages_conversation"
          FOREIGN KEY ("workspace_id", "conversation_id")
          REFERENCES "ai_conversations"("workspace_id", "id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_ai_messages_runtime_run"
          FOREIGN KEY ("workspace_id", "runtime_run_id")
          REFERENCES "runtime_runs"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_ai_messages_schema_version"
          CHECK ("schema_version" = 'hermes.ai-message/v1'),
        CONSTRAINT "CHK_ai_messages_sequence" CHECK ("sequence" > 0),
        CONSTRAINT "CHK_ai_messages_role_status" CHECK (
          (
            "role" = 'user'
            AND "status" = 'completed'
            AND "content" IS NOT NULL
            AND "runtime_run_id" IS NULL
            AND "reply_to_message_id" IS NULL
            AND "started_at" IS NULL
            AND "finished_at" IS NOT NULL
            AND "failure_code" IS NULL
          ) OR (
            "role" = 'assistant'
            AND "status" IN (
              'cancelled', 'cancelling', 'failed', 'queued',
              'running', 'succeeded', 'timedOut', 'waiting'
            )
            AND "runtime_run_id" IS NOT NULL
            AND "id" = "runtime_run_id"
            AND "reply_to_message_id" IS NOT NULL
          )
        ),
        CONSTRAINT "CHK_ai_messages_assistant_terminal" CHECK (
          "role" <> 'assistant' OR (
            (
              "status" IN ('cancelled', 'failed', 'succeeded', 'timedOut')
              AND "finished_at" IS NOT NULL
            ) OR (
              "status" IN ('cancelling', 'queued', 'running', 'waiting')
              AND "finished_at" IS NULL
            )
          )
        ),
        CONSTRAINT "CHK_ai_messages_assistant_content" CHECK (
          "role" <> 'assistant' OR (
            ("status" = 'succeeded' AND "content" IS NOT NULL)
            OR ("status" = 'queued' AND "content" IS NULL)
            OR "status" IN (
              'cancelled', 'cancelling', 'failed',
              'running', 'timedOut', 'waiting'
            )
          )
        ),
        CONSTRAINT "CHK_ai_messages_failure" CHECK (
          (
            "role" = 'assistant'
            AND "status" IN ('failed', 'timedOut')
            AND "failure_code" IS NOT NULL
          ) OR (
            NOT (
              "role" = 'assistant'
              AND "status" IN ('failed', 'timedOut')
            )
            AND "failure_code" IS NULL
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_messages_workspace_id"
      ON "ai_messages" ("workspace_id", "id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_messages_workspace_conversation_id"
      ON "ai_messages" ("workspace_id", "conversation_id", "id")
    `);
    await queryRunner.query(`
      ALTER TABLE "ai_messages"
      ADD CONSTRAINT "FK_ai_messages_reply"
      FOREIGN KEY (
        "workspace_id", "conversation_id", "reply_to_message_id"
      ) REFERENCES "ai_messages"(
        "workspace_id", "conversation_id", "id"
      ) ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_messages_workspace_conversation_sequence"
      ON "ai_messages" ("workspace_id", "conversation_id", "sequence")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_messages_workspace_runtime_run"
      ON "ai_messages" ("workspace_id", "runtime_run_id")
      WHERE "runtime_run_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_ai_messages_conversation_created"
      ON "ai_messages" ("workspace_id", "conversation_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "ai_message_files" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "message_id" uuid NOT NULL,
        "file_object_id" uuid NOT NULL,
        "ordinal" smallint NOT NULL,
        CONSTRAINT "PK_ai_message_files" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_message_files_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_ai_message_files_message"
          FOREIGN KEY ("workspace_id", "message_id")
          REFERENCES "ai_messages"("workspace_id", "id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_ai_message_files_file_object"
          FOREIGN KEY ("workspace_id", "file_object_id")
          REFERENCES "file_objects"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_ai_message_files_ordinal"
          CHECK ("ordinal" >= 0 AND "ordinal" < 20)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_message_files_workspace_file"
      ON "ai_message_files" ("workspace_id", "file_object_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_message_files_workspace_message_file"
      ON "ai_message_files" ("workspace_id", "message_id", "file_object_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_message_files_workspace_message_ordinal"
      ON "ai_message_files" ("workspace_id", "message_id", "ordinal")
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_execution_requests" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "schema_version" character varying(64) NOT NULL
          DEFAULT 'hermes.agent-execution-request/v1',
        "owner_account_id" uuid NOT NULL,
        "session_id" uuid NOT NULL,
        "client_request_id" uuid NOT NULL,
        "request_digest" character(64) NOT NULL,
        "conversation_id" uuid NOT NULL,
        "user_message_id" uuid NOT NULL,
        "assistant_message_id" uuid NOT NULL,
        "agent_version_id" uuid NOT NULL,
        "graph_content_digest" character(64) NOT NULL,
        "input" jsonb NOT NULL,
        "history_snapshot" jsonb NOT NULL,
        "model_reference_intent" jsonb NOT NULL,
        "resolved_model_reference" jsonb NOT NULL,
        "output_node_id" character varying(128) NOT NULL,
        CONSTRAINT "PK_agent_execution_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agent_execution_requests_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_execution_requests_runtime_run"
          FOREIGN KEY ("workspace_id", "id")
          REFERENCES "runtime_runs"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_execution_requests_owner"
          FOREIGN KEY ("workspace_id", "owner_account_id")
          REFERENCES "user_workspace_roles"("workspace_id", "user_id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_execution_requests_conversation"
          FOREIGN KEY (
            "workspace_id", "owner_account_id", "conversation_id"
          ) REFERENCES "ai_conversations"(
            "workspace_id", "owner_account_id", "id"
          ) ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_execution_requests_user_message"
          FOREIGN KEY (
            "workspace_id", "conversation_id", "user_message_id"
          ) REFERENCES "ai_messages"(
            "workspace_id", "conversation_id", "id"
          ) ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_execution_requests_assistant_message"
          FOREIGN KEY (
            "workspace_id", "conversation_id", "assistant_message_id"
          ) REFERENCES "ai_messages"(
            "workspace_id", "conversation_id", "id"
          ) ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_execution_requests_agent_version"
          FOREIGN KEY ("workspace_id", "agent_version_id")
          REFERENCES "agent_versions"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_agent_execution_requests_schema_version"
          CHECK (
            "schema_version" = 'hermes.agent-execution-request/v1'
          ),
        CONSTRAINT "CHK_agent_execution_requests_request_digest"
          CHECK ("request_digest" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_agent_execution_requests_graph_digest"
          CHECK ("graph_content_digest" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_agent_execution_requests_json_shapes" CHECK (
          jsonb_typeof("input") = 'object'
          AND jsonb_typeof("history_snapshot") = 'array'
          AND jsonb_typeof("model_reference_intent") = 'object'
          AND jsonb_typeof("resolved_model_reference") = 'object'
        ),
        CONSTRAINT "CHK_agent_execution_requests_output_node"
          CHECK ("output_node_id" ~ '^[A-Za-z][A-Za-z0-9._:-]*$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_execution_requests_workspace_id"
      ON "agent_execution_requests" ("workspace_id", "id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX
        "UQ_agent_execution_requests_workspace_owner_client_request"
      ON "agent_execution_requests" (
        "workspace_id", "owner_account_id", "client_request_id"
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_execution_requests_workspace_assistant"
      ON "agent_execution_requests" ("workspace_id", "assistant_message_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_execution_requests_owner_created"
      ON "agent_execution_requests" (
        "workspace_id", "owner_account_id", "created_at"
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "ai_artifacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "schema_version" character varying(48) NOT NULL
          DEFAULT 'hermes.ai-artifact/v1',
        "conversation_id" uuid NOT NULL,
        "message_id" uuid NOT NULL,
        "execution_request_id" uuid NOT NULL,
        "ordinal" smallint NOT NULL,
        "type" character varying(24) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'pending',
        "title" character varying(500) NOT NULL,
        "inline_payload" jsonb,
        "file_object_id" uuid,
        "ready_at" TIMESTAMP WITH TIME ZONE,
        "failed_at" TIMESTAMP WITH TIME ZONE,
        "failure_code" character varying(160),
        CONSTRAINT "PK_ai_artifacts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_artifacts_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_ai_artifacts_conversation"
          FOREIGN KEY ("workspace_id", "conversation_id")
          REFERENCES "ai_conversations"("workspace_id", "id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_ai_artifacts_message"
          FOREIGN KEY ("workspace_id", "conversation_id", "message_id")
          REFERENCES "ai_messages"("workspace_id", "conversation_id", "id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_ai_artifacts_execution_request"
          FOREIGN KEY ("workspace_id", "execution_request_id")
          REFERENCES "agent_execution_requests"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_ai_artifacts_file_object"
          FOREIGN KEY ("workspace_id", "file_object_id")
          REFERENCES "file_objects"("workspace_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_ai_artifacts_schema_version"
          CHECK ("schema_version" = 'hermes.ai-artifact/v1'),
        CONSTRAINT "CHK_ai_artifacts_type"
          CHECK ("type" IN ('chart', 'file', 'json', 'table', 'text')),
        CONSTRAINT "CHK_ai_artifacts_status"
          CHECK ("status" IN ('failed', 'pending', 'ready')),
        CONSTRAINT "CHK_ai_artifacts_ordinal" CHECK ("ordinal" >= 0),
        CONSTRAINT "CHK_ai_artifacts_lifecycle" CHECK (
          (
            "status" = 'pending'
            AND "inline_payload" IS NULL
            AND "ready_at" IS NULL
            AND "failed_at" IS NULL
            AND "failure_code" IS NULL
          ) OR (
            "status" = 'ready'
            AND (("inline_payload" IS NULL) <> ("file_object_id" IS NULL))
            AND "ready_at" IS NOT NULL
            AND "failed_at" IS NULL
            AND "failure_code" IS NULL
          ) OR (
            "status" = 'failed'
            AND "ready_at" IS NULL
            AND "failed_at" IS NOT NULL
            AND "failure_code" IS NOT NULL
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_artifacts_workspace_id"
      ON "ai_artifacts" ("workspace_id", "id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_artifacts_workspace_execution_ordinal"
      ON "ai_artifacts" ("workspace_id", "execution_request_id", "ordinal")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_artifacts_workspace_file"
      ON "ai_artifacts" ("workspace_id", "file_object_id")
      WHERE "file_object_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_ai_artifacts_message_created"
      ON "ai_artifacts" ("workspace_id", "message_id", "created_at")
    `);
  }

  async down(): Promise<void> {
    throw new Error(
      "AiConversationPersistence2026072800001 cannot be rolled back safely while conversations, messages, execution requests, artifacts, or FileObjects may exist.",
    );
  }
}
