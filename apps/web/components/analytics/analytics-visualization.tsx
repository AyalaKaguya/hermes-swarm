"use client";

import type {
  DatasetResult,
  VisualizationSpec,
} from "@hermes-swarm/api-contracts/analytics";
import {
  AnalyticsAreaVisualization,
  AnalyticsBarVisualization,
  AnalyticsLineVisualization,
} from "./analytics-cartesian-visualization";
import { AnalyticsKpiVisualization } from "./analytics-kpi-visualization";
import { AnalyticsPieVisualization } from "./analytics-pie-visualization";
import { AnalyticsTableVisualization } from "./analytics-table-visualization";
import type { AnalyticsValueFormatter } from "./visualization-utils";

export function AnalyticsVisualization({
  className,
  formatValue,
  labels,
  locale,
  result,
  spec,
}: {
  className?: string;
  formatValue?: AnalyticsValueFormatter;
  labels?: ReadonlyMap<string, string>;
  locale?: string;
  result: DatasetResult;
  spec: VisualizationSpec;
}) {
  switch (spec.type) {
    case "table":
      return (
        <AnalyticsTableVisualization
          className={className}
          formatValue={formatValue}
          labels={labels}
          result={result}
          spec={spec}
        />
      );
    case "kpi":
      return (
        <AnalyticsKpiVisualization
          className={className}
          locale={locale}
          result={result}
          spec={spec}
        />
      );
    case "bar":
      return <AnalyticsBarVisualization className={className} result={result} spec={spec} />;
    case "line":
      return <AnalyticsLineVisualization className={className} result={result} spec={spec} />;
    case "area":
      return <AnalyticsAreaVisualization className={className} result={result} spec={spec} />;
    case "pie":
      return <AnalyticsPieVisualization className={className} result={result} spec={spec} />;
  }
}
