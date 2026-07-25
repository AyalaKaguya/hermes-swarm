import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  type AnalysisFilter,
  type AnalysisMeasure,
  type AnalysisQuery,
  type DatasetFieldDescriptor,
  type DatasetResultField,
  type DatasetScalarType,
  type DatasetSchema,
} from "@hermes-swarm/api-contracts/analytics";
import { Ticket } from "@hermes-swarm/core";
import type { Repository, SelectQueryBuilder } from "typeorm";
import { analyticsDigest } from "./analytics-digest.js";
import { AnalyticsQueryError } from "./analytics-query.error.js";
import type {
  AnalyticsAdapterResult,
  AnalyticsExecutionContext,
  AnalyticsScalar,
  AnalyticsSourceAdapter,
} from "./analytics-source.adapter.js";
import { AnalyticsSourceRegistry } from "./analytics-source.registry.js";
import {
  SUPPORT_TICKET_FIELD_COLUMNS,
  SUPPORT_TICKETS_DATASET_SCHEMA,
  SUPPORT_TICKETS_POLICY_REVISION,
  SUPPORT_TICKETS_QUERY_PERMISSION,
  SUPPORT_TICKETS_SOURCE_KEY,
  SUPPORT_TICKETS_SOURCE_REVISION,
  type SupportTicketAnalyticsField,
} from "./support-tickets-analytics.constants.js";

type TicketQueryBuilder = SelectQueryBuilder<Ticket>;

@Injectable()
export class SupportTicketsAnalyticsAdapter
  implements AnalyticsSourceAdapter, OnModuleInit, OnModuleDestroy
{
  readonly kind = "typeorm-support-tickets";
  private unregister: (() => void) | null = null;

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    private readonly sourceRegistry: AnalyticsSourceRegistry,
  ) {}

  onModuleInit() {
    this.unregister = this.sourceRegistry.register({
      adapter: this,
      policyRevision: SUPPORT_TICKETS_POLICY_REVISION,
      requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
      sourceKey: SUPPORT_TICKETS_SOURCE_KEY,
    });
  }

  onModuleDestroy() {
    this.unregister?.();
    this.unregister = null;
  }

  async describe(
    _context: AnalyticsExecutionContext,
    sourceKey: string,
    signal: AbortSignal,
  ): Promise<DatasetSchema> {
    throwIfAborted(signal);
    if (sourceKey !== SUPPORT_TICKETS_SOURCE_KEY) {
      throw new AnalyticsQueryError(
        "ANALYTICS_SOURCE_NOT_FOUND",
        "Analytics source was not found.",
      );
    }
    return SUPPORT_TICKETS_DATASET_SCHEMA;
  }

  async execute(
    context: AnalyticsExecutionContext,
    query: AnalysisQuery,
    signal: AbortSignal,
  ): Promise<AnalyticsAdapterResult> {
    throwIfAborted(signal);
    assertSource(query);

    const queryBuilder = this.ticketRepository.createQueryBuilder("ticket");
    // This predicate is deliberately present on every query. Neither the
    // request body nor a cursor can replace the trusted workspace value.
    queryBuilder.where("ticket.workspace_id = :workspaceId", {
      workspaceId: context.workspaceId,
    });
    applyFilters(queryBuilder, query.filters);

    const fields = datasetFields();
    const aggregate = query.groupBy.length > 0 || query.measures.length > 0;
    const measureExpressions = aggregate
      ? applyAggregateProjection(queryBuilder, query)
      : applyRowProjection(queryBuilder, query);
    applySort(queryBuilder, query, aggregate, measureExpressions);

    const offset = decodeCursor(query.page.cursor, context, query);
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
          ? encodeCursor(context, query, offset + query.page.size)
          : null,
      },
      rows,
      schema: resultSchema,
      truncated: false,
    };
  }
}

function assertSource(query: AnalysisQuery) {
  if (
    query.sourceKey !== SUPPORT_TICKETS_SOURCE_KEY ||
    query.sourceRevision !== SUPPORT_TICKETS_SOURCE_REVISION
  ) {
    throw new AnalyticsQueryError(
      "ANALYTICS_SOURCE_REVISION_MISMATCH",
      "Analytics source revision has changed.",
    );
  }
}

function applyFilters(
  queryBuilder: TicketQueryBuilder,
  filters: readonly AnalysisFilter[],
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
        // No field in this source advertises string search capabilities.
        throw new AnalyticsQueryError(
          "ANALYTICS_FILTER_INVALID",
          `Filter operator is unavailable for field ${filter.field}.`,
        );
    }
  });
}

