"use client";

import type {
  DatasetResult,
  PieVisualizationSpec,
} from "@hermes-swarm/api-contracts/analytics";
import { Cell, Label, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import {
  ANALYTICS_CHART_COLORS,
  displayValue,
  numericValue,
  resultFieldLabel,
} from "./visualization-utils";

export function AnalyticsPieVisualization({
  className,
  result,
  spec,
}: {
  className?: string;
  result: DatasetResult;
  spec: PieVisualizationSpec;
}) {
  const data = result.rows.map((row, index) => ({
    ...row,
    __analyticsColor:
      ANALYTICS_CHART_COLORS[index % ANALYTICS_CHART_COLORS.length],
    __analyticsName: displayValue(row[spec.dimension]),
    __analyticsValue: numericValue(row[spec.measure]) ?? 0,
  }));
  const total = data.reduce((sum, row) => sum + row.__analyticsValue, 0);
  const config = {
    __analyticsValue: {
      color: ANALYTICS_CHART_COLORS[0],
      label: resultFieldLabel(result, spec.measure),
    },
  } satisfies ChartConfig;

  return (
    <div className={cn("flex h-full min-h-72 w-full flex-col", className)}>
      {spec.title && (
        <div className="px-4 pt-3 text-sm font-medium">{spec.title}</div>
      )}
      <ChartContainer
        className="mx-auto aspect-auto min-h-0 w-full max-w-3xl flex-1 p-3"
        config={config}
      >
        <PieChart accessibilityLayer>
        <ChartTooltip
          content={<ChartTooltipContent nameKey="__analyticsName" />}
          cursor={false}
        />
        <Pie
          data={data}
          dataKey="__analyticsValue"
          innerRadius={spec.showTotal ? 62 : 0}
          nameKey="__analyticsName"
          strokeWidth={2}
        >
          {data.map((row, index) => (
            <Cell fill={row.__analyticsColor} key={`${row.__analyticsName}-${index}`} />
          ))}
          {spec.showTotal && (
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
                return (
                  <text
                    dominantBaseline="middle"
                    textAnchor="middle"
                    x={viewBox.cx}
                    y={viewBox.cy}
                  >
                    <tspan className="fill-foreground text-2xl font-semibold" x={viewBox.cx}>
                      {new Intl.NumberFormat().format(total)}
                    </tspan>
                    <tspan className="fill-muted-foreground text-xs" dy="1.4em" x={viewBox.cx}>
                      {resultFieldLabel(result, spec.measure)}
                    </tspan>
                  </text>
                );
              }}
            />
          )}
        </Pie>
        {spec.showLegend !== false && (
          <ChartLegend content={<ChartLegendContent nameKey="__analyticsName" />} />
        )}
        </PieChart>
      </ChartContainer>
    </div>
  );
}
