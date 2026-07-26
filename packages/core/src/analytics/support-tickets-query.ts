import { createHash } from "node:crypto";
import {
  ANALYTICS_DATASET_VERSION,
  type DatasetFieldDescriptor,
  type DatasetSchema,
} from "@hermes-swarm/api-contracts/analytics";

export const SUPPORT_TICKETS_QUERY_SOURCE_KEY = "support.tickets" as const;
export const SUPPORT_TICKETS_QUERY_SOURCE_REVISION =
  "support.tickets/v1" as const;
export const SUPPORT_TICKETS_QUERY_POLICY_REVISION =
  "support.tickets-policy:v1" as const;

type QueryScalar = string | number | boolean;

export type SupportTicketsQueryFilter =
  | Readonly<{ field: string; operator: "eq" | "neq"; value: QueryScalar }>
  | Readonly<{
      field: string;
      operator: "in" | "notIn";
      value: readonly QueryScalar[];
    }>
  | Readonly<{
      field: string;
      operator: "contains" | "startsWith";
      value: string;
    }>
  | Readonly<{
      field: string;
      operator: "gt" | "gte" | "lt" | "lte";
      value: QueryScalar;
    }>
  | Readonly<{ field: string; operator: "isNull" | "isNotNull" }>;

export type SupportTicketsQueryMeasure =
  | Readonly<{
      aggregation: "count";
      as: string;
      field?: string;
    }>
  | Readonly<{
      aggregation: "avg" | "countDistinct" | "max" | "min" | "sum";
      as: string;
      field: string;
    }>;

export type SupportTicketsQuery = Readonly<{
  filters: readonly SupportTicketsQueryFilter[];
  groupBy: readonly string[];
  measures: readonly SupportTicketsQueryMeasure[];
  page: Readonly<{
    cursor?: string;
    size: number;
  }>;
  schemaVersion: string;
  select: readonly string[];
  sort: readonly Readonly<{
    direction: "asc" | "desc";
    field: string;
  }>[];
  sourceKey: string;
  sourceRevision: string;
}>;

export type SupportTicketsQueryErrorCode =
  | "ANALYTICS_AGGREGATION_INVALID"
  | "ANALYTICS_CONTEXT_REQUIRED"
  | "ANALYTICS_FIELD_UNKNOWN"
  | "ANALYTICS_FILTER_INVALID"
  | "ANALYTICS_QUERY_INVALID"
  | "ANALYTICS_RESULT_INVALID"
  | "ANALYTICS_SOURCE_REVISION_MISMATCH";

export class SupportTicketsQueryError extends Error {
  constructor(
    readonly code: SupportTicketsQueryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SupportTicketsQueryError";
  }
}

export type SupportTicketsQueryBuilder = {
  addGroupBy(expression: string): SupportTicketsQueryBuilder;
  addOrderBy(
    expression: string,
    direction: "ASC" | "DESC",
  ): SupportTicketsQueryBuilder;
  addSelect(
    expression: string,
    alias: string,
  ): SupportTicketsQueryBuilder;
  andWhere(
    expression: string,
    parameters?: Record<string, unknown>,
  ): SupportTicketsQueryBuilder;
  getRawMany<T = Record<string, unknown>>(): Promise<T[]>;
  groupBy(expression: string): SupportTicketsQueryBuilder;
  limit(value: number): SupportTicketsQueryBuilder;
  offset(value: number): SupportTicketsQueryBuilder;
  orderBy(
    expression: string,
    direction: "ASC" | "DESC",
  ): SupportTicketsQueryBuilder;
  select(expression: string, alias: string): SupportTicketsQueryBuilder;
  where(
    expression: string,
    parameters?: Record<string, unknown>,
  ): SupportTicketsQueryBuilder;
};

export type SupportTicketsQueryResultField = Readonly<{
  format?: Readonly<{ type: "datetime" }>;
  key: string;
  label: string;
  nullable: boolean;
  scalarType: "datetime" | "enum" | "number";
  semanticType?: "category";
}>;

export type SupportTicketsQueryScalar = boolean | number | string | null;

export type SupportTicketsQueryResult = Readonly<{
  pageInfo: Readonly<{
    hasMore: boolean;
    nextCursor: string | null;
  }>;
  rows: ReadonlyArray<
    Readonly<Record<string, SupportTicketsQueryScalar>>
  >;
  schema: readonly SupportTicketsQueryResultField[];
  truncated: false;
}>;

export type ExecuteSupportTicketsQueryOptions = Readonly<{
  createQueryBuilder: () => SupportTicketsQueryBuilder;
  query: SupportTicketsQuery;
  signal: AbortSignal;
  workspaceId: string;
}>;

