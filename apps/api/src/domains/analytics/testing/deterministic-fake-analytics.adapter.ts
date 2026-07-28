import {
  ANALYTICS_DATASET_VERSION,
  type AnalysisFilter,
  type AnalysisMeasure,
  type AnalysisQuery,
  type DatasetFieldDescriptor,
  type DatasetResultField,
  type DatasetResultRow,
  type DatasetSchema,
} from "@hermes-swarm/api-contracts/analytics";
import { canonicalJson } from "../analytics-digest.js";
import type {
  AnalyticsAdapterResult,
  AnalyticsExecutionContext,
  AnalyticsScalar,
  AnalyticsSourceAdapter,
} from "../analytics-source.adapter.js";

export type FakeAnalyticsDataset = Readonly<{
  rowsByWorkspace: Readonly<Record<string, readonly DatasetResultRow[]>>;
  schema: DatasetSchema;
}>;

export type DeterministicFakeAnalyticsOptions = Readonly<{
  delayMs?: number;
  deniedWorkspaces?: ReadonlySet<string>;
  error?: Error;
  truncateAfterRows?: number;
}>;

export const FAKE_SUPPORT_TICKETS_SCHEMA = Object.freeze({
  fields: [
    {
      capabilities: {
        aggregations: ["count", "countDistinct"],
        filterOperators: ["eq", "neq", "in", "notIn", "isNull", "isNotNull"],
        groupable: true,
        selectable: true,
        sortable: true,
      },
      enumValues: [
        { label: "Open", value: "open" },
        { label: "In progress", value: "in_progress" },
        { label: "Closed", value: "closed" },
      ],
      key: "status",
      label: "Status",
      nullable: false,
      scalarType: "enum",
      semanticType: "category",
    },
    {
      capabilities: {
        aggregations: ["count", "countDistinct", "min", "max"],
        filterOperators: [
          "eq",
          "neq",
          "in",
          "notIn",
          "gt",
          "gte",
          "lt",
          "lte",
          "isNull",
          "isNotNull",
        ],
        groupable: true,
        selectable: true,
        sortable: true,
      },
      format: { type: "datetime" },
      key: "createdAt",
      label: "Created at",
      nullable: false,
      scalarType: "datetime",
    },
    {
      capabilities: {
        aggregations: ["count", "countDistinct", "min", "max"],
        filterOperators: [
          "eq",
          "neq",
          "in",
          "notIn",
          "gt",
          "gte",
          "lt",
          "lte",
          "isNull",
          "isNotNull",
        ],
        groupable: true,
        selectable: true,
        sortable: true,
      },
      format: { type: "datetime" },
      key: "closedAt",
      label: "Closed at",
      nullable: true,
      scalarType: "datetime",
    },
    {
      capabilities: {
        aggregations: ["count", "countDistinct", "sum", "avg", "min", "max"],
        filterOperators: [
          "eq",
          "neq",
          "in",
          "notIn",
          "gt",
          "gte",
          "lt",
          "lte",
          "isNull",
          "isNotNull",
        ],
        groupable: false,
        selectable: true,
        sortable: true,
      },
      format: { maximumFractionDigits: 0, type: "number" },
      key: "resolutionMinutes",
      label: "Resolution time",
      nullable: true,
      scalarType: "number",
      semanticType: "duration",
    },
  ],
  schemaVersion: ANALYTICS_DATASET_VERSION,
  sourceKey: "support.tickets",
  sourceRevision: "fake-support-tickets-v1",
  title: "Support tickets",
} satisfies DatasetSchema);

export const FAKE_SUPPORT_TICKETS_DATASET: FakeAnalyticsDataset = Object.freeze({
  rowsByWorkspace: Object.freeze({
    "workspace-a": Object.freeze([
      Object.freeze({
        closedAt: null,
        createdAt: "2026-07-01T08:00:00.000Z",
        resolutionMinutes: null,
        status: "open",
      }),
      Object.freeze({
        closedAt: "2026-07-02T10:00:00.000Z",
        createdAt: "2026-07-02T08:00:00.000Z",
        resolutionMinutes: 120,
        status: "closed",
      }),
      Object.freeze({
        closedAt: null,
        createdAt: "2026-07-03T08:00:00.000Z",
        resolutionMinutes: null,
        status: "in_progress",
      }),
    ]),
    "workspace-b": Object.freeze([
      Object.freeze({
        closedAt: "2026-07-11T09:00:00.000Z",
        createdAt: "2026-07-11T08:00:00.000Z",
        resolutionMinutes: 60,
        status: "closed",
      }),
    ]),
  }),
  schema: FAKE_SUPPORT_TICKETS_SCHEMA,
});

