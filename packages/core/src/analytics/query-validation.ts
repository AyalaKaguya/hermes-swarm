import {
  ANALYTICS_QUERY_BUDGET,
  AnalysisQuerySchema,
  type AnalysisFilter,
  type AnalysisMeasure,
  type AnalysisQuery,
  type AnalyticsErrorCode,
  type DatasetFieldDescriptor,
  type DatasetResultField,
  type DatasetScalarType,
  type DatasetSchema,
} from "@hermes-swarm/api-contracts/analytics";

const FORBIDDEN_QUERY_KEYS = new Set([
  "connectionString",
  "credentials",
  "rawSql",
  "sql",
  "workspaceId",
  "workspace_id",
]);

export class AnalyticsQueryValidationError extends Error {
  constructor(
    readonly code: AnalyticsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AnalyticsQueryValidationError";
  }
}

export function parseAnalysisQuery(value: unknown): AnalysisQuery {
  rejectForbiddenQueryKeys(value);
  const parsed = AnalysisQuerySchema.safeParse(value);
  if (!parsed.success) {
    const budgetExceeded = parsed.error.issues.some(isQueryBudgetIssue);
    throw new AnalyticsQueryValidationError(
      budgetExceeded
        ? "ANALYTICS_QUERY_BUDGET_EXCEEDED"
        : "ANALYTICS_QUERY_INVALID",
      budgetExceeded
        ? "Analytics query exceeded its complexity budget."
        : "Analytics query did not match its contract.",
    );
  }
  return parsed.data;
}

export function validateAnalysisQueryAgainstDataset(
  query: AnalysisQuery,
  schema: DatasetSchema,
) {
  if (query.sourceKey !== schema.sourceKey) {
    throw new AnalyticsQueryValidationError(
      "ANALYTICS_SOURCE_NOT_FOUND",
      "Analytics source was not found.",
    );
  }
  if (query.sourceRevision !== schema.sourceRevision) {
    throw new AnalyticsQueryValidationError(
      "ANALYTICS_SOURCE_REVISION_MISMATCH",
      "Analytics source revision has changed.",
    );
  }

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
      throw invalidQuery(
        `Sort field ${sort.field} is not projected by the aggregate query.`,
      );
    }
  }

  if (query.groupBy.length > 0 || query.measures.length > 0) {
    const grouped = new Set(query.groupBy);
    const invalidProjection = query.select.find((key) => !grouped.has(key));
    if (invalidProjection) {
      throw invalidQuery(
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
    throw new AnalyticsQueryValidationError(
      "ANALYTICS_QUERY_BUDGET_EXCEEDED",
      "Analytics query exceeded its complexity budget.",
    );
  }
}

export function expectedAnalysisResultSchema(
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

function validateFilter(
  filter: AnalysisFilter,
  fields: ReadonlyMap<string, DatasetFieldDescriptor>,
) {
  const field = requireField(fields, filter.field);
  if (!field.capabilities.filterOperators.includes(filter.operator)) {
    throw new AnalyticsQueryValidationError(
      "ANALYTICS_FILTER_INVALID",
      `Filter operator is unavailable for field ${filter.field}.`,
    );
  }
  if (filter.operator === "isNull" || filter.operator === "isNotNull") return;
  const values =
    filter.operator === "in" || filter.operator === "notIn"
      ? filter.value
      : [filter.value];
  if (values.some((value) => !valueMatchesField(value, field))) {
    throw new AnalyticsQueryValidationError(
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
    throw new AnalyticsQueryValidationError(
      "ANALYTICS_AGGREGATION_INVALID",
      `Aggregation ${measure.aggregation} requires a field.`,
    );
  }
  const field = requireField(fields, measure.field);
  if (!field.capabilities.aggregations.includes(measure.aggregation)) {
    throw new AnalyticsQueryValidationError(
      "ANALYTICS_AGGREGATION_INVALID",
      `Aggregation ${measure.aggregation} is unavailable for field ${measure.field}.`,
    );
  }
}

function requireField(
  fields: ReadonlyMap<string, DatasetFieldDescriptor>,
  key: string,
) {
  const field = fields.get(key);
  if (!field) {
    throw new AnalyticsQueryValidationError(
      "ANALYTICS_FIELD_UNKNOWN",
      `Analytics field ${key} is not available.`,
    );
  }
  return field;
}

function requireCapability(allowed: boolean, key: string, capability: string) {
  if (!allowed) {
    throw new AnalyticsQueryValidationError(
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
      return (
        typeof value === "string" &&
        field.enumValues?.some((item) => item.value === value) === true
      );
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "datetime":
      return typeof value === "string" && Number.isFinite(Date.parse(value));
    case "string":
      return typeof value === "string";
  }
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
      measure.aggregation !== "count" &&
      measure.aggregation !== "countDistinct",
    scalarType,
  };
}

function rejectForbiddenQueryKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_QUERY_KEYS.has(key)) {
      throw invalidQuery("Analytics query contains a server-controlled field.");
    }
  }
}

function isQueryBudgetIssue(issue: {
  code: string;
  path: readonly PropertyKey[];
}) {
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

function invalidQuery(message: string) {
  return new AnalyticsQueryValidationError("ANALYTICS_QUERY_INVALID", message);
}
