import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  ANALYTICS_QUERY_BUDGET,
  ANALYTICS_RESULT_VERSION,
  AnalysisQuerySchema,
  DatasetResultSchema,
  DatasetSchema as DatasetSchemaContract,
  type AnalysisFilter,
  type AnalysisMeasure,
  type AnalysisQuery,
  type AnalyticsErrorCode,
  type DatasetFieldDescriptor,
  type DatasetResult,
  type DatasetResultField,
  type DatasetScalarType,
  type DatasetSchema,
} from "@hermes-swarm/api-contracts/analytics";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { analyticsDigest } from "./analytics-digest.js";
import { AnalyticsQueryError } from "./analytics-query.error.js";
import type {
  AnalyticsAdapterResult,
  AnalyticsAuthorizationContext,
  AnalyticsExecutionContext,
  AnalyticsScalar,
  AnalyticsSourceRegistration,
} from "./analytics-source.adapter.js";
import { AnalyticsSourceRegistry } from "./analytics-source.registry.js";

export const ANALYTICS_QUERY_GATEWAY_OPTIONS = Symbol(
  "ANALYTICS_QUERY_GATEWAY_OPTIONS",
);

export type AnalyticsQueryGatewayOptions = Partial<{
  maxResponseBytes: number;
  timeoutMs: number;
}>;

const FORBIDDEN_QUERY_KEYS = new Set([
  "connectionString",
  "credentials",
  "rawSql",
  "sql",
  "workspaceId",
  "workspace_id",
]);

