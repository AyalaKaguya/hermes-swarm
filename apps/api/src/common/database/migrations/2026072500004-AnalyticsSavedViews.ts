import type { MigrationInterface, QueryRunner } from "typeorm";

const DEFAULT_WORKSPACE_ROLES = ["workspace-owner", "workspace-admin"] as const;

const SAVED_VIEW_PERMISSIONS = [
  {
    action: "list",
    code: "analytics.saved_view.list:workspace",
    description: "查看当前工作空间保存的分析视图。",
    isDangerous: false,
    operation: "list",
    operationLabel: "查看分析视图",
    operationOrder: 10,
  },
  {
    action: "read",
    code: "analytics.saved_view.read:workspace",
    description: "读取当前工作空间内的指定分析视图。",
    isDangerous: false,
    operation: "read",
    operationLabel: "读取分析视图",
    operationOrder: 20,
  },
  {
    action: "create",
    code: "analytics.saved_view.create:workspace",
    description: "在当前工作空间保存分析查询与可视化。",
    isDangerous: false,
    operation: "create",
    operationLabel: "创建分析视图",
    operationOrder: 30,
  },
  {
    action: "update",
    code: "analytics.saved_view.update:workspace",
    description: "使用版本检查更新当前工作空间的分析视图。",
    isDangerous: false,
    operation: "update",
    operationLabel: "更新分析视图",
    operationOrder: 40,
  },
  {
    action: "delete",
    code: "analytics.saved_view.delete:workspace",
    description: "使用版本检查删除当前工作空间的分析视图。",
    isDangerous: true,
    operation: "delete",
    operationLabel: "删除分析视图",
    operationOrder: 50,
  },
] as const;

export class AnalyticsSavedViews2026072500004 implements MigrationInterface {
  name = "AnalyticsSavedViews2026072500004";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "analysis_views" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "dataset_id" character varying(128) NOT NULL,
        "query" jsonb NOT NULL,
        "visualization" jsonb NOT NULL,
        "revision" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_analysis_views" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_analysis_views_workspace_id" UNIQUE ("workspace_id", "id"),
        CONSTRAINT "UQ_analysis_views_workspace_name" UNIQUE ("workspace_id", "name"),
        CONSTRAINT "FK_analysis_views_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_analysis_views_revision" CHECK ("revision" > 0),
        CONSTRAINT "CHK_analysis_views_query_object"
          CHECK (jsonb_typeof("query") = 'object'),
        CONSTRAINT "CHK_analysis_views_visualization_object"
          CHECK (jsonb_typeof("visualization") = 'object')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_1332aaca515799f40af74ac9dc" ON "analysis_views" ("workspace_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_analysis_views_workspace_updated" ON "analysis_views" ("workspace_id", "updated_at")`,
    );

    for (const permission of SAVED_VIEW_PERMISSIONS) {
      await queryRunner.query(
        `
          INSERT INTO "permissions" (
            "code", "entity", "entity_label", "entity_order", "purpose",
            "purpose_label", "purpose_order", "operation", "operation_label",
            "operation_order", "action", "scope", "description", "is_dangerous",
            "source", "default_roles"
          )
          VALUES (
            $1, 'analytics', '数据分析', 80, 'saved_view', '分析视图', 20,
            $2, $3, $4, $5, 'workspace', $6, $7, 'controller', $8::jsonb
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
          permission.action,
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
        SAVED_VIEW_PERMISSIONS.map((permission) => permission.code),
        [...DEFAULT_WORKSPACE_ROLES],
      ],
    );
  }

  async down(): Promise<void> {
    throw new Error(
      "AnalyticsSavedViews2026072500004 cannot be rolled back safely. Export saved views and remove their permissions explicitly before dropping the table.",
    );
  }
}