/** Deterministic in-memory adapter used by contract and gateway tests only. */
export class DeterministicFakeAnalyticsAdapter implements AnalyticsSourceAdapter {
  readonly kind = "fake";
  private readonly datasets: ReadonlyMap<string, FakeAnalyticsDataset>;

  constructor(
    datasets: readonly FakeAnalyticsDataset[] = [FAKE_SUPPORT_TICKETS_DATASET],
    private readonly options: DeterministicFakeAnalyticsOptions = {},
  ) {
    this.datasets = new Map(datasets.map((dataset) => [dataset.schema.sourceKey, dataset]));
  }

  async describe(
    context: AnalyticsExecutionContext,
    sourceKey: string,
    signal: AbortSignal,
  ): Promise<DatasetSchema> {
    await this.beforeOperation(context, signal);
    return this.requireDataset(sourceKey).schema;
  }

  async execute(
    context: AnalyticsExecutionContext,
    query: AnalysisQuery,
    signal: AbortSignal,
  ): Promise<AnalyticsAdapterResult> {
    await this.beforeOperation(context, signal);
    const dataset = this.requireDataset(query.sourceKey);
    const fields = new Map(dataset.schema.fields.map((field) => [field.key, field]));
    const workspaceRows = dataset.rowsByWorkspace[context.workspaceId] ?? [];
    const filtered = workspaceRows.filter((row) =>
      query.filters.every((filter) => matchesFilter(row, filter)),
    );
    const aggregated = query.groupBy.length > 0 || query.measures.length > 0
      ? aggregateRows(filtered, query)
      : filtered.map((row) => projectRow(row, query.select));
    const sorted = sortRows(aggregated, query.sort);
    const truncateAfter = normalizeTruncateAfter(this.options.truncateAfterRows);
    const truncatedRows = truncateAfter === null ? sorted : sorted.slice(0, truncateAfter);
    const truncated = truncateAfter !== null && sorted.length > truncatedRows.length;
    const offset = decodeCursor(query.page.cursor, query.sourceKey, context.workspaceId);
    const pageRows = truncatedRows.slice(offset, offset + query.page.size);
    const hasMore = offset + pageRows.length < truncatedRows.length;

    return {
      pageInfo: {
        hasMore,
        nextCursor: hasMore
          ? encodeCursor(query.sourceKey, context.workspaceId, offset + pageRows.length)
          : null,
      },
      rows: pageRows,
      schema: resultSchema(query, fields),
      truncated,
    };
  }

  private async beforeOperation(
    context: AnalyticsExecutionContext,
    signal: AbortSignal,
  ) {
    if (this.options.deniedWorkspaces?.has(context.workspaceId)) {
      throw new Error("fake source denied");
    }
    if (this.options.error) throw this.options.error;
    await abortableDelay(this.options.delayMs ?? 0, signal);
  }

  private requireDataset(sourceKey: string): FakeAnalyticsDataset {
    const dataset = this.datasets.get(sourceKey);
    if (!dataset) throw new Error("fake source not found");
    return dataset;
  }
}

function matchesFilter(row: DatasetResultRow, filter: AnalysisFilter): boolean {
  const actual = row[filter.field] ?? null;
  switch (filter.operator) {
    case "isNull":
      return actual === null;
    case "isNotNull":
      return actual !== null;
    case "eq":
      return actual === filter.value;
    case "neq":
      return actual !== filter.value;
    case "in":
      return filter.value.includes(actual as string | number | boolean);
    case "notIn":
      return !filter.value.includes(actual as string | number | boolean);
    case "contains":
      return typeof actual === "string" && actual.includes(filter.value);
    case "startsWith":
      return typeof actual === "string" && actual.startsWith(filter.value);
    case "gt":
      return compareScalars(actual, filter.value) > 0;
    case "gte":
      return compareScalars(actual, filter.value) >= 0;
    case "lt":
      return compareScalars(actual, filter.value) < 0;
    case "lte":
      return compareScalars(actual, filter.value) <= 0;
  }
}

