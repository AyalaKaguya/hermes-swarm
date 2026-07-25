import { z } from "zod";
import {
  ANALYTICS_QUERY_MAX_MEASURES,
  AnalyticsVisualizationVersionSchema,
} from "./constants.js";
import { DatasetFieldKeySchema, DatasetValueFormatSchema } from "./primitives.js";

const visualizationCommonShape = {
  schemaVersion: AnalyticsVisualizationVersionSchema,
  title: z.string().trim().min(1).max(120).optional(),
} as const;

export const TableVisualizationColumnSchema = z.strictObject({
  field: DatasetFieldKeySchema,
  label: z.string().trim().min(1).max(120).optional(),
});

export const CartesianVisualizationSeriesSchema = z.strictObject({
  axis: z.enum(["left", "right"]).optional(),
  field: DatasetFieldKeySchema,
  label: z.string().trim().min(1).max(120).optional(),
});

export const TableVisualizationSpecSchema = z.strictObject({
  ...visualizationCommonShape,
  columns: z.array(TableVisualizationColumnSchema).min(1).optional(),
  type: z.literal("table"),
});

export const KpiVisualizationSpecSchema = z.strictObject({
  ...visualizationCommonShape,
  format: DatasetValueFormatSchema.optional(),
  label: z.string().trim().min(1).max(120).optional(),
  measure: DatasetFieldKeySchema,
  type: z.literal("kpi"),
});

function cartesianSpec(type: "bar" | "line" | "area") {
  return z.strictObject({
    ...visualizationCommonShape,
    series: z.array(CartesianVisualizationSeriesSchema).min(1).max(ANALYTICS_QUERY_MAX_MEASURES),
    stacked: z.boolean().optional(),
    type: z.literal(type),
    x: DatasetFieldKeySchema,
  });
}

export const BarVisualizationSpecSchema = cartesianSpec("bar");
export const LineVisualizationSpecSchema = cartesianSpec("line");
export const AreaVisualizationSpecSchema = cartesianSpec("area");

export const PieVisualizationSpecSchema = z.strictObject({
  ...visualizationCommonShape,
  dimension: DatasetFieldKeySchema,
  measure: DatasetFieldKeySchema,
  showLegend: z.boolean().optional(),
  showTotal: z.boolean().optional(),
  type: z.literal("pie"),
});

export const VisualizationSpecSchema = z.discriminatedUnion("type", [
  TableVisualizationSpecSchema,
  KpiVisualizationSpecSchema,
  BarVisualizationSpecSchema,
  LineVisualizationSpecSchema,
  AreaVisualizationSpecSchema,
  PieVisualizationSpecSchema,
]);
export type VisualizationSpec = z.infer<typeof VisualizationSpecSchema>;
