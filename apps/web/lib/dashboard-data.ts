export type Metric = {
  label: string;
  value: string;
  delta: string;
  tone: "positive" | "neutral" | "warning";
};

export const metrics: Metric[] = [
  { label: "在线节点", value: "128", delta: "+12", tone: "positive" },
  { label: "执行任务", value: "846", delta: "72%", tone: "neutral" },
  { label: "队列延迟", value: "42ms", delta: "-8ms", tone: "positive" },
  { label: "失败重试", value: "7", delta: "需关注", tone: "warning" },
];

export const clusterLinks = [
  { name: "Edge A", latency: "22ms", position: "north" },
  { name: "Edge B", latency: "35ms", position: "east" },
  { name: "GPU Pool", latency: "48ms", position: "south" },
  { name: "Storage", latency: "18ms", position: "west" },
];

export const jobQueue = [
  { name: "embedding-sync", owner: "pipeline", state: "运行中" },
  { name: "report-render", owner: "scheduler", state: "排队" },
  { name: "agent-rebalance", owner: "system", state: "等待" },
  { name: "nightly-index", owner: "worker", state: "重试" },
];

export const agents = [
  {
    name: "agent-cn-01",
    region: "Shanghai",
    load: "68%",
    state: "在线",
    stateTone: "ready",
    heartbeat: "4s",
  },
  {
    name: "agent-us-03",
    region: "Oregon",
    load: "51%",
    state: "在线",
    stateTone: "ready",
    heartbeat: "7s",
  },
  {
    name: "agent-eu-02",
    region: "Frankfurt",
    load: "83%",
    state: "繁忙",
    stateTone: "busy",
    heartbeat: "5s",
  },
  {
    name: "agent-cn-07",
    region: "Shenzhen",
    load: "14%",
    state: "维护",
    stateTone: "muted",
    heartbeat: "1m",
  },
];
