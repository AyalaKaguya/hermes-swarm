"use client";

import type {
  AreaVisualizationSpec,
  BarVisualizationSpec,
  DatasetResult,
  LineVisualizationSpec,
} from "@hermes-swarm/api-contracts/analytics";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
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
  resultFieldLabel,
} from "./visualization-utils";

type CartesianSpec =
  | AreaVisualizationSpec
  | BarVisualizationSpec
  | LineVisualizationSpec;

type CartesianVisualizationProps<T extends CartesianSpec> = {
  className?: string;
  result: DatasetResult;
  spec: T;
};

export function AnalyticsBarVisualization(
  props: CartesianVisualizationProps<BarVisualizationSpec>,
) {
  return <CartesianVisualization {...props} type="bar" />;
}

export function AnalyticsLineVisualization(
  props: CartesianVisualizationProps<LineVisualizationSpec>,
) {
  return <CartesianVisualization {...props} type="line" />;
}

export function AnalyticsAreaVisualization(
  props: CartesianVisualizationProps<AreaVisualizationSpec>,
) {
  return <CartesianVisualization {...props} type="area" />;
}

function CartesianVisualization({
  className,
  result,
  spec,
  type,
}: CartesianVisualizationProps<CartesianSpec> & {
  type: "area" | "bar" | "line";
}) {
  const config = Object.fromEntries(
    spec.series.map((series, index) => [
      series.field,
      {
        color: ANALYTICS_CHART_COLORS[index % ANALYTICS_CHART_COLORS.length],
        label: resultFieldLabel(result, series.field, series.label),
      },
    ]),
  ) satisfies ChartConfig;
  const common = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        axisLine={false}
        dataKey={spec.x}
        minTickGap={24}
        tickLine={false}
        tickMargin={8}
      />
      <YAxis axisLine={false} tickLine={false} width={44} />
      {spec.series.some((series) => series.axis === "right") && (
        <YAxis
          axisLine={false}
          orientation="right"
          tickLine={false}
          width={44}
          yAxisId="right"
        />
      )}
      <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
      {spec.series.length > 1 && (
        <ChartLegend content={<ChartLegendContent />} />
      )}
    </>
  );

  return (
    <div className={cn("flex h-full min-h-72 w-full flex-col", className)}>
      {spec.title && (
        <div className="px-4 pt-3 text-sm font-medium">{spec.title}</div>
      )}
      <ChartContainer
        className="aspect-auto min-h-0 w-full flex-1 p-3"
        config={config}
      >
        {type === "bar" ? (
        <BarChart accessibilityLayer data={result.rows}>
          {common}
          {spec.series.map((series, index) => (
            <Bar
              dataKey={series.field}
              fill={`var(--color-${series.field})`}
              key={series.field}
              radius={spec.stacked ? 0 : 4}
              stackId={spec.stacked ? "analytics" : undefined}
              yAxisId={series.axis === "right" ? "right" : undefined}
            />
          ))}
        </BarChart>
        ) : type === "line" ? (
        <LineChart accessibilityLayer data={result.rows}>
          {common}
          {spec.series.map((series) => (
            <Line
              dataKey={series.field}
              dot={false}
              key={series.field}
              stroke={`var(--color-${series.field})`}
              strokeWidth={2}
              type="monotone"
              yAxisId={series.axis === "right" ? "right" : undefined}
            />
          ))}
        </LineChart>
        ) : (
        <AreaChart accessibilityLayer data={result.rows}>
          {common}
          {spec.series.map((series) => (
            <Area
              dataKey={series.field}
              fill={`var(--color-${series.field})`}
              fillOpacity={spec.stacked ? 0.65 : 0.25}
              key={series.field}
              stackId={spec.stacked ? "analytics" : undefined}
              stroke={`var(--color-${series.field})`}
              strokeWidth={2}
              type="monotone"
              yAxisId={series.axis === "right" ? "right" : undefined}
            />
          ))}
        </AreaChart>
        )}
      </ChartContainer>
    </div>
  );
}
