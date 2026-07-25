"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentDefinitionSchema } from "@hermes-swarm/api-contracts/ai";
import { AppIcon } from "@/components/app-icon";
import { InlineNotice } from "@/components/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/i18n-provider";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  createAgent,
  getAgent,
  getAgentDraft,
  getAgentVersion,
  listAgents,
  listAgentVersions,
  listWorkspaceModelDefaults,
  listWorkspaceModelDeployments,
  listWorkspaceModelProviders,
  listWorkspaceToolGrants,
  publishAgentDraft,
  replaceAgentDraft,
  toWorkspaceModelOptions,
  updateAgent,
  type Agent,
  type AgentDraft,
  type AgentEdge,
  type AgentGraph,
  type AgentNode,
  type AgentStatus,
  type AgentVersion,
  type AgentVersionSummary,
  type WorkspaceDefaultModel,
  type WorkspaceModelOption,
  type WorkspaceToolGrant,
} from "@/lib/admin-api/agents";
import { AdminApiError } from "@/lib/admin-api/client";
import { requireAuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import { formatRuntimeDateTime } from "@/lib/runtime-format";
import { AgentFlowCanvas } from "./agent-flow-canvas";
import { AgentInspector } from "./agent-inspector";
import {
  connectAgentNodes,
  createAgentNode,
  createStarterAgentDefinition,
  definitionFingerprint,
  deriveAgentDefinition,
  isToolGrantAvailable,
  loadAgentEditorState,
  nextNodePosition,
  normalizeEditorState,
  removeAgentEdge,
  removeAgentNode,
  replaceAgentEdge,
  replaceAgentNode,
  saveAgentEditorState,
  type AgentEditorState,
  type AgentSelection,
} from "./agent-editor";

type AgentForm = {
  description: string;
  name: string;
  status: AgentStatus;
};

type Inventory = {
  defaults: WorkspaceDefaultModel[];
  modelOptions: WorkspaceModelOption[];
  toolGrants: WorkspaceToolGrant[];
};

const EMPTY_FORM: AgentForm = {
  description: "",
  name: "",
  status: "active",
};

export function AgentStudio() {
  const tr = useTextTranslation();
  const { runtimePreferences } = useI18n();
  const detailRequest = useRef(0);
  const selectedAgentIdRef = useRef<string | null>(null);
  const loadedAgentIdRef = useRef<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [loadedAgentId, setLoadedAgentId] = useState<string | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [graph, setGraph] = useState<AgentGraph | null>(null);
  const [editorState, setEditorState] = useState<AgentEditorState | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [selection, setSelection] = useState<AgentSelection>(null);
  const [versions, setVersions] = useState<AgentVersionSummary[]>([]);
  const [inventory, setInventory] = useState<Inventory>({
    defaults: [],
    modelOptions: [],
    toolGrants: [],
  });
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createForm, setCreateForm] = useState<AgentForm>(EMPTY_FORM);
  const [settingsForm, setSettingsForm] = useState<AgentForm>(EMPTY_FORM);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<AgentVersion | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setInventoryError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const [agentResult, inventoryResult] = await Promise.allSettled([
        listAgents(session),
        loadInventory(session),
      ]);
      if (agentResult.status === "rejected") throw agentResult.reason;
      const nextAgents = agentResult.value;
      setAgents(nextAgents);
      setSelectedAgentId((current) =>
        current && nextAgents.some((item) => item.id === current)
          ? current
          : (nextAgents[0]?.id ?? null),
      );
      if (inventoryResult.status === "fulfilled") {
        setInventory(inventoryResult.value);
      } else {
        setInventoryError(errorMessage(inventoryResult.reason, tr));
      }
    } catch (error) {
      setLoadError(errorMessage(error, tr));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  const loadSelectedAgent = useCallback(
    async (agentId: string) => {
      const request = ++detailRequest.current;
      setDetailLoading(true);
      setActionError(null);
      setSuccessMessage(null);
      setLoadedAgentId(null);
      setAgent(null);
      setDraft(null);
      setGraph(null);
      setEditorState(null);
      setSelection(null);
      try {
        const session = await requireAuthenticatedAdminSessionMarker();
        const [nextAgent, nextDraft, nextVersions] = await Promise.all([
          getAgent(session, agentId),
          getAgentDraft(session, agentId),
          listAgentVersions(session, agentId),
        ]);
        if (request !== detailRequest.current) return;
        const definition = definitionFromDraft(nextDraft);
        setAgent(nextAgent);
        setDraft(nextDraft);
        setGraph(nextDraft.graph);
        setVersions(nextVersions);
        setSavedFingerprint(definitionFingerprint(definition));
        setEditorState(loadAgentEditorState(agentId, nextDraft.graph));
        setLoadedAgentId(agentId);
      } catch (error) {
        if (request === detailRequest.current) {
          setActionError(errorMessage(error, tr));
        }
      } finally {
        if (request === detailRequest.current) setDetailLoading(false);
      }
    },
    [tr],
  );

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    loadedAgentIdRef.current = loadedAgentId;
  }, [loadedAgentId]);

  useEffect(() => {
    if (selectedAgentId) void loadSelectedAgent(selectedAgentId);
    else {
      setAgent(null);
      setDraft(null);
      setGraph(null);
      setEditorState(null);
      setLoadedAgentId(null);
    }
  }, [loadSelectedAgent, selectedAgentId]);

  useEffect(() => {
    if (
      selectedAgentId &&
      loadedAgentId === selectedAgentId &&
      editorState
    ) {
      saveAgentEditorState(selectedAgentId, editorState);
    }
  }, [editorState, loadedAgentId, selectedAgentId]);

  const definition = useMemo(
    () => (graph ? deriveAgentDefinition(graph) : null),
    [graph],
  );
  const currentFingerprint = useMemo(
    () => (definition ? definitionFingerprint(definition) : ""),
    [definition],
  );
  const dirty = Boolean(definition && currentFingerprint !== savedFingerprint);
  const busy = saving || publishing || updating;
  const availableToolGrants = useMemo(
    () => inventory.toolGrants.filter((grant) => isToolGrantAvailable(grant)),
    [inventory.toolGrants],
  );

  function clearFeedback() {
    setActionError(null);
    setSuccessMessage(null);
  }

  function isCurrentAgent(agentId: string) {
    return (
      selectedAgentIdRef.current === agentId &&
      loadedAgentIdRef.current === agentId
    );
  }

  function selectAgent(nextAgentId: string) {
    if (
      nextAgentId === selectedAgentId ||
      busy ||
      creating ||
      detailLoading
    ) {
      return;
    }
    if (dirty && !window.confirm(tr("切换 Agent 将放弃未保存的草稿，是否继续？"))) {
      return;
    }
    selectedAgentIdRef.current = nextAgentId;
    setSelectedAgentId(nextAgentId);
  }

  async function saveDraft() {
    if (!agent || !draft || !definition) return;
    const operationAgentId = agent.id;
    clearFeedback();
    const validation = AgentDefinitionSchema.safeParse(definition);
    if (!validation.success) {
      setActionError(validation.error.issues[0]?.message ?? tr("草稿内容无效"));
      return;
    }
    const previousFingerprint = savedFingerprint;
    const optimisticFingerprint = definitionFingerprint(validation.data);
    setSavedFingerprint(optimisticFingerprint);
    setSaving(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const nextDraft = await replaceAgentDraft(session, agent.id, {
        expectedRevision: draft.revision,
        ...validation.data,
      });
      if (!isCurrentAgent(operationAgentId)) return;
      const nextDefinition = definitionFromDraft(nextDraft);
      setDraft(nextDraft);
      setGraph(nextDraft.graph);
      setSavedFingerprint(definitionFingerprint(nextDefinition));
      setSuccessMessage(tr("草稿已保存"));
    } catch (error) {
      if (isCurrentAgent(operationAgentId)) {
        setSavedFingerprint(previousFingerprint);
        setActionError(errorMessage(error, tr));
      }
    } finally {
      setSaving(false);
    }
  }

  async function publishDraft() {
    if (!agent || !draft || !definition) return;
    const operationAgentId = agent.id;
    clearFeedback();
    if (dirty) {
      setActionError(tr("发布前请先保存草稿"));
      return;
    }
    const validation = AgentDefinitionSchema.safeParse(definition);
    if (!validation.success) {
      setActionError(validation.error.issues[0]?.message ?? tr("草稿内容无效"));
      return;
    }
    setPublishing(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const version = await publishAgentDraft(session, agent.id, {
        expectedRevision: draft.revision,
      });
      if (!isCurrentAgent(operationAgentId)) return;
      setVersions((current) => [
        versionSummary(version),
        ...current.filter((item) => item.version !== version.version),
      ]);
      setAgent((current) =>
        current ? { ...current, latestVersion: version.version } : current,
      );
      setAgents((current) =>
        current.map((item) =>
          item.id === agent.id
            ? { ...item, latestVersion: version.version }
            : item,
        ),
      );
      setSuccessMessage(
        tr("版本 {version} 已发布").replace("{version}", String(version.version)),
      );
    } catch (error) {
      if (isCurrentAgent(operationAgentId)) {
        setActionError(errorMessage(error, tr));
      }
    } finally {
      setPublishing(false);
    }
  }

  async function submitCreate() {
    const name = createForm.name.trim();
    if (!name) return;
    clearFeedback();
    setCreating(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const starter = createStarterAgentDefinition(
        inventory.modelOptions,
        inventory.defaults,
      );
      const nextAgent = await createAgent(session, {
        description: createForm.description.trim(),
        name,
        status: createForm.status,
        ...starter,
      });
      setAgents((current) => [...current, nextAgent]);
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      selectedAgentIdRef.current = nextAgent.id;
      setSelectedAgentId(nextAgent.id);
      setSuccessMessage(tr("Agent 已创建"));
    } catch (error) {
      setActionError(errorMessage(error, tr));
    } finally {
      setCreating(false);
    }
  }

  async function submitSettings() {
    if (!agent) return;
    const operationAgentId = agent.id;
    const name = settingsForm.name.trim();
    if (!name) return;
    clearFeedback();
    setUpdating(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const nextAgent = await updateAgent(session, agent.id, {
        description: settingsForm.description.trim(),
        expectedRevision: agent.revision,
        name,
        status: settingsForm.status,
      });
      setAgents((current) =>
        current.map((item) => (item.id === nextAgent.id ? nextAgent : item)),
      );
      if (isCurrentAgent(operationAgentId)) {
        setAgent(nextAgent);
        setSettingsOpen(false);
        setSuccessMessage(tr("Agent 设置已更新"));
      }
    } catch (error) {
      if (isCurrentAgent(operationAgentId)) {
        setActionError(errorMessage(error, tr));
      }
    } finally {
      setUpdating(false);
    }
  }

  async function reloadInventory() {
    setInventoryError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      setInventory(await loadInventory(session));
    } catch (error) {
      setInventoryError(errorMessage(error, tr));
    }
  }

  async function inspectVersion(version: number) {
    if (!agent) return;
    const operationAgentId = agent.id;
    setVersionLoading(true);
    setVersionError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const nextVersion = await getAgentVersion(session, agent.id, version);
      if (isCurrentAgent(operationAgentId)) setSelectedVersion(nextVersion);
    } catch (error) {
      if (isCurrentAgent(operationAgentId)) {
        setVersionError(errorMessage(error, tr));
      }
    } finally {
      setVersionLoading(false);
    }
  }

  function openVersions() {
    setVersionsOpen(true);
    const latest = versions[0];
    if (latest) void inspectVersion(latest.version);
  }

  function openSettings() {
    if (!agent) return;
    setSettingsForm({
      description: agent.description,
      name: agent.name,
      status: agent.status,
    });
    setSettingsOpen(true);
  }

  function addNode(type: AgentNode["type"]) {
    if (!graph || !editorState) return;
    clearFeedback();
    try {
      let node: AgentNode;
      if (type === "tool") {
        const grant = availableToolGrants[0];
        if (!grant) {
          setActionError(tr("没有可用的工具授权"));
          return;
        }
        node = createAgentNode(type, {
          tool: {
            toolDefinitionId: grant.toolDefinitionId,
            version: grant.toolVersion,
          },
        });
      } else if (type === "model") {
        const starter = createStarterAgentDefinition(
          inventory.modelOptions,
          inventory.defaults,
        );
        const starterNode = starter.graph.nodes.find(
          (item): item is Extract<AgentNode, { type: "model" }> =>
            item.type === "model",
        );
        node = createAgentNode(type, { model: starterNode?.config.model });
      } else {
        node = createAgentNode(type);
      }
      const position = nextNodePosition(editorState, graph.nodes.length);
      setGraph({ ...graph, nodes: [...graph.nodes, node] });
      setEditorState({
        ...editorState,
        positions: { ...editorState.positions, [node.id]: position },
      });
      setSelection({ id: node.id, kind: "node" });
    } catch (error) {
      setActionError(errorMessage(error, tr));
    }
  }

  function connectNodes(sourceNodeId: string, targetNodeId: string) {
    if (!graph) return;
    const result = connectAgentNodes(graph, sourceNodeId, targetNodeId);
    if (!result.ok) {
      setActionError(connectionIssueMessage(result.issue, tr));
      return;
    }
    setGraph({ ...graph, edges: [...graph.edges, result.edge] });
    setSelection({ id: result.edge.id, kind: "edge" });
  }

  function deleteNode(nodeId: string) {
    if (!graph || !editorState) return;
    const nextGraph = removeAgentNode(graph, nodeId);
    if (nextGraph === graph) return;
    const { [nodeId]: _removed, ...positions } = editorState.positions;
    setGraph(nextGraph);
    setEditorState(normalizeEditorState(nextGraph, { ...editorState, positions }));
    setSelection(null);
  }

  function deleteEdge(edgeId: string) {
    if (!graph) return;
    setGraph(removeAgentEdge(graph, edgeId));
    setSelection(null);
  }

  function updateNode(node: AgentNode) {
    if (graph) setGraph(replaceAgentNode(graph, node));
  }

  function updateEdge(edge: AgentEdge) {
    if (graph) setGraph(replaceAgentEdge(graph, edge));
  }

  if (loading) return <AgentStudioLoading />;

  if (loadError) {
    return (
      <div className="mx-auto grid w-full max-w-7xl gap-4">
        <PageHeading />
        <InlineNotice title={tr("Agent Studio 加载失败")} tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button onClick={() => void loadCatalog()} size="sm" variant="outline">
              {tr("重试")}
            </Button>
          </div>
        </InlineNotice>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[100rem] flex-col gap-4">
      <PageHeading />

      <Card size="sm">
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-60 flex-1 gap-1.5">
            <Label>{tr("Agent")}</Label>
            <Select
              disabled={
                detailLoading || busy || creating || agents.length === 0
              }
              onValueChange={selectAgent}
              value={selectedAgentId ?? undefined}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={tr("选择 Agent")} />
              </SelectTrigger>
              <SelectContent>
                {agents.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={detailLoading || busy || creating}
            onClick={() => {
              if (
                dirty &&
                !window.confirm(
                  tr("新建 Agent 将放弃当前未保存的草稿，是否继续？"),
                )
              ) {
                return;
              }
              setCreateForm(EMPTY_FORM);
              setCreateOpen(true);
            }}
            type="button"
            variant="outline"
          >
            <AppIcon name="plus" />
            {tr("新建 Agent")}
          </Button>

          {agent && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Badge variant={agent.status === "active" ? "secondary" : "outline"}>
                {agent.status === "active" ? tr("启用") : tr("已归档")}
              </Badge>
              {dirty && <Badge variant="outline">{tr("未保存")}</Badge>}
              <Button
                disabled={busy}
                onClick={openVersions}
                type="button"
                variant="outline"
              >
                <AppIcon name="layers" />
                {tr("版本")}
                {agent.latestVersion > 0 && (
                  <span className="text-muted-foreground">{agent.latestVersion}</span>
                )}
              </Button>
              <Button
                aria-label={tr("Agent 设置")}
                disabled={busy}
                onClick={openSettings}
                title={tr("Agent 设置")}
                type="button"
                variant="outline"
              >
                <AppIcon name="settings" />
                {tr("设置")}
              </Button>
              <Button
                disabled={busy || !dirty}
                onClick={() => void saveDraft()}
                type="button"
                variant="outline"
              >
                {saving ? <Spinner /> : <AppIcon name="check" />}
                {saving ? tr("保存中") : tr("保存草稿")}
              </Button>
              <Button
                disabled={busy || dirty || agent.status === "archived"}
                onClick={() => void publishDraft()}
                title={
                  agent.status === "archived"
                    ? tr("归档 Agent 不能发布新版本")
                    : undefined
                }
                type="button"
              >
                {publishing ? <Spinner /> : <AppIcon name="upload" />}
                {publishing ? tr("发布中") : tr("发布")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {inventoryError && (
        <InlineNotice title={tr("模型与工具目录暂不可用")} tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{inventoryError}</span>
            <Button
              onClick={() => void reloadInventory()}
              size="sm"
              variant="outline"
            >
              {tr("重新加载目录")}
            </Button>
          </div>
        </InlineNotice>
      )}

      {actionError && (
        <InlineNotice title={tr("操作未完成")} tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{actionError}</span>
            {selectedAgentId && (
              <Button
                disabled={detailLoading}
                onClick={() => void loadSelectedAgent(selectedAgentId)}
                size="sm"
                variant="outline"
              >
                {tr("重新加载草稿")}
              </Button>
            )}
          </div>
        </InlineNotice>
      )}
      {successMessage && (
        <InlineNotice tone="success">{successMessage}</InlineNotice>
      )}

      {detailLoading ? (
        <AgentDetailLoading />
      ) : !agent || !draft || !graph || !editorState ? (
        agents.length === 0 ? (
          <EmptyAgents onCreate={() => setCreateOpen(true)} />
        ) : (
          <AgentUnavailable
            onRetry={() =>
              selectedAgentId && void loadSelectedAgent(selectedAgentId)
            }
          />
        )
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="min-h-[40rem] gap-0 py-0" size="sm">
            <CardHeader className="border-b py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate">{agent.name}</CardTitle>
                  <CardDescription className="mt-0.5 line-clamp-1">
                    {agent.description || tr("连接节点以设计 Agent 的运行流程")}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {tr("草稿修订 {revision}").replace(
                      "{revision}",
                      String(draft.revision),
                    )}
                  </span>
                  <span>·</span>
                  <span>
                    {tr("{nodes} 个节点").replace(
                      "{nodes}",
                      String(graph.nodes.length),
                    )}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
              <AgentFlowCanvas
                canAddTool={availableToolGrants.length > 0}
                disabled={busy}
                editorState={editorState}
                graph={graph}
                onAddNode={addNode}
                onConnect={connectNodes}
                onDeleteEdge={deleteEdge}
                onDeleteNode={deleteNode}
                onEditorStateChange={setEditorState}
                onSelectionChange={setSelection}
                selection={selection}
              />
            </CardContent>
          </Card>

          <Card className="min-h-[40rem] gap-0 py-0" size="sm">
            <CardHeader className="border-b py-3">
              <CardTitle>{tr("检查器")}</CardTitle>
              <CardDescription>{tr("编辑所选节点或连接")}</CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto p-0">
              <AgentInspector
                defaults={inventory.defaults}
                disabled={busy}
                graph={graph}
                modelOptions={inventory.modelOptions}
                onDeleteEdge={deleteEdge}
                onDeleteNode={deleteNode}
                onSetEntryNode={(nodeId) =>
                  setGraph({ ...graph, entryNodeId: nodeId })
                }
                onUpdateEdge={updateEdge}
                onUpdateNode={updateNode}
                selection={selection}
                toolGrants={inventory.toolGrants}
              />
            </CardContent>
          </Card>
        </div>
      )}

      <AgentFormDialog
        form={createForm}
        loading={creating}
        mode="create"
        onChange={setCreateForm}
        onOpenChange={setCreateOpen}
        onSubmit={() => void submitCreate()}
        open={createOpen}
      />
      <AgentFormDialog
        form={settingsForm}
        loading={updating}
        mode="settings"
        onChange={setSettingsForm}
        onOpenChange={setSettingsOpen}
        onSubmit={() => void submitSettings()}
        open={settingsOpen}
      />
      <VersionsDialog
        error={versionError}
        loading={versionLoading}
        onInspect={(version) => void inspectVersion(version)}
        onOpenChange={(open) => {
          setVersionsOpen(open);
          if (!open) {
            setSelectedVersion(null);
            setVersionError(null);
          }
        }}
        open={versionsOpen}
        preferences={runtimePreferences}
        selected={selectedVersion}
        versions={versions}
      />
    </div>
  );
}

function PageHeading() {
  const tr = useTextTranslation();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {tr("Agent Studio")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr("设计、保存并发布当前工作空间的 Agent 流程")}
        </p>
      </div>
    </div>
  );
}

function EmptyAgents({ onCreate }: { onCreate: () => void }) {
  const tr = useTextTranslation();
  return (
    <Card className="min-h-[34rem]" size="sm">
      <CardContent className="grid flex-1 place-items-center py-12 text-center">
        <div className="grid max-w-sm justify-items-center gap-4">
          <div className="grid size-14 place-items-center rounded-2xl border bg-muted/35 text-muted-foreground">
            <AppIcon className="size-6" name="bot" />
          </div>
          <div>
            <h2 className="font-heading text-lg font-medium">{tr("创建第一个 Agent")}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {tr("从模型与结束节点开始，再添加工具和条件分支")}
            </p>
          </div>
          <Button onClick={onCreate} type="button">
            <AppIcon name="plus" />
            {tr("新建 Agent")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentUnavailable({ onRetry }: { onRetry: () => void }) {
  const tr = useTextTranslation();
  return (
    <Card className="min-h-[28rem]" size="sm">
      <CardContent className="grid flex-1 place-items-center py-12 text-center">
        <div className="grid max-w-sm justify-items-center gap-4">
          <div className="grid size-12 place-items-center rounded-xl border bg-muted/35 text-muted-foreground">
            <AppIcon className="size-5" name="refresh" />
          </div>
          <div>
            <h2 className="font-heading text-lg font-medium">
              {tr("草稿暂不可用")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {tr("重新加载以获取最新的 Agent 草稿")}
            </p>
          </div>
          <Button onClick={onRetry} type="button" variant="outline">
            <AppIcon name="refresh" />
            {tr("重新加载草稿")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentFormDialog({
  form,
  loading,
  mode,
  onChange,
  onOpenChange,
  onSubmit,
  open,
}: {
  form: AgentForm;
  loading: boolean;
  mode: "create" | "settings";
  onChange: (form: AgentForm) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  open: boolean;
}) {
  const tr = useTextTranslation();
  const creating = mode === "create";
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {creating ? tr("新建 Agent") : tr("Agent 设置")}
            </DialogTitle>
            <DialogDescription>
              {creating
                ? tr("创建后可在画布中完善流程并发布版本")
                : tr("更新 Agent 的名称、说明与可用状态")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`${mode}-agent-name`}>{tr("名称")}</Label>
            <Input
              autoFocus
              disabled={loading}
              id={`${mode}-agent-name`}
              maxLength={120}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              placeholder={tr("例如：支持助手")}
              required
              value={form.name}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${mode}-agent-description`}>{tr("说明")}</Label>
            <Textarea
              disabled={loading}
              id={`${mode}-agent-description`}
              maxLength={2_000}
              onChange={(event) =>
                onChange({ ...form, description: event.target.value })
              }
              placeholder={tr("说明这个 Agent 适合处理什么任务")}
              value={form.description}
            />
          </div>
          {!creating && (
            <div className="grid gap-1.5">
              <Label>{tr("状态")}</Label>
              <Select
                disabled={loading}
                onValueChange={(value) =>
                  onChange({ ...form, status: value as AgentStatus })
                }
                value={form.status}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{tr("启用")}</SelectItem>
                  <SelectItem value="archived">{tr("归档")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={loading}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {tr("取消")}
            </Button>
            <Button disabled={loading || !form.name.trim()} type="submit">
              {loading && <Spinner />}
              {loading
                ? creating
                  ? tr("创建中")
                  : tr("保存中")
                : creating
                  ? tr("创建")
                  : tr("保存")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VersionsDialog({
  error,
  loading,
  onInspect,
  onOpenChange,
  open,
  preferences,
  selected,
  versions,
}: {
  error: string | null;
  loading: boolean;
  onInspect: (version: number) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  preferences: Parameters<typeof formatRuntimeDateTime>[1];
  selected: AgentVersion | null;
  versions: AgentVersionSummary[];
}) {
  const tr = useTextTranslation();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="grid h-[min(42rem,calc(100svh-2rem))] w-[min(58rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{tr("已发布版本")}</DialogTitle>
          <DialogDescription>
            {tr("版本是不可变的 Agent 流程快照")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="overflow-y-auto border-b p-3 md:border-b-0 md:border-r">
            {versions.length === 0 ? (
              <div className="grid min-h-40 place-items-center text-center text-sm text-muted-foreground">
                {tr("尚未发布版本")}
              </div>
            ) : (
              <div className="grid gap-2">
                {versions.map((version) => (
                  <button
                    className={
                      selected?.version === version.version
                        ? "grid gap-1 rounded-lg border border-primary bg-primary/5 px-3 py-2 text-left"
                        : "grid gap-1 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/50"
                    }
                    key={version.id}
                    onClick={() => onInspect(version.version)}
                    type="button"
                  >
                    <span className="font-medium">
                      {tr("版本 {version}").replace(
                        "{version}",
                        String(version.version),
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatRuntimeDateTime(version.publishedAt, preferences)}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {version.contentDigest.slice(0, 16)}…
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-h-0 overflow-y-auto p-5">
            {loading ? (
              <div className="grid h-full place-items-center">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  {tr("版本加载中")}
                </div>
              </div>
            ) : error ? (
              <InlineNotice tone="error">{error}</InlineNotice>
            ) : selected ? (
              <VersionDetails preferences={preferences} version={selected} />
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                {tr("选择一个版本查看快照")}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VersionDetails({
  preferences,
  version,
}: {
  preferences: Parameters<typeof formatRuntimeDateTime>[1];
  version: AgentVersion;
}) {
  const tr = useTextTranslation();
  return (
    <div className="grid gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-heading text-lg font-medium">
            {tr("版本 {version}").replace("{version}", String(version.version))}
          </h3>
          <Badge variant="secondary">
            {tr("草稿修订 {revision}").replace(
              "{revision}",
              String(version.draftRevision),
            )}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatRuntimeDateTime(version.publishedAt, preferences)}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <VersionMetric label={tr("节点")} value={version.graph.nodes.length} />
        <VersionMetric label={tr("模型")} value={version.modelReferences.length} />
        <VersionMetric label={tr("工具")} value={version.toolReferences.length} />
      </div>
      <Separator />
      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {tr("流程节点")}
        </p>
        {version.graph.nodes.map((node) => (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
            key={node.id}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{node.label}</p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {node.id}
              </p>
            </div>
            <Badge variant="outline">{tr(versionNodeTypeLabel(node.type))}</Badge>
          </div>
        ))}
      </div>
      <Separator />
      <div className="grid gap-1">
        <p className="text-xs text-muted-foreground">{tr("内容摘要")}</p>
        <code className="break-all rounded-lg bg-muted/40 p-3 text-[11px]">
          {version.contentDigest}
        </code>
      </div>
    </div>
  );
}

function VersionMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-center">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function AgentStudioLoading() {
  return (
    <div className="mx-auto grid w-full max-w-[100rem] gap-4">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <AgentDetailLoading />
    </div>
  );
}

function AgentDetailLoading() {
  return (
    <div className="grid min-h-[40rem] gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Skeleton className="h-full min-h-[40rem] rounded-xl" />
      <Skeleton className="h-full min-h-[40rem] rounded-xl" />
    </div>
  );
}

async function loadInventory(
  session: Awaited<ReturnType<typeof requireAuthenticatedAdminSessionMarker>>,
): Promise<Inventory> {
  const [providers, defaults, toolGrants] = await Promise.all([
    listWorkspaceModelProviders(session),
    listWorkspaceModelDefaults(session),
    listWorkspaceToolGrants(session),
  ]);
  const deployments = (
    await Promise.all(
      providers
        .filter((provider) => provider.status === "enabled")
        .map((provider) => listWorkspaceModelDeployments(session, provider.id)),
    )
  ).flat();
  return {
    defaults,
    modelOptions: toWorkspaceModelOptions(providers, deployments),
    toolGrants,
  };
}

function definitionFromDraft(draft: AgentDraft) {
  return {
    graph: draft.graph,
    modelReferences: draft.modelReferences,
    toolReferences: draft.toolReferences,
  };
}

function versionSummary(version: AgentVersion): AgentVersionSummary {
  return {
    agentId: version.agentId,
    apiVersion: version.apiVersion,
    contentDigest: version.contentDigest,
    draftRevision: version.draftRevision,
    id: version.id,
    publishedAt: version.publishedAt,
    version: version.version,
  };
}

function connectionIssueMessage(
  issue: "branchUnavailable" | "endSource" | "missingNode",
  tr: (value: string) => string,
) {
  if (issue === "endSource") return tr("结束节点不能创建出站连接");
  if (issue === "branchUnavailable") return tr("这个节点没有可用的出站分支");
  return tr("连接的节点已不存在");
}

function versionNodeTypeLabel(type: AgentNode["type"]) {
  if (type === "model") return "模型节点";
  if (type === "tool") return "工具节点";
  if (type === "condition") return "条件节点";
  return "结束节点";
}

function errorMessage(error: unknown, tr: (value: string) => string) {
  if (error instanceof AdminApiError) {
    if (
      error.code === "AI_AGENT_DRAFT_REVISION_CONFLICT" ||
      error.code === "AI_AGENT_REVISION_CONFLICT"
    ) {
      return tr("内容已被其他人更新，请重新加载后再试");
    }
    if (error.code === "AI_AGENT_REFERENCE_UNAVAILABLE") {
      return tr("草稿引用的模型或工具当前不可用，请更新选择后重试");
    }
    if (error.code === "AI_AGENT_ARCHIVED") {
      return tr("归档 Agent 不能发布新版本");
    }
  }
  return error instanceof Error ? tr(error.message) : tr("请求失败，请稍后重试");
}
