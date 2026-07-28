"use client";

import { useEffect, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useTextTranslation } from "@/hooks/use-text-translation";
import type {
  AgentEdge,
  AgentGraph,
  AgentNode,
  ModelCapability,
  WorkspaceDefaultModel,
  WorkspaceModelOption,
  WorkspaceToolGrant,
} from "@/lib/admin-api/agents";
import {
  bindingSelectValue,
  isToolGrantAvailable,
  modelBindingFromSelectValue,
  modelReferenceKey,
  toolReferenceKey,
  type AgentSelection,
} from "./agent-editor";

type AgentInspectorProps = {
  defaults: WorkspaceDefaultModel[];
  disabled?: boolean;
  graph: AgentGraph;
  modelOptions: WorkspaceModelOption[];
  onDeleteEdge: (edgeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onSetEntryNode: (nodeId: string) => void;
  onUpdateEdge: (edge: AgentEdge) => void;
  onUpdateNode: (node: AgentNode) => void;
  selection: AgentSelection;
  toolGrants: WorkspaceToolGrant[];
};

export function AgentInspector({
  defaults,
  disabled,
  graph,
  modelOptions,
  onDeleteEdge,
  onDeleteNode,
  onSetEntryNode,
  onUpdateEdge,
  onUpdateNode,
  selection,
  toolGrants,
}: AgentInspectorProps) {
  const tr = useTextTranslation();
  if (!selection) {
    return (
      <div className="grid min-h-80 place-items-center px-6 py-10 text-center">
        <div className="grid max-w-56 justify-items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl border bg-muted/40 text-muted-foreground">
            <AppIcon className="size-5" name="pencil" />
          </div>
          <div className="grid gap-1">
            <p className="font-medium">{tr("选择节点或连接")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {tr("在画布中选择一个项目以编辑运行设置")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (selection.kind === "edge") {
    const edge = graph.edges.find((item) => item.id === selection.id);
    if (!edge) return null;
    return (
      <EdgeInspector
        disabled={disabled}
        edge={edge}
        graph={graph}
        onDelete={() => onDeleteEdge(edge.id)}
        onUpdate={onUpdateEdge}
      />
    );
  }

  const node = graph.nodes.find((item) => item.id === selection.id);
  if (!node) return null;
  return (
    <NodeInspector
      defaults={defaults}
      disabled={disabled}
      graph={graph}
      modelOptions={modelOptions}
      node={node}
      onDelete={() => onDeleteNode(node.id)}
      onSetEntry={() => onSetEntryNode(node.id)}
      onUpdate={onUpdateNode}
      toolGrants={toolGrants}
    />
  );
}

function NodeInspector({
  defaults,
  disabled,
  graph,
  modelOptions,
  node,
  onDelete,
  onSetEntry,
  onUpdate,
  toolGrants,
}: {
  defaults: WorkspaceDefaultModel[];
  disabled?: boolean;
  graph: AgentGraph;
  modelOptions: WorkspaceModelOption[];
  node: AgentNode;
  onDelete: () => void;
  onSetEntry: () => void;
  onUpdate: (node: AgentNode) => void;
  toolGrants: WorkspaceToolGrant[];
}) {
  const tr = useTextTranslation();
  const isEntry = graph.entryNodeId === node.id;
  return (
    <div className="grid gap-5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium">{tr(nodeTypeLabel(node.type))}</h3>
            {isEntry && <Badge variant="secondary">{tr("入口")}</Badge>}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {node.id}
          </p>
        </div>
        <NodeTypeBadge type={node.type} />
      </div>

      <Field label={tr("节点名称")}>
        <Input
          disabled={disabled}
          maxLength={200}
          onChange={(event) => onUpdate({ ...node, label: event.target.value })}
          value={node.label}
        />
      </Field>

      {node.type === "model" && (
        <ModelNodeFields
          defaults={defaults}
          disabled={disabled}
          modelOptions={modelOptions}
          node={node}
          onUpdate={onUpdate}
        />
      )}
      {node.type === "tool" && (
        <ToolNodeFields
          disabled={disabled}
          node={node}
          onUpdate={onUpdate}
          toolGrants={toolGrants}
        />
      )}
      {node.type === "condition" && (
        <ConditionNodeFields
          disabled={disabled}
          node={node}
          onUpdate={onUpdate}
        />
      )}
      {node.type === "end" && (
        <EndNodeFields disabled={disabled} node={node} onUpdate={onUpdate} />
      )}

      <Separator />
      <div className="grid gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {tr("运行策略")}
        </p>
        <Field label={tr("超时（毫秒）")}>
          <Input
            disabled={disabled}
            max={300_000}
            min={100}
            onChange={(event) =>
              onUpdate({
                ...node,
                timeoutMs: boundedInteger(event.target.value, 100, 300_000),
              })
            }
            type="number"
            value={node.timeoutMs}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr("尝试次数")}>
            <Input
              disabled={disabled}
              max={5}
              min={1}
              onChange={(event) =>
                onUpdate({
                  ...node,
                  retry: {
                    ...node.retry,
                    maxAttempts: boundedInteger(event.target.value, 1, 5),
                  },
                })
              }
              type="number"
              value={node.retry.maxAttempts}
            />
          </Field>
          <Field label={tr("退避毫秒")}>
            <Input
              disabled={disabled}
              max={60_000}
              min={0}
              onChange={(event) =>
                onUpdate({
                  ...node,
                  retry: {
                    ...node.retry,
                    backoffMs: boundedInteger(event.target.value, 0, 60_000),
                  },
                })
              }
              type="number"
              value={node.retry.backoffMs}
            />
          </Field>
        </div>
        <Field label={tr("退避方式")}>
          <Select
            disabled={disabled}
            onValueChange={(value) =>
              onUpdate({
                ...node,
                retry: {
                  ...node.retry,
                  strategy: value as AgentNode["retry"]["strategy"],
                },
              })
            }
            value={node.retry.strategy}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">{tr("固定间隔")}</SelectItem>
              <SelectItem value="exponential">{tr("指数退避")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Separator />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled || isEntry}
          onClick={onSetEntry}
          size="sm"
          type="button"
          variant="outline"
        >
          <AppIcon name="arrow-left" />
          {tr("设为入口")}
        </Button>
        <Button
          disabled={disabled || graph.nodes.length === 1}
          onClick={onDelete}
          size="sm"
          type="button"
          variant="destructive"
        >
          <AppIcon name="trash" />
          {tr("删除节点")}
        </Button>
      </div>
    </div>
  );
}

function ModelNodeFields({
  defaults,
  disabled,
  modelOptions,
  node,
  onUpdate,
}: {
  defaults: WorkspaceDefaultModel[];
  disabled?: boolean;
  modelOptions: WorkspaceModelOption[];
  node: Extract<AgentNode, { type: "model" }>;
  onUpdate: (node: AgentNode) => void;
}) {
  const tr = useTextTranslation();
  const defaultCapabilities = uniqueCapabilities([
    ...defaults.map((item) => item.capability),
    ...(node.config.model.mode === "workspaceDefault"
      ? [node.config.model.capability]
      : []),
  ]);
  const selectValue = bindingSelectValue(node.config.model);
  const pinnedReference =
    node.config.model.mode === "pinned" ? node.config.model.model : null;
  const currentPinned =
    pinnedReference &&
    !modelOptions.some(
      (item) =>
        modelReferenceKey(item.reference) ===
        modelReferenceKey(pinnedReference),
    )
      ? pinnedReference
      : null;
  return (
    <>
      <Field label={tr("模型") }>
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            const binding = modelBindingFromSelectValue(value, modelOptions);
            if (binding) {
              onUpdate({
                ...node,
                config: { ...node.config, model: binding },
              });
            }
          }}
          value={selectValue}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={tr("选择模型")} />
          </SelectTrigger>
          <SelectContent>
            {defaultCapabilities.map((capability) => (
              <SelectItem key={capability} value={`default:${capability}`}>
                {tr("工作空间默认模型")} · {capabilityLabel(capability, tr)}
              </SelectItem>
            ))}
            {modelOptions.map((option) => (
              <SelectItem
                key={modelReferenceKey(option.reference)}
                value={`pinned:${modelReferenceKey(option.reference)}`}
              >
                {option.label}
              </SelectItem>
            ))}
            {currentPinned && (
              <SelectItem disabled value={selectValue}>
                {tr("当前模型不可用")}
              </SelectItem>
            )}
            {node.config.model.mode === "requestOverride" && (
              <SelectItem disabled value={selectValue}>
                {tr("请求覆盖策略")}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>
      <Field label={tr("系统指令")}>
        <Textarea
          className="min-h-32 resize-y"
          disabled={disabled}
          maxLength={100_000}
          onChange={(event) =>
            onUpdate({
              ...node,
              config: { ...node.config, instructions: event.target.value },
            })
          }
          placeholder={tr("说明模型在这个步骤中应完成什么")}
          value={node.config.instructions}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("温度")}>
          <Input
            disabled={disabled}
            max={2}
            min={0}
            onChange={(event) => {
              const config = { ...node.config };
              if (event.target.value === "") delete config.temperature;
              else config.temperature = boundedNumber(event.target.value, 0, 2);
              onUpdate({ ...node, config });
            }}
            placeholder={tr("默认")}
            step={0.1}
            type="number"
            value={node.config.temperature ?? ""}
          />
        </Field>
        <Field label={tr("最大输出令牌")}>
          <Input
            disabled={disabled}
            max={1_000_000}
            min={1}
            onChange={(event) => {
              const config = { ...node.config };
              if (event.target.value === "") delete config.maxOutputTokens;
              else {
                config.maxOutputTokens = boundedInteger(
                  event.target.value,
                  1,
                  1_000_000,
                );
              }
              onUpdate({ ...node, config });
            }}
            placeholder={tr("默认")}
            type="number"
            value={node.config.maxOutputTokens ?? ""}
          />
        </Field>
      </div>
    </>
  );
}

function ToolNodeFields({
  disabled,
  node,
  onUpdate,
  toolGrants,
}: {
  disabled?: boolean;
  node: Extract<AgentNode, { type: "tool" }>;
  onUpdate: (node: AgentNode) => void;
  toolGrants: WorkspaceToolGrant[];
}) {
  const tr = useTextTranslation();
  const available = toolGrants.filter((grant) => isToolGrantAvailable(grant));
  const currentKey = toolReferenceKey(node.config.tool);
  const currentAvailable = available.some(
    (grant) =>
      toolReferenceKey({
        toolDefinitionId: grant.toolDefinitionId,
        version: grant.toolVersion,
      }) === currentKey,
  );
  return (
    <>
      <Field label={tr("工具授权")}>
        <Select
          disabled={disabled || available.length === 0}
          onValueChange={(value) => {
            const grant = available.find(
              (item) =>
                toolReferenceKey({
                  toolDefinitionId: item.toolDefinitionId,
                  version: item.toolVersion,
                }) === value,
            );
            if (!grant) return;
            onUpdate({
              ...node,
              config: {
                ...node.config,
                tool: {
                  toolDefinitionId: grant.toolDefinitionId,
                  version: grant.toolVersion,
                },
              },
            });
          }}
          value={currentKey}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={tr("选择工具授权")} />
          </SelectTrigger>
          <SelectContent>
            {available.map((grant) => {
              const reference = {
                toolDefinitionId: grant.toolDefinitionId,
                version: grant.toolVersion,
              };
              return (
                <SelectItem
                  key={grant.id}
                  value={toolReferenceKey(reference)}
                >
                  {shortId(grant.toolDefinitionId)} · v{grant.toolVersion}
                </SelectItem>
              );
            })}
            {!currentAvailable && (
              <SelectItem disabled value={currentKey}>
                {tr("当前工具不可用")}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>
      <div className="rounded-lg border bg-muted/25 p-3 text-xs text-muted-foreground">
        <p className="font-mono text-foreground">
          {node.config.tool.toolDefinitionId}
        </p>
        <p className="mt-1">{tr("版本")} {node.config.tool.version}</p>
      </div>
    </>
  );
}

function ConditionNodeFields({
  disabled,
  node,
  onUpdate,
}: {
  disabled?: boolean;
  node: Extract<AgentNode, { type: "condition" }>;
  onUpdate: (node: AgentNode) => void;
}) {
  const tr = useTextTranslation();
  const [casesValue, setCasesValue] = useState(node.config.cases.join(", "));

  useEffect(() => {
    setCasesValue(node.config.cases.join(", "));
  }, [node.config.cases, node.id]);

  function commitCases() {
    const cases = parseRuntimeList(casesValue).slice(0, 50);
    setCasesValue(cases.join(", "));
    onUpdate({
      ...node,
      config: { ...node.config, cases },
    });
  }

  return (
    <>
      <Field label={tr("值路径")}>
        <Input
          disabled={disabled}
          maxLength={512}
          onChange={(event) =>
            onUpdate({
              ...node,
              config: { ...node.config, sourcePath: event.target.value },
            })
          }
          placeholder="/result"
          value={node.config.sourcePath}
        />
      </Field>
      <Field hint={tr("使用逗号分隔分支名称")} label={tr("分支")}>
        <Input
          disabled={disabled}
          onBlur={commitCases}
          onChange={(event) => setCasesValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitCases();
            }
          }}
          value={casesValue}
        />
      </Field>
    </>
  );
}

function EndNodeFields({
  disabled,
  node,
  onUpdate,
}: {
  disabled?: boolean;
  node: Extract<AgentNode, { type: "end" }>;
  onUpdate: (node: AgentNode) => void;
}) {
  const tr = useTextTranslation();
  return (
    <>
      <Field label={tr("结果状态")}>
        <Select
          disabled={disabled}
          onValueChange={(value) =>
            onUpdate({
              ...node,
              config: {
                ...node.config,
                result: value as "failure" | "success",
              },
            })
          }
          value={node.config.result}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="success">{tr("成功")}</SelectItem>
            <SelectItem value="failure">{tr("失败")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field hint={tr("留空时返回完整结果")} label={tr("输出路径")}>
        <Input
          disabled={disabled}
          maxLength={512}
          onChange={(event) =>
            onUpdate({
              ...node,
              config: {
                ...node.config,
                outputPath: event.target.value || null,
              },
            })
          }
          placeholder="/answer"
          value={node.config.outputPath ?? ""}
        />
      </Field>
    </>
  );
}

function EdgeInspector({
  disabled,
  edge,
  graph,
  onDelete,
  onUpdate,
}: {
  disabled?: boolean;
  edge: AgentEdge;
  graph: AgentGraph;
  onDelete: () => void;
  onUpdate: (edge: AgentEdge) => void;
}) {
  const tr = useTextTranslation();
  const source = graph.nodes.find((node) => node.id === edge.sourceNodeId);
  const target = graph.nodes.find((node) => node.id === edge.targetNodeId);
  const [errorCodesValue, setErrorCodesValue] = useState(
    edge.kind === "error" ? edge.errorCodes.join(", ") : "",
  );

  useEffect(() => {
    setErrorCodesValue(
      edge.kind === "error" ? edge.errorCodes.join(", ") : "",
    );
  }, [edge]);

  function commitErrorCodes() {
    if (edge.kind !== "error") return;
    const errorCodes = parseRuntimeList(errorCodesValue).slice(0, 50);
    setErrorCodesValue(errorCodes.join(", "));
    onUpdate({ ...edge, errorCodes });
  }

  return (
    <div className="grid gap-5 p-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">{tr("连接设置")}</h3>
          <Badge variant="outline">{tr(edgeKindLabel(edge.kind))}</Badge>
        </div>
        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {edge.id}
        </p>
      </div>

      <div className="grid gap-2 rounded-lg border bg-muted/25 p-3 text-xs">
        <EdgeEndpoint label={tr("来源")} value={source?.label ?? edge.sourceNodeId} />
        <div className="h-px bg-border" />
        <EdgeEndpoint label={tr("目标")} value={target?.label ?? edge.targetNodeId} />
      </div>

      <Field label={tr("连接类型")}>
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            if (value === "default") {
              onUpdate({
                id: edge.id,
                kind: "default",
                sourceNodeId: edge.sourceNodeId,
                targetNodeId: edge.targetNodeId,
              });
            } else if (value === "error") {
              onUpdate({
                errorCodes: edge.kind === "error" ? edge.errorCodes : [],
                id: edge.id,
                kind: "error",
                sourceNodeId: edge.sourceNodeId,
                targetNodeId: edge.targetNodeId,
              });
            } else if (source?.type === "condition") {
              onUpdate({
                case:
                  edge.kind === "condition"
                    ? edge.case
                    : (source.config.cases[0] ?? "case"),
                id: edge.id,
                kind: "condition",
                sourceNodeId: edge.sourceNodeId,
                targetNodeId: edge.targetNodeId,
              });
            }
          }}
          value={edge.kind}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{tr("默认路径")}</SelectItem>
            <SelectItem disabled={source?.type !== "condition"} value="condition">
              {tr("条件分支")}
            </SelectItem>
            <SelectItem value="error">{tr("错误路径")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {edge.kind === "condition" && source?.type === "condition" && (
        <Field label={tr("分支值")}>
          <Select
            disabled={disabled}
            onValueChange={(value) => onUpdate({ ...edge, case: value })}
            value={edge.case}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {source.config.cases.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {edge.kind === "error" && (
        <Field hint={tr("留空时匹配任意错误")} label={tr("错误代码")}>
          <Input
            disabled={disabled}
            onBlur={commitErrorCodes}
            onChange={(event) => setErrorCodesValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitErrorCodes();
              }
            }}
            value={errorCodesValue}
          />
        </Field>
      )}

      <Separator />
      <Button
        disabled={disabled}
        onClick={onDelete}
        size="sm"
        type="button"
        variant="destructive"
      >
        <AppIcon name="trash" />
        {tr("删除连接")}
      </Button>
    </div>
  );
}

function Field({
  children,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NodeTypeBadge({ type }: { type: AgentNode["type"] }) {
  const tr = useTextTranslation();
  return <Badge variant="outline">{tr(nodeTypeLabel(type))}</Badge>;
}

function EdgeEndpoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function nodeTypeLabel(type: AgentNode["type"]) {
  if (type === "model") return "模型节点";
  if (type === "tool") return "工具节点";
  if (type === "condition") return "条件节点";
  return "结束节点";
}

function edgeKindLabel(kind: AgentEdge["kind"]) {
  if (kind === "condition") return "条件分支";
  if (kind === "error") return "错误路径";
  return "默认路径";
}

function capabilityLabel(
  capability: ModelCapability,
  tr: (value: string) => string,
) {
  if (capability === "chat") return tr("对话");
  if (capability === "embedding") return tr("向量嵌入");
  if (capability === "rerank") return tr("重排序");
  if (capability === "speechToText") return tr("语音转文字");
  return tr("文字转语音");
}

function uniqueCapabilities(values: ModelCapability[]) {
  return [...new Set(values)];
}

function parseRuntimeList(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function boundedInteger(value: string, min: number, max: number) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));
}

function boundedNumber(value: string, min: number, max: number) {
  const parsed = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
