import type { MigrationInterface, QueryRunner } from "typeorm";

const DEFAULT_WORKSPACE_ROLES = ["workspace-owner", "workspace-admin"] as const;

const AGENT_PERMISSIONS = [
  permission("list", "查看智能助手", "查看当前工作空间的智能助手目录。", 10),
  permission("create", "创建智能助手", "在当前工作空间创建智能助手及初始草稿。", 20),
  permission("read", "查看智能助手详情", "读取当前工作空间的智能助手详情。", 30),
  permission("update", "更新智能助手", "更新当前工作空间智能助手的名称、说明与状态。", 40),
  permission("read_draft", "查看智能助手草稿", "读取当前工作空间智能助手的可编辑草稿。", 50),
  permission("update_draft", "保存智能助手草稿", "使用修订检查替换当前工作空间的智能助手草稿。", 60),
  permission("list_versions", "查看智能助手版本", "查看当前工作空间智能助手的已发布版本。", 70),
  permission("publish", "发布智能助手版本", "从经过验证的草稿发布不可变智能助手版本。", 80),
  permission("read_version", "查看智能助手版本详情", "读取当前工作空间的指定智能助手版本。", 90),
  {
    action: "access",
    code: "page.agents.access:workspace",
    description: "允许设计、保存和发布当前工作空间的智能助手。",
    entity: "navigation",
    entityLabel: "菜单和页面",
    entityOrder: 0,
    isDangerous: false,
    operation: "agents",
    operationLabel: "Agent Studio",
    operationOrder: 30,
    purpose: "page_access",
    purposeLabel: "页面访问",
    purposeOrder: 0,
    source: "navigation",
  },
] as const;

export class AgentStudio2026072500005 implements MigrationInterface {
  name = "AgentStudio2026072500005";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "description" character varying(2000) NOT NULL DEFAULT '',
        "status" character varying(24) NOT NULL DEFAULT 'active',
        "revision" integer NOT NULL DEFAULT 1,
        "latest_version" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_agents" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agents_workspace_name" UNIQUE ("workspace_id", "name"),
        CONSTRAINT "UQ_agents_workspace_id_id" UNIQUE ("workspace_id", "id"),
        CONSTRAINT "FK_agents_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_agents_revision" CHECK ("revision" > 0),
        CONSTRAINT "CHK_agents_latest_version" CHECK ("latest_version" >= 0),
        CONSTRAINT "CHK_agents_status" CHECK ("status" IN ('active', 'archived'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_agents_workspace_status" ON "agents" ("workspace_id", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "agent_drafts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "api_version" character varying(32) NOT NULL DEFAULT 'hermes.ai/v1',
        "workspace_id" uuid NOT NULL,
        "agent_id" uuid NOT NULL,
        "revision" integer NOT NULL DEFAULT 1,
        "graph" jsonb NOT NULL,
        "model_references" jsonb NOT NULL,
        "tool_references" jsonb NOT NULL,
        CONSTRAINT "PK_agent_drafts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_drafts_workspace_agent" UNIQUE ("workspace_id", "agent_id"),
        CONSTRAINT "FK_agent_drafts_agent"
          FOREIGN KEY ("workspace_id", "agent_id")
          REFERENCES "agents"("workspace_id", "id") ON DELETE CASCADE,
        CONSTRAINT "CHK_agent_drafts_revision" CHECK ("revision" > 0),
        CONSTRAINT "CHK_agent_drafts_api_version"
          CHECK ("api_version" = 'hermes.ai/v1'),
        CONSTRAINT "CHK_agent_drafts_json_shapes" CHECK (
          jsonb_typeof("graph") = 'object'
          AND jsonb_typeof("model_references") = 'array'
          AND jsonb_typeof("tool_references") = 'array'
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "api_version" character varying(32) NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agent_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "draft_revision" integer NOT NULL,
        "content_digest" character(64) NOT NULL,
        "graph" jsonb NOT NULL,
        "model_references" jsonb NOT NULL,
        "tool_references" jsonb NOT NULL,
        CONSTRAINT "PK_agent_versions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_versions_workspace_agent_version"
          UNIQUE ("workspace_id", "agent_id", "version"),
        CONSTRAINT "UQ_agent_versions_workspace_agent_draft_revision"
          UNIQUE ("workspace_id", "agent_id", "draft_revision"),
        CONSTRAINT "FK_agent_versions_agent"
          FOREIGN KEY ("workspace_id", "agent_id")
          REFERENCES "agents"("workspace_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_agent_versions_version" CHECK ("version" > 0),
        CONSTRAINT "CHK_agent_versions_api_version"
          CHECK ("api_version" = 'hermes.ai/v1'),
        CONSTRAINT "CHK_agent_versions_draft_revision" CHECK ("draft_revision" > 0),
        CONSTRAINT "CHK_agent_versions_digest"
          CHECK ("content_digest" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_agent_versions_json_shapes" CHECK (
          jsonb_typeof("graph") = 'object'
          AND jsonb_typeof("model_references") = 'array'
          AND jsonb_typeof("tool_references") = 'array'
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_versions_agent_published" ON "agent_versions" ("workspace_id", "agent_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE FUNCTION prevent_agent_version_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'published Agent versions are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_agent_versions_immutable"
      BEFORE UPDATE OR DELETE ON "agent_versions"
      FOR EACH ROW EXECUTE FUNCTION prevent_agent_version_mutation()
    `);

    for (const definition of AGENT_PERMISSIONS) {
      await queryRunner.query(
        `
          INSERT INTO "permissions" (
            "code", "entity", "entity_label", "entity_order", "purpose",
            "purpose_label", "purpose_order", "operation", "operation_label",
            "operation_order", "action", "scope", "description", "is_dangerous",
            "source", "default_roles"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, 'workspace', $12, $13, $14, $15::jsonb
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
          definition.code,
          definition.entity,
          definition.entityLabel,
          definition.entityOrder,
          definition.purpose,
          definition.purposeLabel,
          definition.purposeOrder,
          definition.operation,
          definition.operationLabel,
          definition.operationOrder,
          definition.action,
          definition.description,
          definition.isDangerous,
          definition.source,
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
        AGENT_PERMISSIONS.map((definition) => definition.code),
        [...DEFAULT_WORKSPACE_ROLES],
      ],
    );
  }

  async down(): Promise<void> {
    throw new Error(
      "AgentStudio2026072500005 cannot be rolled back safely. Export Agent Drafts and Versions before removing their schema and permissions.",
    );
  }
}

function permission(
  operation: string,
  operationLabel: string,
  description: string,
  operationOrder: number,
) {
  return {
    action: operation,
    code: `agent.ai_configuration.${operation}:workspace`,
    description,
    entity: "agent",
    entityLabel: "智能助手",
    entityOrder: 70,
    isDangerous: operation === "publish",
    operation,
    operationLabel,
    operationOrder,
    purpose: "ai_configuration",
    purposeLabel: "AI 配置",
    purposeOrder: 30,
    source: "controller",
  } as const;
}
