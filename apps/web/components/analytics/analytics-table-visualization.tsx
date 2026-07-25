"use client";

import type {
  DatasetResult,
  TableVisualizationSpec,
} from "@hermes-swarm/api-contracts/analytics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  displayValue,
  type AnalyticsValueFormatter,
} from "./visualization-utils";

export function AnalyticsTableVisualization({
  className,
  formatValue,
  labels,
  result,
  spec,
}: {
  className?: string;
  formatValue?: AnalyticsValueFormatter;
  labels?: ReadonlyMap<string, string>;
  result: DatasetResult;
  spec: TableVisualizationSpec;
}) {
  const configured = spec.columns
    ?.map((column) => ({
      column,
      field: result.schema.find((field) => field.key === column.field),
    }))
    .filter((item) => item.field !== undefined);
  const columns = configured?.length
    ? configured.map(({ column, field }) => ({
        field: field!,
        label: column.label ?? labels?.get(field!.key) ?? field!.label,
      }))
    : result.schema.map((field) => ({
        field,
        label: labels?.get(field.key) ?? field.label,
      }));

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {spec.title && (
        <div className="border-b px-3 py-2 text-sm font-medium">{spec.title}</div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-[1] bg-background">
            <TableRow>
              {columns.map(({ field, label }) => (
                <TableHead
                  className={field.scalarType === "number" ? "text-right" : undefined}
                  key={field.key}
                >
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row, rowIndex) => (
              <TableRow key={`${result.lineage.queryDigest}-${rowIndex}`}>
                {columns.map(({ field }) => (
                  <TableCell
                    className={
                      field.scalarType === "number"
                        ? "text-right tabular-nums"
                        : undefined
                    }
                    key={field.key}
                  >
                    {formatValue
                      ? formatValue(row[field.key], field)
                      : displayValue(row[field.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
