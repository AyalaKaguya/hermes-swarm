import { z } from "zod";
import { AnalyticsDatasetVersionSchema } from "./constants.js";
import {
  AnalysisAggregationSchema,
  AnalysisFilterOperatorSchema,
  AnalyticsSourceKeySchema,
  AnalyticsSourceRevisionSchema,
  DatasetFieldKeySchema,
  DatasetScalarTypeSchema,
  DatasetSemanticTypeSchema,
  DatasetValueFormatSchema,
  type AnalysisAggregation,
  type AnalysisFilterOperator,
  type DatasetScalarType,
} from "./primitives.js";

export const DatasetFieldCapabilitiesSchema = z.strictObject({
  aggregations: z.array(AnalysisAggregationSchema),
  filterOperators: z.array(AnalysisFilterOperatorSchema),
  groupable: z.boolean(),
  selectable: z.boolean(),
  sortable: z.boolean(),
});
export type DatasetFieldCapabilities = z.infer<typeof DatasetFieldCapabilitiesSchema>;

const allowedFilterOperators: Record<DatasetScalarType, ReadonlySet<AnalysisFilterOperator>> = {
  boolean: new Set(["eq", "neq", "in", "notIn", "isNull", "isNotNull"]),
  date: new Set(["eq", "neq", "in", "notIn", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
  datetime: new Set(["eq", "neq", "in", "notIn", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
  enum: new Set(["eq", "neq", "in", "notIn", "isNull", "isNotNull"]),
  number: new Set(["eq", "neq", "in", "notIn", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
  string: new Set(["eq", "neq", "in", "notIn", "contains", "startsWith", "isNull", "isNotNull"]),
};

const allowedAggregations: Record<DatasetScalarType, ReadonlySet<AnalysisAggregation>> = {
  boolean: new Set(["count", "countDistinct"]),
  date: new Set(["count", "countDistinct", "min", "max"]),
  datetime: new Set(["count", "countDistinct", "min", "max"]),
  enum: new Set(["count", "countDistinct"]),
  number: new Set(["count", "countDistinct", "sum", "avg", "min", "max"]),
  string: new Set(["count", "countDistinct", "min", "max"]),
};

export const DatasetEnumValueSchema = z.strictObject({
  label: z.string().trim().min(1).max(120),
  value: z.string().max(256),
});
export type DatasetEnumValue = z.infer<typeof DatasetEnumValueSchema>;

export const DatasetFieldDescriptorSchema = z
  .strictObject({
    capabilities: DatasetFieldCapabilitiesSchema,
    enumValues: z.array(DatasetEnumValueSchema).min(1).max(500).optional(),
    format: DatasetValueFormatSchema.optional(),
    key: DatasetFieldKeySchema,
    label: z.string().trim().min(1).max(120),
    nullable: z.boolean(),
    scalarType: DatasetScalarTypeSchema,
    semanticType: DatasetSemanticTypeSchema.optional(),
  })
  .superRefine((field, context) => {
    if (field.scalarType === "enum" && field.enumValues === undefined) {
      context.addIssue({
        code: "custom",
        message: "enum fields must declare enumValues",
        path: ["enumValues"],
      });
    }
    if (field.scalarType !== "enum" && field.enumValues !== undefined) {
      context.addIssue({
        code: "custom",
        message: "enumValues are only valid for enum fields",
        path: ["enumValues"],
      });
    }

    const seenOperators = new Set<AnalysisFilterOperator>();
    field.capabilities.filterOperators.forEach((operator, index) => {
      if (seenOperators.has(operator)) {
        context.addIssue({
          code: "custom",
          message: "filter operators must be unique",
          path: ["capabilities", "filterOperators", index],
        });
      }
      seenOperators.add(operator);
      if (!allowedFilterOperators[field.scalarType].has(operator)) {
        context.addIssue({
          code: "custom",
          message: `operator ${operator} is incompatible with ${field.scalarType}`,
          path: ["capabilities", "filterOperators", index],
        });
      }
    });

    const seenAggregations = new Set<AnalysisAggregation>();
    field.capabilities.aggregations.forEach((aggregation, index) => {
      if (seenAggregations.has(aggregation)) {
        context.addIssue({
          code: "custom",
          message: "aggregations must be unique",
          path: ["capabilities", "aggregations", index],
        });
      }
      seenAggregations.add(aggregation);
      if (!allowedAggregations[field.scalarType].has(aggregation)) {
        context.addIssue({
          code: "custom",
          message: `aggregation ${aggregation} is incompatible with ${field.scalarType}`,
          path: ["capabilities", "aggregations", index],
        });
      }
    });
  });
export type DatasetFieldDescriptor = z.infer<typeof DatasetFieldDescriptorSchema>;

export const DatasetSchema = z
  .strictObject({
    description: z.string().trim().min(1).max(1_000).optional(),
    fields: z.array(DatasetFieldDescriptorSchema).min(1),
    schemaVersion: AnalyticsDatasetVersionSchema,
    sourceKey: AnalyticsSourceKeySchema,
    sourceRevision: AnalyticsSourceRevisionSchema,
    title: z.string().trim().min(1).max(120),
  })
  .superRefine((dataset, context) => {
    const fieldKeys = new Set<string>();
    dataset.fields.forEach((field, index) => {
      if (fieldKeys.has(field.key)) {
        context.addIssue({
          code: "custom",
          message: "dataset field keys must be unique",
          path: ["fields", index, "key"],
        });
      }
      fieldKeys.add(field.key);
    });
  });
export type DatasetSchema = z.infer<typeof DatasetSchema>;