@Injectable()
export class AnalyticsQueryGateway {
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    private readonly sourceRegistry: AnalyticsSourceRegistry,
    @Optional()
    @Inject(ANALYTICS_QUERY_GATEWAY_OPTIONS)
    options: AnalyticsQueryGatewayOptions | undefined = undefined,
  ) {
    this.maxResponseBytes = boundedPositiveInteger(
      options?.maxResponseBytes,
      ANALYTICS_QUERY_BUDGET.maxResponseBytes,
    );
    this.timeoutMs = boundedPositiveInteger(
      options?.timeoutMs,
      ANALYTICS_QUERY_BUDGET.timeoutMs,
    );
  }

  async execute(
    rawQuery: unknown,
    authorization: AnalyticsAuthorizationContext,
  ): Promise<DatasetResult> {
    rejectForbiddenQueryKeys(rawQuery);
    const query = parseQuery(rawQuery);
    const context = this.executionContext(authorization);
    const registration = this.authorizedSource(query.sourceKey, context);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("analytics query deadline exceeded")),
      this.timeoutMs,
    );
    timeout.unref?.();
    const startedAt = performance.now();

    try {
      const described = await raceWithAbort(
        registration.adapter.describe(
          context,
          registration.sourceKey,
          controller.signal,
        ),
        controller.signal,
      );
      const schema = parseDatasetSchema(described);
      this.validateSourceIdentity(query, schema, registration);
      validateQueryAgainstSchema(query, schema);

      const queryDigest = analyticsDigest(query);
      const policyDigest = analyticsDigest({
        actorId: context.actorId,
        locale: context.locale,
        permissions: [...context.permissions].sort(),
        policyRevision: registration.policyRevision,
        principalType: context.principalType,
        requiredPermissions: [...registration.requiredPermissions].sort(),
        scopeLevel: context.scopeLevel,
        sourceKey: schema.sourceKey,
        sourceRevision: schema.sourceRevision,
        timeZone: context.timeZone,
        workspaceId: context.workspaceId,
      });
      const adapterResult = await raceWithAbort(
        registration.adapter.execute(context, query, controller.signal),
        controller.signal,
      );
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));

      return this.validateResult({
        adapterResult,
        durationMs,
        policyDigest,
        query,
        queryDigest,
        schema,
      });
    } catch (error) {
      if (error instanceof AnalyticsQueryError) throw error;
      if (controller.signal.aborted) {
        throw new AnalyticsQueryError(
          "ANALYTICS_QUERY_TIMEOUT",
          "Analytics query exceeded its execution deadline.",
        );
      }
      throw new AnalyticsQueryError(
        "ANALYTICS_ADAPTER_UNAVAILABLE",
        "Analytics source is temporarily unavailable.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async describe(
    sourceKey: string,
    authorization: AnalyticsAuthorizationContext,
  ): Promise<DatasetSchema> {
    const context = this.executionContext(authorization);
    const registration = this.authorizedSource(sourceKey, context);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("analytics describe deadline exceeded")),
      this.timeoutMs,
    );
    timeout.unref?.();

    try {
      const described = await raceWithAbort(
        registration.adapter.describe(
          context,
          registration.sourceKey,
          controller.signal,
        ),
        controller.signal,
      );
      const schema = parseDatasetSchema(described);
      if (schema.sourceKey !== registration.sourceKey) {
        throw new AnalyticsQueryError(
          "ANALYTICS_RESULT_INVALID",
          "Analytics adapter returned a schema for a different source.",
        );
      }
      return schema;
    } catch (error) {
      if (error instanceof AnalyticsQueryError) throw error;
      if (controller.signal.aborted) {
        throw new AnalyticsQueryError(
          "ANALYTICS_QUERY_TIMEOUT",
          "Analytics source description exceeded its execution deadline.",
        );
      }
      throw new AnalyticsQueryError(
        "ANALYTICS_ADAPTER_UNAVAILABLE",
        "Analytics source is temporarily unavailable.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private executionContext(
    authorization: AnalyticsAuthorizationContext,
  ): AnalyticsExecutionContext {
    const workspace = this.workspaceContext.current(false);
    if (!workspace?.workspaceId.trim()) {
      throw new AnalyticsQueryError(
        "ANALYTICS_CONTEXT_REQUIRED",
        "A trusted workspace context is required for analytics queries.",
      );
    }
    if (!isAuthorizationContext(authorization)) {
      throw new AnalyticsQueryError(
        "ANALYTICS_CONTEXT_REQUIRED",
        "A trusted authorization context is required for analytics queries.",
      );
    }

    return Object.freeze({
      ...authorization,
      actorId: authorization.actorId.trim(),
      locale: authorization.locale.trim(),
      permissions: new Set(authorization.permissions),
      requestId: authorization.requestId.trim(),
      scopeLevel: workspace.scopeLevel,
      timeZone: authorization.timeZone.trim(),
      workspaceId: workspace.workspaceId.trim(),
    });
  }

  private authorizedSource(
    sourceKey: string,
    context: AnalyticsExecutionContext,
  ): AnalyticsSourceRegistration {
    const registration = this.sourceRegistry.resolve(sourceKey);
    if (
      !registration ||
      registration.requiredPermissions.some(
        (permission) => !context.permissions.has(permission),
      )
    ) {
      // Do not reveal whether a source exists in another authorization scope.
      throw new AnalyticsQueryError(
        "ANALYTICS_SOURCE_NOT_FOUND",
        "Analytics source was not found.",
      );
    }
    return registration;
  }

  private validateSourceIdentity(
    query: AnalysisQuery,
    schema: DatasetSchema,
    registration: AnalyticsSourceRegistration,
  ) {
    if (schema.sourceKey !== registration.sourceKey) {
      throw new AnalyticsQueryError(
        "ANALYTICS_RESULT_INVALID",
        "Analytics adapter returned a schema for a different source.",
      );
    }
    if (query.sourceRevision !== schema.sourceRevision) {
      throw new AnalyticsQueryError(
        "ANALYTICS_SOURCE_REVISION_MISMATCH",
        "Analytics source revision has changed.",
      );
    }
  }

  private validateResult(input: {
    adapterResult: AnalyticsAdapterResult;
    durationMs: number;
    policyDigest: string;
    query: AnalysisQuery;
    queryDigest: string;
    schema: DatasetSchema;
  }): DatasetResult {
    assertAdapterResultShape(input.adapterResult);
    const expectedSchema = expectedResultSchema(input.query, input.schema);
    validateAdapterColumns(input.adapterResult.schema, expectedSchema);
    validateAdapterRows(input.adapterResult.rows, expectedSchema);
    if (input.adapterResult.rows.length > input.query.page.size) {
      throw new AnalyticsQueryError(
        "ANALYTICS_RESULT_TOO_LARGE",
        "Analytics result exceeded the requested row budget.",
      );
    }
    if (
      input.adapterResult.pageInfo.hasMore !==
      (input.adapterResult.pageInfo.nextCursor !== null)
    ) {
      throw new AnalyticsQueryError(
        "ANALYTICS_RESULT_INVALID",
        "Analytics adapter returned inconsistent pagination metadata.",
      );
    }

    const candidate = {
      lineage: {
        generatedAt: new Date().toISOString(),
        policyDigest: input.policyDigest,
        queryDigest: input.queryDigest,
        sourceKey: input.schema.sourceKey,
        sourceRevision: input.schema.sourceRevision,
      },
      pageInfo: input.adapterResult.pageInfo,
      rows: input.adapterResult.rows,
      schema: expectedSchema,
      schemaVersion: ANALYTICS_RESULT_VERSION,
      summary: {
        durationMs: input.durationMs,
        returnedRows: input.adapterResult.rows.length,
        truncated: input.adapterResult.truncated ?? false,
      },
    };
    const parsed = DatasetResultSchema.safeParse(candidate);
    if (!parsed.success) {
      const tooLarge = Buffer.byteLength(JSON.stringify(candidate), "utf8") >
        this.maxResponseBytes;
      throw new AnalyticsQueryError(
        tooLarge ? "ANALYTICS_RESULT_TOO_LARGE" : "ANALYTICS_RESULT_INVALID",
        tooLarge
          ? "Analytics result exceeded the response byte budget."
          : "Analytics adapter returned an invalid result.",
      );
    }
    if (Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > this.maxResponseBytes) {
      throw new AnalyticsQueryError(
        "ANALYTICS_RESULT_TOO_LARGE",
        "Analytics result exceeded the response byte budget.",
      );
    }
    return parsed.data;
  }
}

