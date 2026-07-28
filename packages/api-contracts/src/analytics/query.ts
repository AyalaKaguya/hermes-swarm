import { z } from "zod";
import {
  ANALYTICS_QUERY_DEFAULT_PAGE_SIZE,
  ANALYTICS_QUERY_MAX_FILTERS,
  ANALYTICS_QUERY_MAX_GROUPS,
  ANALYTICS_QUERY_MAX_IN_VALUES,
  ANALYTICS_QUERY_MAX_MEASURES,
  ANALYTICS_QUERY_MAX_PAGE_SIZE,
  ANALYTICS_QUERY_MAX_SORTS,
  AnalyticsQueryVersionSchema,
} from "./constants.js";
import {
  AnalyticsSourceKeySchema,
  AnalyticsSourceRevisionSchema,
  DatasetFieldKeySchema,
} from "./primitives.js";

const filterFieldShape = { field: DatasetFieldKeySchema } as const;
const scalarFilterValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

export const AnalysisFilterSchema = z.discriminatedUnion("operator", [
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("eq"),
    value: scalarFilterValueSchema,
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("neq"),
    value: scalarFilterValueSchema,
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("in"),
    value: z.array(scalarFilterValueSchema).min(1).max(ANALYTICS_QUERY_MAX_IN_VALUES),
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("notIn"),
    value: z.array(scalarFilterValueSchema).min(1).max(ANALYTICS_QUERY_MAX_IN_VALUES),
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("contains"),
    value: z.string().min(1).max(2_048),
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("startsWith"),
    value: z.string().min(1).max(2_048),
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("gt"),
    value: scalarFilterValueSchema,
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("gte"),
    value: scalarFilterValueSchema,
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("lt"),
    value: scalarFilterValueSchema,
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("lte"),
    value: scalarFilterValueSchema,
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("isNull"),
  }),
  z.strictObject({
    ...filterFieldShape,
    operator: z.literal("isNotNull"),
  }),
]);
export type AnalysisFilter = z.infer<typeof AnalysisFilterSchema>;

const measureAliasSchema = DatasetFieldKeySchema;

export const AnalysisMeasureSchema = z.discriminatedUnion("aggregation", [
  z.strictObject({
    aggregation: z.literal("count"),
    as: measureAliasSchema,
    field: DatasetFieldKeySchema.optional(),
  }),
  z.strictObject({ aggregation: z.literal("countDistinct"), as: measureAliasSchema, field: DatasetFieldKeySchema }),
  z.strictObject({ aggregation: z.literal("sum"), as: measureAliasSchema, field: DatasetFieldKeySchema }),
  z.strictObject({ aggregation: z.literal("avg"), as: measureAliasSchema, field: DatasetFieldKeySchema }),
  z.strictObject({ aggregation: z.literal("min"), as: measureAliasSchema, field: DatasetFieldKeySchema }),
  z.strictObject({ aggregation: z.literal("max"), as: measureAliasSchema, field: DatasetFieldKeySchema }),
]);
export type AnalysisMeasure = z.infer<typeof AnalysisMeasureSchema>;

export const AnalysisSortSchema = z.strictObject({
  direction: z.enum(["asc", "desc"]),
  field: DatasetFieldKeySchema,
});
export type AnalysisSort = z.infer<typeof AnalysisSortSchema>;

export const AnalysisPageSchema = z.strictObject({
  cursor: z.string().min(1).max(2_048).optional(),
  size: z.number().int().min(1).max(ANALYTICS_QUERY_MAX_PAGE_SIZE).default(ANALYTICS_QUERY_DEFAULT_PAGE_SIZE),
});
export type AnalysisPage = z.infer<typeof AnalysisPageSchema>;

function reportDuplicateValues(
  values: readonly string[],
  path: readonly (string | number)[],
  context: z.RefinementCtx,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: "values must be unique",
        path: [...path, index],
      });
    }
    seen.add(value);
  });
}

export const AnalysisQuerySchema = z
  .strictObject({
    filters: z.array(AnalysisFilterSchema).max(ANALYTICS_QUERY_MAX_FILTERS).default([]),
    groupBy: z.array(DatasetFieldKeySchema).max(ANALYTICS_QUERY_MAX_GROUPS).default([]),
    measures: z.array(AnalysisMeasureSchema).max(ANALYTICS_QUERY_MAX_MEASURES).default([]),
    page: AnalysisPageSchema.default({ size: ANALYTICS_QUERY_DEFAULT_PAGE_SIZE }),
    schemaVersion: AnalyticsQueryVersionSchema,
    select: z.array(DatasetFieldKeySchema).default([]),
    sort: z.array(AnalysisSortSchema).max(ANALYTICS_QUERY_MAX_SORTS).default([]),
    sourceKey: AnalyticsSourceKeySchema,
    sourceRevision: AnalyticsSourceRevisionSchema,
  })
  .superRefine((query, context) => {
    if (query.select.length === 0 && query.measures.length === 0) {
      context.addIssue({
        code: "custom",
        message: "a query must select at least one field or measure",
        path: ["select"],
      });
    }

    reportDuplicateValues(query.select, ["select"], context);
    reportDuplicateValues(query.groupBy, ["groupBy"], context);
    reportDuplicateValues(query.measures.map((measure) => measure.as), ["measures"], context);
    reportDuplicateValues(query.sort.map((sort) => sort.field), ["sort"], context);

    const projectedKeys = new Set([...query.select, ...query.groupBy]);
    query.measures.forEach((measure, index) => {
      if (projectedKeys.has(measure.as)) {
        context.addIssue({
          code: "custom",
          message: "measure aliases must not conflict with projected fields",
          path: ["measures", index, "as"],
        });
      }
      projectedKeys.add(measure.as);
    });
  });
export type AnalysisQuery = z.infer<typeof AnalysisQuerySchema>;
