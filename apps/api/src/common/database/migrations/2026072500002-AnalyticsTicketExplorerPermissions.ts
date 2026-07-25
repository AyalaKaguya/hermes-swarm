import type { MigrationInterface, QueryRunner } from "typeorm";

const DEFAULT_WORKSPACE_ROLES = ["workspace-owner", "workspace-admin"] as const;

const ANALYTICS_PERMISSIONS = [
  {
    action: "describe",
    code: "analytics.ticket_dataset.describe:workspace",
    description: "查看当前工作空间可分析的工单状态与时间字段。",
    entity: "analytics",
    entityLabel: "数据分析",
    entityOrder: 80,
    operation: "describe",
    operationLabel: "查看工单数据集",
    operationOrder: 10,
    purpose: "ticket_dataset",
    purposeLabel: "工单数据集",
    purposeOrder: 10,
    source: "controller",
  },
  {
    action: "query",
    code: "analytics.ticket_dataset.query:workspace",
    description: "在当前工作空间内执行受限的工单统计查询。",
    entity: "analytics",
    entityLabel: "数据分析",
    entityOrder: 80,
    operation: "query",
    operationLabel: "查询工单数据",
    operationOrder: 20,
    purpose: "ticket_dataset",
    purposeLabel: "工单数据集",
    purposeOrder: 10,
    source: "controller",
  },
  {
    action: "access",
    code: "page.analytics.access:workspace",
    description: "允许访问当前工作空间的受限数据分析页面。",
    entity: "navigation",
    entityLabel: "菜单和页面",
    entityOrder: 0,
    operation: "analytics",
    operationLabel: "数据分析",
    operationOrder: 20,
    purpose: "page_access",
    purposeLabel: "页面访问",
    purposeOrder: 0,
    source: "navigation",
  },
] as const;

/** Backfills the first analytics dataset and its page access for existing workspaces. */
export class AnalyticsTicketExplorerPermissions2026072500002
  implements MigrationInterface
{
  name = "AnalyticsTicketExplorerPermissions2026072500002";

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const permission of ANALYTICS_PERMISSIONS) {
      await queryRunner.query(
        `
          INSERT INTO "permissions" (
            "code", "entity", "entity_label", "entity_order", "purpose",
            "purpose_label", "purpose_order", "operation", "operation_label",
            "operation_order", "action", "scope", "description", "is_dangerous",
            "source", "default_roles"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'workspace',
            $12, false, $13, $14::jsonb
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
          permission.entity,
          permission.entityLabel,
          permission.entityOrder,
          permission.purpose,
          permission.purposeLabel,
          permission.purposeOrder,
          permission.operation,
          permission.operationLabel,
          permission.operationOrder,
          permission.action,
          permission.description,
          permission.source,
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
        ANALYTICS_PERMISSIONS.map((permission) => permission.code),
        [...DEFAULT_WORKSPACE_ROLES],
      ],
    );
  }

  async down(): Promise<void> {
    throw new Error(
      "AnalyticsTicketExplorerPermissions2026072500002 cannot be rolled back safely. Remove analytics permissions through role management after confirming they are unused.",
    );
  }
}