function parseQuery(rawQuery: unknown): AnalysisQuery {
  const parsed = AnalysisQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    throw new AnalyticsQueryError(
      parsed.error.issues.some(isQueryBudgetIssue)
        ? "ANALYTICS_QUERY_BUDGET_EXCEEDED"
        : "ANALYTICS_QUERY_INVALID",
      parsed.error.issues.some(isQueryBudgetIssue)
        ? "Analytics query exceeded its complexity budget."
        : "Analytics query did not match its contract.",
    );
  }
  return parsed.data;
}

function isQueryBudgetIssue(issue: { code: string; path: readonly PropertyKey[] }) {
  if (issue.code !== "too_big") return false;
  const [root, leaf] = issue.path;
  return (
    root === "filters" ||
    root === "groupBy" ||
    root === "measures" ||
    root === "sort" ||
    (root === "page" && leaf === "size")
  );
}

function parseDatasetSchema(value: unknown): DatasetSchema {
  const parsed = DatasetSchemaContract.safeParse(value);
  if (!parsed.success) {
    throw new AnalyticsQueryError(
      "ANALYTICS_RESULT_INVALID",
      "Analytics adapter returned an invalid dataset schema.",
    );
  }
  return parsed.data;
}

function validateQueryAgainstSchema(query: AnalysisQuery, schema: DatasetSchema) {
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  for (const key of query.select) {
    const field = requireField(fields, key);
    requireCapability(field.capabilities.selectable, key, "select");
  }
  for (const key of query.groupBy) {
    const field = requireField(fields, key);
    requireCapability(field.capabilities.groupable, key, "group");
  }
  for (const filter of query.filters) validateFilter(filter, fields);
  for (const measure of query.measures) validateMeasure(measure, fields);

  const measureAliases = new Set(query.measures.map((measure) => measure.as));
  const aggregateOutputFields = new Set([...query.groupBy, ...measureAliases]);
  for (const sort of query.sort) {
    if (measureAliases.has(sort.field)) continue;
    const field = requireField(fields, sort.field);
    requireCapability(field.capabilities.sortable, sort.field, "sort");
    if (
      (query.groupBy.length > 0 || query.measures.length > 0) &&
      !aggregateOutputFields.has(sort.field)
    ) {
      throw new AnalyticsQueryError(
        "ANALYTICS_QUERY_INVALID",
        `Sort field ${sort.field} is not projected by the aggregate query.`,
      );
    }
  }

  if (query.groupBy.length > 0 || query.measures.length > 0) {
    const grouped = new Set(query.groupBy);
    const invalidProjection = query.select.find((key) => !grouped.has(key));
    if (invalidProjection) {
      throw new AnalyticsQueryError(
        "ANALYTICS_QUERY_INVALID",
        `Projected field ${invalidProjection} must be grouped in an aggregate query.`,
      );
    }
  }

  if (
    query.filters.length > ANALYTICS_QUERY_BUDGET.maxFilters ||
    query.groupBy.length > ANALYTICS_QUERY_BUDGET.maxGroupByFields ||
    query.measures.length > ANALYTICS_QUERY_BUDGET.maxMeasures ||
    query.sort.length > ANALYTICS_QUERY_BUDGET.maxSortFields ||
    query.page.size > ANALYTICS_QUERY_BUDGET.maxPageSize ||
    query.filters.some(
      (filter) =>
        (filter.operator === "in" || filter.operator === "notIn") &&
        filter.value.length > ANALYTICS_QUERY_BUDGET.maxInValues,
    )
  ) {
    throw new AnalyticsQueryError(
      "ANALYTICS_QUERY_BUDGET_EXCEEDED",
      "Analytics query exceeded its complexity budget.",
    );
  }
}

