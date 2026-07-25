import {
  ANALYTICS_DATASET_VERSION,
  type DatasetFieldDescriptor,
  type DatasetSchema,
} from "@hermes-swarm/api-contracts/analytics";
import { getOperationPermissionId } from "@hermes-swarm/rbac-api";

export const SUPPORT_TICKETS_SOURCE_KEY = "support.tickets" as const;
export const SUPPORT_TICKETS_SOURCE_REVISION = "support.tickets/v1" as const;
export const SUPPORT_TICKETS_POLICY_REVISION = "support.tickets-policy:v1" as const;

export const SUPPORT_TICKETS_DESCRIBE_PERMISSION = getOperationPermissionId(
  "analytics",
  "ticket_dataset",
  "describe",
  "workspace",
);

export const SUPPORT_TICKETS_QUERY_PERMISSION = getOperationPermissionId(
  "analytics",
  "ticket_dataset",
  "query",
  "workspace",
);

export type SupportTicketAnalyticsField =
  | "archivedAt"
  | "createdAt"
  | "handlerClosedAt"
  | "lastMessageAt"
  | "requesterClosedAt"
  | "status"
  | "updatedAt";

export const SUPPORT_TICKET_FIELD_COLUMNS = Object.freeze({
  archivedAt: "ticket.archived_at",
  createdAt: "ticket.created_at",
  handlerClosedAt: "ticket.handler_closed_at",
  lastMessageAt: "ticket.last_message_at",
  requesterClosedAt: "ticket.requester_closed_at",
  status: "ticket.status",
  updatedAt: "ticket.updated_at",
} satisfies Record<SupportTicketAnalyticsField, string>);

const statusField = {
  capabilities: {
    aggregations: ["count"],
    filterOperators: ["eq", "neq", "in", "notIn"],
    groupable: true,
    selectable: true,
    sortable: true,
  },
  enumValues: [
    { label: "处理中", value: "open" },
    { label: "已关闭", value: "closed" },
    { label: "已归档", value: "archived" },
  ],
  key: "status",
  label: "工单状态",
  nullable: false,
  scalarType: "enum",
  semanticType: "category",
} satisfies DatasetFieldDescriptor;

function datetimeField(
  key: Exclude<SupportTicketAnalyticsField, "status">,
  label: string,
  nullable: boolean,
): DatasetFieldDescriptor {
  return {
    capabilities: {
      aggregations: ["count", "min", "max"],
      filterOperators: [
        "eq",
        "neq",
        "in",
        "notIn",
        "gt",
        "gte",
        "lt",
        "lte",
        ...(nullable ? ["isNull", "isNotNull"] as const : []),
      ],
      groupable: true,
      selectable: true,
      sortable: true,
    },
    format: { type: "datetime" },
    key,
    label,
    nullable,
    scalarType: "datetime",
  };
}

export const SUPPORT_TICKETS_DATASET_SCHEMA = Object.freeze({
  description: "当前工作空间内工单的状态与生命周期时间统计，不包含正文或账号信息。",
  fields: [
    statusField,
    datetimeField("createdAt", "创建时间", false),
    datetimeField("updatedAt", "更新时间", false),
    datetimeField("lastMessageAt", "最后消息时间", true),
    datetimeField("requesterClosedAt", "提交者关闭时间", true),
    datetimeField("handlerClosedAt", "处理者关闭时间", true),
    datetimeField("archivedAt", "归档时间", true),
  ],
  schemaVersion: ANALYTICS_DATASET_VERSION,
  sourceKey: SUPPORT_TICKETS_SOURCE_KEY,
  sourceRevision: SUPPORT_TICKETS_SOURCE_REVISION,
  title: "工单统计",
} satisfies DatasetSchema);
