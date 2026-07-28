"use client";

import type {
  DatasetResult,
  KpiVisualizationSpec,
} from "@hermes-swarm/api-contracts/analytics";
import { cn } from "@/lib/utils";
import { displayValue, resultFieldLabel } from "./visualization-utils";

export function AnalyticsKpiVisualization({
  className,
  locale,
  result,
  spec,
}: {
  className?: string;
  locale?: string;
  result: DatasetResult;
  spec: KpiVisualizationSpec;
}) {
  const value = result.rows[0]?.[spec.measure];
  const formatted = formatKpiValue(value, spec, locale);

  return (
    <div
      className={cn(
        "grid h-full min-h-64 place-items-center rounded-lg bg-muted/15 p-6 text-center",
        className,
      )}
    >
      <div className="grid gap-2">
        {spec.title && <p className="text-sm font-medium">{spec.title}</p>}
        <div className="text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
          {formatted}
        </div>
        <p className="text-sm text-muted-foreground">
          {spec.label ?? resultFieldLabel(result, spec.measure)}
        </p>
      </div>
    </div>
  );
}

function formatKpiValue(
  value: DatasetResult["rows"][number][string] | undefined,
  spec: KpiVisualizationSpec,
  locale = "en",
) {
  if (typeof value !== "number") return displayValue(value);
  const format = spec.format;
  switch (format?.type) {
    case "currency":
      return new Intl.NumberFormat(locale, {
        currency: format.currency,
        maximumFractionDigits: format.maximumFractionDigits,
        minimumFractionDigits: format.minimumFractionDigits,
        style: "currency",
      }).format(value);
    case "percentage":
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: format.maximumFractionDigits,
        minimumFractionDigits: format.minimumFractionDigits,
        style: "percent",
      }).format(value);
    case "number":
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: format.maximumFractionDigits,
        minimumFractionDigits: format.minimumFractionDigits,
      }).format(value);
    case "plain":
      return `${format.prefix ?? ""}${value}${format.suffix ?? ""}`;
    default:
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  }
}
