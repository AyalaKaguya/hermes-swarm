import { z } from "zod";
import {
  ANALYTICS_QUERY_MAX_PAGE_SIZE,
  ANALYTICS_QUERY_MAX_RESPONSE_BYTES,
  ANALYTICS_QUERY_TIMEOUT_MS,
  AnalyticsResultVersionSchema,
} from "./constants.js";
import {
  AnalyticsSourceKeySchema,
  AnalyticsSourceRevisionSchema,
  DatasetCellValueSchema,
  DatasetFieldKeySchema,
  DatasetScalarTypeSchema,
  DatasetSemanticTypeSchema,
  DatasetValueFormatSchema,
  type DatasetScalarType,
} from "./primitives.js";

export const DatasetResultFieldSchema = z.strictObject({
  format: DatasetValueFormatSchema.optional(),
  key: DatasetFieldKeySchema,
  label: z.string().trim().min(1).max(120),
  nullable: z.boolean(),
  scalarType: DatasetScalarTypeSchema,
  semanticType: DatasetSemanticTypeSchema.optional(),
});
export type DatasetResultField = z.infer<typeof DatasetResultFieldSchema>;

export const DatasetResultRowSchema = z.record(DatasetFieldKeySchema, DatasetCellValueSchema);
export type DatasetResultRow = z.infer<typeof DatasetResultRowSchema>;

export const DatasetResultPageInfoSchema = z.strictObject({
  hasMore: z.boolean(),
  nextCursor: z.string().min(1).max(2_048).nullable(),
});

export const DatasetResultSummarySchema = z.strictObject({
  durationMs: z.number().int().min(0).max(ANALYTICS_QUERY_TIMEOUT_MS),
  returnedRows: z.number().int().min(0).max(ANALYTICS_QUERY_MAX_PAGE_SIZE),
  truncated: z.boolean(),
});

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const DatasetResultLineageSchema = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  policyDigest: digestSchema,
  queryDigest: digestSchema,
  sourceKey: AnalyticsSourceKeySchema,
  sourceRevision: AnalyticsSourceRevisionSchema,
});

function valueMatchesScalarType(value: unknown, scalarType: DatasetScalarType) {
  if (value === null) return true;
  switch (scalarType) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && z.iso.date().safeParse(value).success;
    case "datetime":
      return typeof value === "string" &&
        z.iso.datetime({ offset: true }).safeParse(value).success;
    case "string":
    case "enum":
      return typeof value === "string";
  }
}

export const DatasetResultSchema = z
  .strictObject({
    lineage: DatasetResultLineageSchema,
    pageInfo: DatasetResultPageInfoSchema,
    rows: z.array(DatasetResultRowSchema).max(ANALYTICS_QUERY_MAX_PAGE_SIZE),
    schema: z.array(DatasetResultFieldSchema).min(1),
    schemaVersion: AnalyticsResultVersionSchema,
    summary: DatasetResultSummarySchema,
  })
  .superRefine((result, context) => {
    const fields = new Map(result.schema.map((field) => [field.key, field]));
    if (fields.size !== result.schema.length) {
      context.addIssue({
        code: "custom",
        message: "result schema field keys must be unique",
        path: ["schema"],
      });
    }

    if (result.summary.returnedRows !== result.rows.length) {
      context.addIssue({
        code: "custom",
        message: "returnedRows must equal the number of rows",
        path: ["summary", "returnedRows"],
      });
    }

    result.rows.forEach((row, rowIndex) => {
      for (const key of Object.keys(row)) {
        if (!fields.has(key)) {
          context.addIssue({
            code: "custom",
            message: `row contains unknown field ${key}`,
            path: ["rows", rowIndex, key],
          });
        }
      }
      for (const [key, field] of fields) {
        if (!(key in row)) {
          context.addIssue({
            code: "custom",
            message: `row is missing field ${key}`,
            path: ["rows", rowIndex, key],
          });
          continue;
        }
        const value = row[key];
        if (value === null && !field.nullable) {
          context.addIssue({
            code: "custom",
            message: `field ${key} is not nullable`,
            path: ["rows", rowIndex, key],
          });
        } else if (!valueMatchesScalarType(value, field.scalarType)) {
          context.addIssue({
            code: "custom",
            message: `field ${key} does not match ${field.scalarType}`,
            path: ["rows", rowIndex, key],
          });
        }
      }
    });

    const serializedBytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    if (serializedBytes > ANALYTICS_QUERY_MAX_RESPONSE_BYTES) {
      context.addIssue({
        code: "custom",
        message: "dataset result exceeds the response byte budget",
        path: ["rows"],
      });
    }
  });
export type DatasetResult = z.infer<typeof DatasetResultSchema>;
