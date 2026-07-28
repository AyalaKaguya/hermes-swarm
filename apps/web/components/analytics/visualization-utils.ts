import type {
  DatasetCellValue,
  DatasetResult,
  DatasetResultField,
} from "@hermes-swarm/api-contracts/analytics";
import type { ReactNode } from "react";

export const ANALYTICS_CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export type AnalyticsValueFormatter = (
  value: DatasetCellValue | undefined,
  field: DatasetResultField,
) => ReactNode;

export function resultField(
  result: DatasetResult,
  key: string,
): DatasetResultField | undefined {
  return result.schema.find((field) => field.key === key);
}

export function resultFieldLabel(
  result: DatasetResult,
  key: string,
  explicit?: string,
) {
  return explicit ?? resultField(result, key)?.label ?? key;
}

export function numericValue(value: DatasetCellValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function displayValue(value: DatasetCellValue | undefined) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return String(value);
  return String(value);
}
