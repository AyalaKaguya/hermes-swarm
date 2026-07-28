"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { cn } from "@/lib/utils";
import type { AgentEdge, AgentGraph, AgentNode } from "@/lib/admin-api/agents";
import type {
  AgentEditorState,
  AgentSelection,
} from "./agent-editor";

type AgentFlowCanvasProps = {
  canAddTool: boolean;
  disabled?: boolean;
  editorState: AgentEditorState;
  graph: AgentGraph;
  onAddNode: (type: AgentNode["type"]) => void;
  onConnect: (sourceNodeId: string, targetNodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onEditorStateChange: (state: AgentEditorState) => void;
  onSelectionChange: (selection: AgentSelection) => void;
  selection: AgentSelection;
};

type AgentNodeData = {
  entry: boolean;
  runtimeNode: AgentNode;
};

type AgentFlowNode = Node<AgentNodeData, "agentNode">;
type AgentFlowEdge = Edge<{ runtimeEdge: AgentEdge }>;

const nodeTypes = { agentNode: AgentNodeCard };

export function AgentFlowCanvas({
  canAddTool,
  disabled,
  editorState,
  graph,
  onAddNode,
  onConnect,
  onDeleteEdge,
  onDeleteNode,
  onEditorStateChange,
  onSelectionChange,
  selection,
}: AgentFlowCanvasProps) {
  const tr = useTextTranslation();
  const projectedNodes = useMemo<AgentFlowNode[]>(
    () =>
      graph.nodes.map((node) => ({
        data: { entry: graph.entryNodeId === node.id, runtimeNode: node },
        id: node.id,
        position: editorState.positions[node.id] ?? { x: 0, y: 0 },
        selected: selection?.kind === "node" && selection.id === node.id,
        type: "agentNode",
      })),
    [editorState.positions, graph.entryNodeId, graph.nodes, selection],
  );
  const projectedEdges = useMemo<AgentFlowEdge[]>(
    () =>
      graph.edges.map((edge) => ({
        animated: edge.kind === "error",
        data: { runtimeEdge: edge },
        id: edge.id,
        label: edgeLabel(edge, tr),
        labelBgBorderRadius: 6,
        labelBgPadding: [6, 3],
        labelBgStyle: { fill: "var(--background)", fillOpacity: 0.92 },
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 11 },
        markerEnd: { type: MarkerType.ArrowClosed },
        selected: selection?.kind === "edge" && selection.id === edge.id,
        source: edge.sourceNodeId,
        style:
          edge.kind === "error"
            ? { stroke: "var(--destructive)", strokeWidth: 1.5 }
            : { stroke: "var(--muted-foreground)", strokeWidth: 1.4 },
        target: edge.targetNodeId,
        type: "smoothstep",
      })),
    [graph.edges, selection, tr],
  );
  const [nodes, setNodes] = useState(projectedNodes);
  const [edges, setEdges] = useState(projectedEdges);

  useEffect(() => setNodes(projectedNodes), [projectedNodes]);
  useEffect(() => setEdges(projectedEdges), [projectedEdges]);

  function handleNodesChange(changes: NodeChange<AgentFlowNode>[]) {
    setNodes((current) => applyNodeChanges(changes, current));
  }

  function handleEdgesChange(changes: EdgeChange<AgentFlowEdge>[]) {
    setEdges((current) => applyEdgeChanges(changes, current));
  }

  function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    onConnect(connection.source, connection.target);
  }

  return (
    <div className="relative h-full min-h-[34rem] overflow-hidden rounded-lg bg-muted/15">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1 rounded-xl border bg-background/95 p-1.5 shadow-sm backdrop-blur">
        <PaletteButton
          disabled={disabled}
          icon="bot"
          label={tr("模型")}
          onClick={() => onAddNode("model")}
        />
        <PaletteButton
          disabled={disabled || !canAddTool}
          icon="plug"
          label={tr("工具")}
          onClick={() => onAddNode("tool")}
          title={
            canAddTool ? tr("添加工具节点") : tr("没有可用的工具授权")
          }
        />
        <PaletteButton
          disabled={disabled}
          icon="switch"
          label={tr("条件")}
          onClick={() => onAddNode("condition")}
        />
        <PaletteButton
          disabled={disabled}
          icon="check"
          label={tr("结束")}
          onClick={() => onAddNode("end")}
        />
      </div>

      <ReactFlow<AgentFlowNode, AgentFlowEdge>
        deleteKeyCode={disabled ? null : ["Backspace", "Delete"]}
        edges={edges}
        elementsSelectable={!disabled}
        elevateEdgesOnSelect
        isValidConnection={(connection) => {
          const source = graph.nodes.find((node) => node.id === connection.source);
          return Boolean(source && source.type !== "end" && connection.target);
        }}
        maxZoom={2}
        minZoom={0.3}
        multiSelectionKeyCode={null}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={!disabled}
        nodesDraggable={!disabled}
        onConnect={handleConnect}
        onEdgesChange={handleEdgesChange}
        onEdgesDelete={(deleted) => {
          for (const edge of deleted) onDeleteEdge(edge.id);
        }}
        onNodeDragStop={(_, node) => {
          onEditorStateChange({
            ...editorState,
            positions: {
              ...editorState.positions,
              [node.id]: node.position,
            },
          });
        }}
        onNodesChange={handleNodesChange}
        onNodesDelete={(deleted) => {
          for (const node of deleted) onDeleteNode(node.id);
        }}
        onPaneClick={() => onSelectionChange(null)}
        onSelectionChange={({ edges: selectedEdges, nodes: selectedNodes }) => {
          const node = selectedNodes[0];
          const edge = selectedEdges[0];
          const next: AgentSelection = node
            ? { id: node.id, kind: "node" }
            : edge
              ? { id: edge.id, kind: "edge" }
              : null;
          if (next?.id !== selection?.id || next?.kind !== selection?.kind) {
            onSelectionChange(next);
          }
        }}
        onViewportChange={(viewport) =>
          onEditorStateChange({ ...editorState, viewport })
        }
        panOnScroll
        proOptions={{ hideAttribution: true }}
        selectionOnDrag={false}
        snapGrid={[16, 16]}
        snapToGrid
        viewport={editorState.viewport}
      >
        <Background
          color="var(--border)"
          gap={20}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <Controls
          className="overflow-hidden rounded-lg! border! bg-background! shadow-sm!"
          position="bottom-left"
          showInteractive={false}
        />
        <MiniMap
          className="overflow-hidden rounded-lg! border! bg-background! shadow-sm!"
          maskColor="color-mix(in oklch, var(--background) 72%, transparent)"
          nodeColor={(node) =>
            nodeColor((node.data as AgentNodeData).runtimeNode.type)
          }
          nodeStrokeWidth={3}
          pannable
          position="bottom-right"
          zoomable
        />
      </ReactFlow>
    </div>
  );
}

