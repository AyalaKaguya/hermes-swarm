import type { Metric } from "@/lib/dashboard-data";

export function MetricCard({ metric }: { metric: Metric }) {
  return (
    <article className="metric-card">
      <div>
        <p>{metric.label}</p>
        <strong>{metric.value}</strong>
      </div>
      <span className={metric.tone}>{metric.delta}</span>
    </article>
  );
}
