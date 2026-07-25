import { z } from "zod";

export const AnalyticsSourceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);

export const AnalyticsSourceRevisionSchema = z.string().trim().min(1).max(128);

/** Safe logical keys only; expressions and database identifiers are not part of the contract. */
export const DatasetFieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/);

export const DatasetScalarTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
]);
export type DatasetScalarType = z.infer<typeof DatasetScalarTypeSchema>;

export const DatasetSemanticTypeSchema = z.enum([
  "identifier",
  "category",
  "currency",
  "percentage",
  "duration",
]);
export type DatasetSemanticType = z.infer<typeof DatasetSemanticTypeSchema>;

export const DatasetCellValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type DatasetCellValue = z.infer<typeof DatasetCellValueSchema>;

const affixSchema = z.string().max(32);
const fractionDigitsSchema = z.number().int().min(0).max(20);

export const DatasetValueFormatSchema = z.discriminatedUnion("type", [
  z.strictObject({
    prefix: affixSchema.optional(),
    suffix: affixSchema.optional(),
    type: z.literal("plain"),
  }),
  z.strictObject({
    maximumFractionDigits: fractionDigitsSchema.optional(),
    minimumFractionDigits: fractionDigitsSchema.optional(),
    type: z.literal("number"),
  }),
  z.strictObject({
    currency: z.string().regex(/^[A-Z]{3}$/),
    maximumFractionDigits: fractionDigitsSchema.optional(),
    minimumFractionDigits: fractionDigitsSchema.optional(),
    type: z.literal("currency"),
  }),
  z.strictObject({
    maximumFractionDigits: fractionDigitsSchema.optional(),
    minimumFractionDigits: fractionDigitsSchema.optional(),
    type: z.literal("percentage"),
  }),
  z.strictObject({
    type: z.literal("date"),
  }),
  z.strictObject({
    timeZone: z.string().trim().min(1).max(64).optional(),
    type: z.literal("datetime"),
  }),
  z.strictObject({
    type: z.literal("duration"),
    unit: z.enum(["milliseconds", "seconds", "minutes", "hours", "days"]),
  }),
]);
export type DatasetValueFormat = z.infer<typeof DatasetValueFormatSchema>;

export const AnalysisFilterOperatorSchema = z.enum([
  "eq",
  "neq",
  "in",
  "notIn",
  "contains",
  "startsWith",
  "gt",
  "gte",
  "lt",
  "lte",
  "isNull",
  "isNotNull",
]);
export type AnalysisFilterOperator = z.infer<typeof AnalysisFilterOperatorSchema>;

export const AnalysisAggregationSchema = z.enum([
  "count",
  "countDistinct",
  "sum",
  "avg",
  "min",
  "max",
]);
export type AnalysisAggregation = z.infer<typeof AnalysisAggregationSchema>;