type SupportTicketField =
  | "archivedAt"
  | "createdAt"
  | "handlerClosedAt"
  | "lastMessageAt"
  | "requesterClosedAt"
  | "status"
  | "updatedAt";

const SUPPORT_TICKET_FIELD_COLUMNS = Object.freeze({
  archivedAt: "ticket.archived_at",
  createdAt: "ticket.created_at",
  handlerClosedAt: "ticket.handler_closed_at",
  lastMessageAt: "ticket.last_message_at",
  requesterClosedAt: "ticket.requester_closed_at",
  status: "ticket.status",
  updatedAt: "ticket.updated_at",
} satisfies Record<SupportTicketField, string>);

const SUPPORT_TICKET_RESULT_FIELDS = Object.freeze([
  {
    key: "status",
    label: "工单状态",
    nullable: false,
    scalarType: "enum",
    semanticType: "category",
  },
  datetimeField("createdAt", "创建时间", false),
  datetimeField("updatedAt", "更新时间", false),
  datetimeField("lastMessageAt", "最后消息时间", true),
  datetimeField("requesterClosedAt", "提交者关闭时间", true),
  datetimeField("handlerClosedAt", "处理者关闭时间", true),
  datetimeField("archivedAt", "归档时间", true),
] satisfies readonly SupportTicketsQueryResultField[]);