function validateFilter(
  filter: AnalysisFilter,
  fields: ReadonlyMap<string, DatasetFieldDescriptor>,
) {
  const field = requireField(fields, filter.field);
  if (!field.capabilities.filterOperators.includes(filter.operator)) {
    throw new AnalyticsQueryError(
      "ANALYTICS_FILTER_INVALID",
      `Filter operator is unavailable for field ${filter.field}.`,
    );
  }
  if (filter.operator === "isNull" || filter.operator === "isNotNull") return;
  const values = filter.operator === "in" || filter.operator === "notIn"
    ? filter.value
    : [filter.value];
  if (values.some((value) => !valueMatchesField(value, field))) {
    throw new AnalyticsQueryError(
      "ANALYTICS_FILTER_INVALID",
      `Filter value does not match field ${filter.field}.`,
    );
  }
}

function validateMeasure(
  measure: AnalysisMeasure,
  fields: ReadonlyMap<string, DatasetFieldDescriptor>,
) {
  if (measure.aggregation === "count" && measure.field === undefined) return;
  if (measure.field === undefined) {
    throw new AnalyticsQueryError(
      "ANALYTICS_AGGREGATION_INVALID",
      `Aggregation ${measure.aggregation} requires a field.`,
    );
  }
  const field = requireField(fields, measure.field);
  if (!field.capabilities.aggregations.includes(measure.aggregation)) {
    throw new AnalyticsQueryError(
      "ANALYTICS_AGGREGATION_INVALID",
      `Aggregation ${measure.aggregation} is unavailable for field ${measure.field}.`,
    );
  }
}

function requireField(
  fields: ReadonlyMap<string, DatasetFieldDescriptor>,
  key: string,
): DatasetFieldDescriptor {
  const field = fields.get(key);
  if (!field) {
    throw new AnalyticsQueryError(
      "ANALYTICS_FIELD_UNKNOWN",
      `Analytics field ${key} is not available.`,
    );
  }
  return field;
}

function requireCapability(allowed: boolean, key: string, capability: string) {
  if (!allowed) {
    throw new AnalyticsQueryError(
      "ANALYTICS_FIELD_CAPABILITY_DENIED",
      `Field ${key} does not support ${capability}.`,
    );
  }
}

function valueMatchesField(
  value: string | number | boolean,
  field: DatasetFieldDescriptor,
) {
  switch (field.scalarType) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" &&
        field.enumValues?.some((item) => item.value === value) === true;
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "datetime":
      return typeof value === "string" && Number.isFinite(Date.parse(value));
    case "string":
      return typeof value === "string";
  }
}

function expectedResultSchema(
  query: AnalysisQuery,
  schema: DatasetSchema,
): DatasetResultField[] {
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  if (query.groupBy.length === 0 && query.measures.length === 0) {
    return query.select.map((key) => resultField(requireField(fields, key)));
  }

  return [
    ...query.groupBy.map((key) => resultField(requireField(fields, key))),
    ...query.measures.map((measure) => measureResultField(measure, fields)),
  ];
}

function resultField(field: DatasetFieldDescriptor): DatasetResultField {
  return {
    ...(field.format ? { format: field.format } : {}),
    key: field.key,
    label: field.label,
    nullable: field.nullable,
    scalarType: field.scalarType,
    ...(field.semanticType ? { semanticType: field.semanticType } : {}),
  };
}