function aggregateRows(
  rows: readonly DatasetResultRow[],
  query: AnalysisQuery,
): DatasetResultRow[] {
  const groups = new Map<string, { keys: AnalyticsScalar[]; rows: DatasetResultRow[] }>();
  if (query.groupBy.length === 0) groups.set("[]", { keys: [], rows: [] });
  for (const row of rows) {
    const keys = query.groupBy.map((key) => row[key] ?? null);
    const digest = canonicalJson(keys);
    const group = groups.get(digest) ?? { keys, rows: [] };
    group.rows.push(row);
    groups.set(digest, group);
  }

  return [...groups.values()].map((group) => {
    const result: DatasetResultRow = {};
    query.groupBy.forEach((key, index) => {
      result[key] = group.keys[index] ?? null;
    });
    for (const measure of query.measures) {
      result[measure.as] = aggregateMeasure(group.rows, measure);
    }
    return result;
  });
}

function aggregateMeasure(
  rows: readonly DatasetResultRow[],
  measure: AnalysisMeasure,
): AnalyticsScalar {
  const values = measure.field
    ? rows.map((row) => row[measure.field!] ?? null).filter(notNull)
    : rows.map(() => 1);
  switch (measure.aggregation) {
    case "count":
      return values.length;
    case "countDistinct":
      return new Set(values.map(canonicalJson)).size;
    case "sum": {
      const numbers = values.filter(isNumber);
      return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0);
    }
    case "avg": {
      const numbers = values.filter(isNumber);
      return numbers.length === 0
        ? null
        : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    }
    case "min":
      return extrema(values, "min");
    case "max":
      return extrema(values, "max");
  }
}

function extrema(values: readonly AnalyticsScalar[], direction: "min" | "max") {
  if (values.length === 0) return null;
  return values.slice(1).reduce((selected, value) => {
    const comparison = compareScalars(value, selected);
    return direction === "min"
      ? comparison < 0 ? value : selected
      : comparison > 0 ? value : selected;
  }, values[0]!);
}

function projectRow(row: DatasetResultRow, keys: readonly string[]): DatasetResultRow {
  return Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
}

function sortRows(
  rows: readonly DatasetResultRow[],
  sorts: AnalysisQuery["sort"],
): DatasetResultRow[] {
  if (sorts.length === 0) return [...rows];
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const comparison = compareScalars(left[sort.field] ?? null, right[sort.field] ?? null);
      if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}

function compareScalars(left: AnalyticsScalar, right: AnalyticsScalar) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function resultSchema(
  query: AnalysisQuery,
  fields: ReadonlyMap<string, DatasetFieldDescriptor>,
): DatasetResultField[] {
  if (query.groupBy.length === 0 && query.measures.length === 0) {
    return query.select.map((key) => toResultField(fields.get(key)!));
  }
  return [
    ...query.groupBy.map((key) => toResultField(fields.get(key)!)),
    ...query.measures.map((measure) => {
      const source = measure.field ? fields.get(measure.field)! : null;
      const scalarType = ["count", "countDistinct", "sum", "avg"].includes(
        measure.aggregation,
      )
        ? "number" as const
        : source!.scalarType;
      return {
        key: measure.as,
        label: measure.as,
        nullable: !["count", "countDistinct"].includes(measure.aggregation),
        scalarType,
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

function encodeCursor(sourceKey: string, workspaceId: string, offset: number) {
  return Buffer.from(JSON.stringify({ offset, sourceKey, workspaceId }), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(
  cursor: string | undefined,
  sourceKey: string,
  workspaceId: string,
): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      offset?: unknown;
      sourceKey?: unknown;
      workspaceId?: unknown;
    };
    if (
      !Number.isInteger(parsed.offset) ||
      (parsed.offset as number) < 0 ||
      parsed.sourceKey !== sourceKey ||
      parsed.workspaceId !== workspaceId
    ) {
      throw new Error("invalid cursor");
    }
    return parsed.offset as number;
  } catch {
    throw new Error("invalid fake analytics cursor");
  }
}

async function abortableDelay(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeTruncateAfter(value: number | undefined): number | null {
  return Number.isInteger(value) && (value ?? -1) >= 0 ? value! : null;
}

function notNull(value: AnalyticsScalar): value is Exclude<AnalyticsScalar, null> {
  return value !== null;
}

function isNumber(value: AnalyticsScalar): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