function AgentNodeCard({ data, selected }: NodeProps<AgentFlowNode>) {
  const tr = useTextTranslation();
  const node = data.runtimeNode;
  const presentation = nodePresentation(node.type);
  return (
    <div
      className={cn(
        "w-56 rounded-xl border bg-card text-card-foreground shadow-sm transition-[border-color,box-shadow]",
        selected && "border-primary shadow-md ring-2 ring-primary/15",
      )}
    >
      <Handle
        className="size-2.5! border-2! border-background! bg-muted-foreground!"
        position={Position.Left}
        type="target"
      />
      <div className="flex items-start gap-3 p-3">
        <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", presentation.className)}>
          <AppIcon className="size-4" name={presentation.icon} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{node.label}</p>
            {data.entry && (
              <span className="size-1.5 shrink-0 rounded-full bg-primary" title={tr("入口节点")} />
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {nodeSummary(node, tr)}
          </p>
        </div>
        <Badge className="px-1.5" variant="outline">
          {tr(presentation.label)}
        </Badge>
      </div>
      {node.type !== "end" && (
        <Handle
          className="size-2.5! border-2! border-background! bg-primary!"
          position={Position.Right}
          type="source"
        />
      )}
    </div>
  );
}

function PaletteButton({
  disabled,
  icon,
  label,
  onClick,
  title,
}: {
  disabled?: boolean;
  icon: AppIconName;
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <Button
      disabled={disabled}
      onClick={onClick}
      size="sm"
      title={title ?? label}
      type="button"
      variant="ghost"
    >
      <AppIcon name={icon} />
      {label}
    </Button>
  );
}

function nodePresentation(type: AgentNode["type"]): {
  className: string;
  icon: AppIconName;
  label: string;
} {
  if (type === "model") {
    return {
      className: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
      icon: "bot",
      label: "模型",
    };
  }
  if (type === "tool") {
    return {
      className: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
      icon: "plug",
      label: "工具",
    };
  }
  if (type === "condition") {
    return {
      className: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
      icon: "switch",
      label: "条件",
    };
  }
  return {
    className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    icon: "check",
    label: "结束",
  };
}

function nodeSummary(node: AgentNode, tr: (value: string) => string) {
  if (node.type === "model") {
    if (node.config.model.mode === "workspaceDefault") {
      return `${tr("默认模型")} · ${node.config.model.capability}`;
    }
    if (node.config.model.mode === "pinned") {
      return node.config.model.model.modelId;
    }
    return `${tr("请求覆盖")} · ${node.config.model.allowedModels.length}`;
  }
  if (node.type === "tool") {
    return `${node.config.tool.toolDefinitionId.slice(0, 8)} · v${node.config.tool.version}`;
  }
  if (node.type === "condition") {
    return tr("{count} 个分支").replace("{count}", String(node.config.cases.length));
  }
  return node.config.result === "success" ? tr("成功") : tr("失败");
}

function edgeLabel(edge: AgentEdge, tr: (value: string) => string) {
  if (edge.kind === "condition") return edge.case;
  if (edge.kind === "error") {
    return edge.errorCodes.length > 0 ? edge.errorCodes.join(", ") : tr("错误");
  }
  return tr("默认");
}

function nodeColor(type: AgentNode["type"]) {
  if (type === "model") return "#8b5cf6";
  if (type === "tool") return "#0ea5e9";
  if (type === "condition") return "#f59e0b";
  return "#10b981";
}