function measureResultField(
  measure: AnalysisMeasure,
  fields: ReadonlyMap<string, DatasetFieldDescriptor>,
): DatasetResultField {
  const field = measure.field ? requireField(fields, measure.field) : null;
  const scalarType: DatasetScalarType =
    measure.aggregation === "count" ||
    measure.aggregation === "countDistinct" ||
    measure.aggregation === "sum" ||
    measure.aggregation === "avg"
      ? "number"
      : field!.scalarType;
  return {
    key: measure.as,
    label: measure.as,
    nullable:
      measure.aggregation !== "count" && measure.aggregation !== "countDistinct",
    scalarType,
  };
}

function validateAdapterColumns(
  actual: readonly DatasetResultField[],
  expected: readonly DatasetResultField[],
) {
  if (actual.length !== expected.length) {
    throw invalidAdapterResult("Analytics adapter returned undeclared columns.");
  }
  const actualByKey = new Map(actual.map((field) => [field.key, field]));
  if (actualByKey.size !== actual.length) {
    throw invalidAdapterResult("Analytics adapter returned duplicate columns.");
  }
  for (const field of expected) {
    const actualField = actualByKey.get(field.key);
    if (
      !actualField ||
      actualField.scalarType !== field.scalarType ||
      actualField.nullable !== field.nullable
    ) {
      throw invalidAdapterResult("Analytics adapter returned an incompatible column.");
    }
  }
}

function validateAdapterRows(
  rows: readonly Readonly<Record<string, AnalyticsScalar>>[],
  schema: readonly DatasetResultField[],
) {
  const expectedKeys = new Set(schema.map((field) => field.key));
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw invalidAdapterResult("Analytics adapter returned a non-record row.");
    }
    const keys = Object.keys(row);
    if (
      keys.length !== expectedKeys.size ||
      keys.some((key) => !expectedKeys.has(key))
    ) {
      throw invalidAdapterResult("Analytics adapter row does not match declared columns.");
    }
    for (const field of schema) {
      const value: unknown = row[field.key];
      if (value === null) {
        if (!field.nullable) {
          throw invalidAdapterResult("Analytics adapter returned null for a required field.");
        }
        continue;
      }
      if (!valueMatchesScalarType(value, field.scalarType)) {
        throw invalidAdapterResult("Analytics adapter returned a non-scalar or mistyped value.");
      }
    }
  }
}

function valueMatchesScalarType(value: unknown, scalarType: DatasetScalarType) {
  switch (scalarType) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "string":
    case "date":
    case "datetime":
    case "enum":
      return typeof value === "string";
  }
}

function assertAdapterResultShape(
  value: AnalyticsAdapterResult,
): asserts value is AnalyticsAdapterResult {
  const candidate = value as Partial<AnalyticsAdapterResult> | null | undefined;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !Array.isArray(candidate.schema) ||
    !Array.isArray(candidate.rows) ||
    !candidate.pageInfo ||
    typeof candidate.pageInfo !== "object" ||
    typeof candidate.pageInfo.hasMore !== "boolean" ||
    (candidate.pageInfo.nextCursor !== null &&
      typeof candidate.pageInfo.nextCursor !== "string") ||
    (candidate.truncated !== undefined && typeof candidate.truncated !== "boolean")
  ) {
    throw invalidAdapterResult("Analytics adapter returned a malformed result envelope.");
  }
}

function invalidAdapterResult(message: string) {
  return new AnalyticsQueryError("ANALYTICS_RESULT_INVALID", message);
}

function rejectForbiddenQueryKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_QUERY_KEYS.has(key)) {
      throw new AnalyticsQueryError(
        "ANALYTICS_QUERY_INVALID",
        "Analytics query contains a server-controlled field.",
      );
    }
  }
}

function isAuthorizationContext(
  value: AnalyticsAuthorizationContext | null | undefined,
): value is AnalyticsAuthorizationContext {
  return Boolean(
    value &&
      typeof value.actorId === "string" &&
      value.actorId.trim() &&
      typeof value.requestId === "string" &&
      value.requestId.trim() &&
      typeof value.locale === "string" &&
      value.locale.trim() &&
      typeof value.timeZone === "string" &&
      value.timeZone.trim() &&
      (value.principalType === "workspace" || value.principalType === "integration") &&
      value.permissions &&
      typeof value.permissions[Symbol.iterator] === "function",
  );
}

function boundedPositiveInteger(value: number | undefined, ceiling: number) {
  return Number.isInteger(value) && (value ?? 0) > 0
    ? Math.min(value!, ceiling)
    : ceiling;
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