const supportTicketStatusField = {
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

export const SUPPORT_TICKETS_QUERY_DATASET_SCHEMA = Object.freeze({
  description: "当前工作空间内工单的状态与生命周期时间统计，不包含正文或账号信息。",
  fields: [
    supportTicketStatusField,
    datasetDatetimeField("createdAt", "创建时间", false),
    datasetDatetimeField("updatedAt", "更新时间", false),
    datasetDatetimeField("lastMessageAt", "最后消息时间", true),
    datasetDatetimeField("requesterClosedAt", "提交者关闭时间", true),
    datasetDatetimeField("handlerClosedAt", "处理者关闭时间", true),
    datasetDatetimeField("archivedAt", "归档时间", true),
  ],
  schemaVersion: ANALYTICS_DATASET_VERSION,
  sourceKey: SUPPORT_TICKETS_QUERY_SOURCE_KEY,
  sourceRevision: SUPPORT_TICKETS_QUERY_SOURCE_REVISION,
  title: "工单统计",
} satisfies DatasetSchema);

/**
 * Executes the support ticket analytics query against a caller-owned query
 * builder. The trusted workspace predicate is installed here so neither a
 * request query nor a cursor can weaken tenant isolation.
 */
export async function executeSupportTicketsQuery({
  createQueryBuilder,
  query,
  signal,
  workspaceId,
}: ExecuteSupportTicketsQueryOptions): Promise<SupportTicketsQueryResult> {
  throwIfAborted(signal);
  assertWorkspaceId(workspaceId);
  assertSource(query);

  const queryBuilder = createQueryBuilder();
  queryBuilder.where("ticket.workspace_id = :workspaceId", { workspaceId });
  applyFilters(queryBuilder, query.filters);

  const fields = datasetFields();
  const aggregate = query.groupBy.length > 0 || query.measures.length > 0;
  const measureExpressions = aggregate
    ? applyAggregateProjection(queryBuilder, query)
    : applyRowProjection(queryBuilder, query);
  applySort(queryBuilder, query, aggregate, measureExpressions);

  const offset = decodeCursor(query.page.cursor, workspaceId, query);
  queryBuilder.offset(offset).limit(query.page.size + 1);
  const rawRows = await queryBuilder.getRawMany<Record<string, unknown>>();
  throwIfAborted(signal);

  const hasMore = rawRows.length > query.page.size;
  const resultSchema = buildResultSchema(query, fields);
  const rows = rawRows
    .slice(0, query.page.size)
    .map((row) => normalizeRow(row, resultSchema));

  return {
    pageInfo: {
      hasMore,
      nextCursor: hasMore
        ? encodeCursor(workspaceId, query, offset + query.page.size)
        : null,
    },
    rows,
    schema: resultSchema,
    truncated: false,
  };
}

function datetimeField(
  key: Exclude<SupportTicketField, "status">,
  label: string,
  nullable: boolean,
): SupportTicketsQueryResultField {
  return {
    format: { type: "datetime" },
    key,
    label,
    nullable,
    scalarType: "datetime",
  };
}

function datasetDatetimeField(
  key: Exclude<SupportTicketField, "status">,
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
        ...(nullable ? (["isNull", "isNotNull"] as const) : []),
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

function assertWorkspaceId(workspaceId: string) {
  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    throw new SupportTicketsQueryError(
      "ANALYTICS_CONTEXT_REQUIRED",
      "A trusted workspace context is required.",
    );
  }
}

function assertSource(query: SupportTicketsQuery) {
  if (
    query.sourceKey !== SUPPORT_TICKETS_QUERY_SOURCE_KEY ||
    query.sourceRevision !== SUPPORT_TICKETS_QUERY_SOURCE_REVISION
  ) {
    throw new SupportTicketsQueryError(
      "ANALYTICS_SOURCE_REVISION_MISMATCH",
      "Analytics source revision has changed.",
    );
  }
}

function applyFilters(
  queryBuilder: SupportTicketsQueryBuilder,
  filters: readonly SupportTicketsQueryFilter[],
) {
  filters.forEach((filter, index) => {
    const column = requireColumn(filter.field);
    const parameter = `analytics_filter_${index}`;
    switch (filter.operator) {
      case "isNull":
        queryBuilder.andWhere(`${column} IS NULL`);
        return;
      case "isNotNull":
        queryBuilder.andWhere(`${column} IS NOT NULL`);
        return;
      case "eq":
        queryBuilder.andWhere(`${column} = :${parameter}`, {
          [parameter]: filter.value,
        });
        return;
      case "neq":
        queryBuilder.andWhere(`${column} <> :${parameter}`, {
          [parameter]: filter.value,
        });
        return;
      case "in":
        queryBuilder.andWhere(`${column} IN (:...${parameter})`, {
          [parameter]: filter.value,
        });
        return;
      case "notIn":
        queryBuilder.andWhere(`${column} NOT IN (:...${parameter})`, {
          [parameter]: filter.value,
        });
        return;
      case "gt":
        queryBuilder.andWhere(`${column} > :${parameter}`, {
          [parameter]: filter.value,
        });
        return;
      case "gte":
        queryBuilder.andWhere(`${column} >= :${parameter}`, {
          [parameter]: filter.value,
        });
        return;
      case "lt":
        queryBuilder.andWhere(`${column} < :${parameter}`, {
          [parameter]: filter.value,
        });
        return;
      case "lte":
        queryBuilder.andWhere(`${column} <= :${parameter}`, {
          [parameter]: filter.value,
        });
        return;
      case "contains":
      case "startsWith":
        throw new SupportTicketsQueryError(
          "ANALYTICS_FILTER_INVALID",
          `Filter operator is unavailable for field ${filter.field}.`,
        );
    }
  });
}

function applyRowProjection(
  queryBuilder: SupportTicketsQueryBuilder,
  query: SupportTicketsQuery,
): ReadonlyMap<string, string> {
  addSelections(
    queryBuilder,
    query.select.map((field) => ({
      alias: field,
      expression: requireColumn(field),
    })),
  );
  return new Map();
}

function applyAggregateProjection(
  queryBuilder: SupportTicketsQueryBuilder,
  query: SupportTicketsQuery,
): ReadonlyMap<string, string> {
  const groupSelections = query.groupBy.map((field) => ({
    alias: field,
    expression: requireColumn(field),
  }));
  const measureExpressions = new Map(
    query.measures.map((measure) => [measure.as, measureExpression(measure)]),
  );
  addSelections(queryBuilder, [
    ...groupSelections,
    ...query.measures.map((measure) => ({
      alias: measure.as,
      expression: measureExpressions.get(measure.as)!,
    })),
  ]);
  groupSelections.forEach(({ expression }, index) => {
    if (index === 0) queryBuilder.groupBy(expression);
    else queryBuilder.addGroupBy(expression);
  });
  return measureExpressions;
}

function addSelections(
  queryBuilder: SupportTicketsQueryBuilder,
  selections: readonly { alias: string; expression: string }[],
) {
  selections.forEach(({ alias, expression }, index) => {
    if (index === 0) queryBuilder.select(expression, alias);
    else queryBuilder.addSelect(expression, alias);
  });
}

function measureExpression(measure: SupportTicketsQueryMeasure) {
  const column = measure.field ? requireColumn(measure.field) : null;
  switch (measure.aggregation) {
    case "count":
      return column ? `COUNT(${column})` : "COUNT(*)";
    case "min":
      return `MIN(${column!})`;
    case "max":
      return `MAX(${column!})`;
    case "countDistinct":
    case "sum":
    case "avg":
      throw new SupportTicketsQueryError(
        "ANALYTICS_AGGREGATION_INVALID",
        `Aggregation ${measure.aggregation} is unavailable for this source.`,
      );
  }
}

function applySort(
  queryBuilder: SupportTicketsQueryBuilder,
  query: SupportTicketsQuery,
  aggregate: boolean,
  measureExpressions: ReadonlyMap<string, string>,
) {
  let sortIndex = 0;
  const add = (expression: string, direction: "ASC" | "DESC") => {
    if (sortIndex++ === 0) queryBuilder.orderBy(expression, direction);
    else queryBuilder.addOrderBy(expression, direction);
  };

  for (const sort of query.sort) {
    const expression =
      measureExpressions.get(sort.field) ?? requireColumn(sort.field);
    add(expression, sort.direction === "asc" ? "ASC" : "DESC");
  }

  if (sortIndex === 0 && aggregate) {
    query.groupBy.forEach((field) => add(requireColumn(field), "ASC"));
  }
  if (sortIndex === 0 && !aggregate) {
    add(SUPPORT_TICKET_FIELD_COLUMNS.updatedAt, "DESC");
  }
  if (!aggregate) add("ticket.id", "DESC");
}

function datasetFields() {
  return new Map(
    SUPPORT_TICKET_RESULT_FIELDS.map((field) => [field.key, field]),
  );
}

function buildResultSchema(
  query: SupportTicketsQuery,
  fields: ReadonlyMap<string, SupportTicketsQueryResultField>,
): SupportTicketsQueryResultField[] {
  if (query.groupBy.length === 0 && query.measures.length === 0) {
    return query.select.map((field) => requireDatasetField(fields, field));
  }
  return [
    ...query.groupBy.map((field) => requireDatasetField(fields, field)),
    ...query.measures.map((measure): SupportTicketsQueryResultField => {
      const source = measure.field
        ? requireDatasetField(fields, measure.field)
        : null;
      return {
        key: measure.as,
        label: measure.as,
        nullable: measure.aggregation !== "count",
        scalarType:
          measure.aggregation === "count" ? "number" : source!.scalarType,
      };
    }),
  ];
}

function normalizeRow(
  raw: Readonly<Record<string, unknown>>,
  schema: readonly SupportTicketsQueryResultField[],
): Readonly<Record<string, SupportTicketsQueryScalar>> {
  return Object.fromEntries(
    schema.map((field) => [
      field.key,
      normalizeValue(raw[field.key], field.scalarType, field.nullable),
    ]),
  );
}

function normalizeValue(
  value: unknown,
  scalarType: SupportTicketsQueryResultField["scalarType"],
  nullable: boolean,
): SupportTicketsQueryScalar {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw invalidResult();
  }
  if (scalarType === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) throw invalidResult();
    return number;
  }
  if (scalarType === "datetime") {
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw invalidResult();
    return date.toISOString();
  }
  if (typeof value !== "string") throw invalidResult();
  return value;
}