function applyRowProjection(
  queryBuilder: TicketQueryBuilder,
  query: AnalysisQuery,
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
  queryBuilder: TicketQueryBuilder,
  query: AnalysisQuery,
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
  queryBuilder: TicketQueryBuilder,
  selections: readonly { alias: string; expression: string }[],
) {
  selections.forEach(({ alias, expression }, index) => {
    if (index === 0) queryBuilder.select(expression, alias);
    else queryBuilder.addSelect(expression, alias);
  });
}

function measureExpression(measure: AnalysisMeasure) {
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
      throw new AnalyticsQueryError(
        "ANALYTICS_AGGREGATION_INVALID",
        `Aggregation ${measure.aggregation} is unavailable for this source.`,
      );
  }
}

function applySort(
  queryBuilder: TicketQueryBuilder,
  query: AnalysisQuery,
  aggregate: boolean,
  measureExpressions: ReadonlyMap<string, string>,
) {
  let sortIndex = 0;
  const add = (expression: string, direction: "ASC" | "DESC") => {
    if (sortIndex++ === 0) queryBuilder.orderBy(expression, direction);
    else queryBuilder.addOrderBy(expression, direction);
  };

  for (const sort of query.sort) {
    const expression = measureExpressions.get(sort.field) ?? requireColumn(sort.field);
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
    SUPPORT_TICKETS_DATASET_SCHEMA.fields.map((field) => [field.key, field]),
  );
}

function buildResultSchema(
  query: AnalysisQuery,
  fields: ReadonlyMap<string, DatasetFieldDescriptor>,
): DatasetResultField[] {
  if (query.groupBy.length === 0 && query.measures.length === 0) {
    return query.select.map((field) => toResultField(requireDatasetField(fields, field)));
  }
  return [
    ...query.groupBy.map((field) =>
      toResultField(requireDatasetField(fields, field)),
    ),
    ...query.measures.map((measure) => {
      const source = measure.field
        ? requireDatasetField(fields, measure.field)
        : null;
      return {
        key: measure.as,
        label: measure.as,
        nullable: measure.aggregation !== "count",
        scalarType: measure.aggregation === "count"
          ? "number" as const
          : source!.scalarType,
      };
    }),
  ];
}

function toResultField(field: DatasetFieldDescriptor): DatasetResultField {
  return {
    ...(field.format ? { format: field.format } : {}),
    key: field.key,
    label: field.label,
    nullable: field.nullable,
    scalarType: field.scalarType,
    ...(field.semanticType ? { semanticType: field.semanticType } : {}),
  };
}

function normalizeRow(
  raw: Readonly<Record<string, unknown>>,
  schema: readonly DatasetResultField[],
): Readonly<Record<string, AnalyticsScalar>> {
  return Object.fromEntries(
    schema.map((field) => [
      field.key,
      normalizeValue(raw[field.key], field.scalarType, field.nullable),
    ]),
  );
}

function normalizeValue(
  value: unknown,
  scalarType: DatasetScalarType,
  nullable: boolean,
): AnalyticsScalar {
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
  return new AnalyticsQueryError(
    "ANALYTICS_RESULT_INVALID",
    "Analytics adapter returned an invalid ticket result.",
  );
}

function requireColumn(field: string): string {
  const column = SUPPORT_TICKET_FIELD_COLUMNS[
    field as SupportTicketAnalyticsField
  ];
  if (!column) {
    throw new AnalyticsQueryError(
      "ANALYTICS_FIELD_UNKNOWN",
      `Analytics field ${field} is not available.`,
    );
  }
  return column;
}

function requireDatasetField(
  fields: ReadonlyMap<string, DatasetFieldDescriptor>,
  field: string,
) {
  const descriptor = fields.get(field);
  if (!descriptor) {
    throw new AnalyticsQueryError(
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
  context: AnalyticsExecutionContext,
  query: AnalysisQuery,
  offset: number,
) {
  const payload: CursorPayload = {
    offset,
    queryDigest: cursorQueryDigest(query),
    scopeDigest: cursorScopeDigest(context),
    version: 1,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(
  cursor: string | undefined,
  context: AnalyticsExecutionContext,
  query: AnalysisQuery,
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
      payload.scopeDigest !== cursorScopeDigest(context)
    ) {
      throw new Error("invalid cursor payload");
    }
    return payload.offset!;
  } catch {
    throw new AnalyticsQueryError(
      "ANALYTICS_QUERY_INVALID",
      "Analytics cursor is invalid.",
    );
  }
}

function cursorQueryDigest(query: AnalysisQuery) {
  return analyticsDigest({
    ...query,
    page: { size: query.page.size },
  });
}

function cursorScopeDigest(context: AnalyticsExecutionContext) {
  return analyticsDigest({
    sourceKey: SUPPORT_TICKETS_SOURCE_KEY,
    workspaceId: context.workspaceId,
  });
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
}
