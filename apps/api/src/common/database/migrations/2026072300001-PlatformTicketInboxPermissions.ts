import type { MigrationInterface, QueryRunner } from "typeorm";

type PermissionSeed = {
  action: string;
  code: string;
  description?: string;
  entity?: string;
  entityLabel?: string;
  entityOrder?: number;
  label: string;
  operation: string;
  operationOrder?: number;
  purpose?: string;
  purposeLabel?: string;
  purposeOrder?: number;
  source?: string;
};

const PLATFORM_TICKET_PERMISSIONS: readonly PermissionSeed[] = [
  {
    action: "upload",
    code: "file.image_upload.upload:platform",
    entity: "file",
    entityLabel: "文件",
    entityOrder: 95,
    label: "上传平台图片",
    operation: "upload",
    purpose: "image_upload",
    purposeLabel: "图片上传",
    purposeOrder: 10,
  },
  {
    action: "list",
    code: "ticket.conversation.list:platform",
    label: "查看平台工单",
    operation: "list",
  },
  {
    action: "view",
    code: "ticket.conversation.view:platform",
    label: "查看平台工单详情",
    operation: "view",
  },
  {
    action: "list_messages",
    code: "ticket.conversation.list_messages:platform",
    label: "查看平台工单消息",
    operation: "list_messages",
  },
  {
    action: "send_message",
    code: "ticket.conversation.send_message:platform",
    label: "回复平台工单",
    operation: "send_message",
  },
  {
    action: "close",
    code: "ticket.conversation.close:platform",
    label: "关闭平台工单",
    operation: "close",
  },
  {
    action: "mark_read",
    code: "ticket.conversation.mark_read:platform",
    label: "标记平台工单已读",
    operation: "mark_read",
  },
  {
    action: "access",
    code: "page.platform.tickets.access:platform",
    description: "允许访问平台工单和平台运营会话页面。",
    entity: "navigation",
    entityLabel: "菜单和页面",
    entityOrder: 0,
    label: "工单",
    operation: "platform.tickets",
    operationOrder: 10,
    purpose: "page_access",
    purposeLabel: "页面访问",
    purposeOrder: 0,
    source: "navigation",
  },
];

/** Makes the platform-wide ticket inbox available to existing Platform Admins. */
export class PlatformTicketInboxPermissions2026072300001
  implements MigrationInterface
{
  name = "PlatformTicketInboxPermissions2026072300001";

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const permission of PLATFORM_TICKET_PERMISSIONS) {
      const entity = permission.entity ?? "ticket";
      const entityLabel = permission.entityLabel ?? "工单";
      const entityOrder = permission.entityOrder ?? 90;
      const purpose = permission.purpose ?? "conversation";
      const purposeLabel = permission.purposeLabel ?? "工单会话";
      const purposeOrder = permission.purposeOrder ?? null;
      const operationOrder = permission.operationOrder ?? null;
      const source = permission.source ?? "controller";
      await queryRunner.query(
        `
          INSERT INTO "permissions" (
            "code", "entity", "entity_label", "entity_order", "purpose",
            "purpose_label", "purpose_order", "operation", "operation_label",
            "operation_order", "action", "scope", "description", "is_dangerous",
            "source", "default_roles"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'platform', $12,
            false, $13, $14::jsonb
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
          entity,
          entityLabel,
          entityOrder,
          purpose,
          purposeLabel,
          purposeOrder,
          permission.operation,
          permission.label,
          operationOrder,
          permission.action,
          permission.description ?? null,
          source,
          JSON.stringify(["platform-admin"]),
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
        WHERE "role"."name" = 'platform-admin'
          AND "role"."scope" = 'platform'
          AND "role"."workspace_id" IS NULL
        ON CONFLICT ("role_id", "permission_id") DO UPDATE SET
          "enabled" = true,
          "updated_at" = now()
      `,
      [PLATFORM_TICKET_PERMISSIONS.map((permission) => permission.code)],
    );
  }

  async down(): Promise<void> {
    throw new Error(
      "PlatformTicketInboxPermissions2026072300001 cannot be rolled back safely. Remove the platform ticket permissions through role management after confirming they are unused.",
    );
  }
}