function invalidResult() {
  return new SupportTicketsQueryError(
    "ANALYTICS_RESULT_INVALID",
    "Analytics adapter returned an invalid ticket result.",
  );
}

function requireColumn(field: string): string {
  const column =
    SUPPORT_TICKET_FIELD_COLUMNS[field as SupportTicketField];
  if (!column) {
    throw new SupportTicketsQueryError(
      "ANALYTICS_FIELD_UNKNOWN",
      `Analytics field ${field} is not available.`,
    );
  }
  return column;
}

function requireDatasetField(
  fields: ReadonlyMap<string, SupportTicketsQueryResultField>,
  field: string,
) {
  const descriptor = fields.get(field);
  if (!descriptor) {
    throw new SupportTicketsQueryError(
      "ANALYTICS_FIELD_UNKNOWN",
      `Analytics field ${field} is not available.`,
    );
  }
  return descriptor;
}

type CursorPayload = Readonly<{
  offset: number;
  queryDigest: string;
  scopeDigest: string;
  version: 1;
}>;

function encodeCursor(
  workspaceId: string,
  query: SupportTicketsQuery,
  offset: number,
) {
  const payload: CursorPayload = {
    offset,
    queryDigest: cursorQueryDigest(query),
    scopeDigest: cursorScopeDigest(workspaceId),
    version: 1,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(
  cursor: string | undefined,
  workspaceId: string,
  query: SupportTicketsQuery,
) {
  if (!cursor) return 0;
  try {
    const payload = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<CursorPayload>;
    if (
      payload.version !== 1 ||
      !Number.isSafeInteger(payload.offset) ||
      (payload.offset ?? -1) < 0 ||
      payload.queryDigest !== cursorQueryDigest(query) ||
      payload.scopeDigest !== cursorScopeDigest(workspaceId)
    ) {
      throw new Error("invalid cursor payload");
    }
    return payload.offset!;
  } catch {
    throw new SupportTicketsQueryError(
      "ANALYTICS_QUERY_INVALID",
      "Analytics cursor is invalid.",
    );
  }
}

function cursorQueryDigest(query: SupportTicketsQuery) {
  return analyticsDigest({
    ...query,
    page: { size: query.page.size },
  });
}

function cursorScopeDigest(workspaceId: string) {
  return analyticsDigest({
    sourceKey: SUPPORT_TICKETS_QUERY_SOURCE_KEY,
    workspaceId,
  });
}

function analyticsDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
}
