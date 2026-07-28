import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AgentCatalogService } from "./agent-catalog.service.js";

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
const DEPLOYMENT_ID = "33333333-3333-4333-8333-333333333333";
const TOOL_ID = "44444444-4444-4444-8444-444444444444";
const PLATFORM_DEPLOYMENT_ID = "55555555-5555-4555-8555-555555555555";
const FIXED_TIME = new Date("2026-07-25T10:00:00.000Z");

describe("AgentCatalogService", () => {
  it("fails closed when Workspace B guesses Workspace A Agent ids", async () => {
    const state = createState();
    const agent = await state.service.createAgent(agentPayload());

    state.workspaceId = WORKSPACE_B;
    assert.deepEqual(await state.service.listAgents(), []);
    for (const operation of [
      () => state.service.getAgent(agent.id),
      () => state.service.getDraft(agent.id),
      () =>
        state.service.updateAgent(agent.id, {
          expectedRevision: agent.revision,
          name: "Guessed Agent",
        }),
      () =>
        state.service.replaceDraft(agent.id, {
          expectedRevision: 1,
          ...definition("Guessed Draft"),
        }),
      () => state.service.listVersions(agent.id),
      () => state.service.getVersion(agent.id, 1),
      () =>
        state.service.publishDraft(agent.id, { expectedRevision: 1 }),
    ]) {
      await assert.rejects(operation, NotFoundException);
    }

    assert.equal(state.agents.length, 1);
    assert.equal(state.drafts.length, 1);
    assert.equal(state.versions.length, 0);
    assert.ok(
      state.lookups
        .filter(({ entity }) => entity !== "unknown")
        .every(({ where }) => where.workspaceId !== undefined),
      "every Agent catalog lookup must carry an explicit workspace filter",
    );
  });

  it("fails closed before persistence without valid trusted identifiers", async () => {
    for (const invalidWorkspaceId of [null, "", "not-a-uuid"] as const) {
      const state = createState();
      const agent = await state.service.createAgent(agentPayload());
      const lookupCount = state.lookups.length;
      state.workspaceId = invalidWorkspaceId;

      for (const operation of [
        () => state.service.listAgents(),
        () => state.service.getAgent(agent.id),
        () =>
          state.service.createAgent({
            ...agentPayload(),
            name: "Must not be created",
          }),
        () =>
          state.service.updateAgent(agent.id, {
            expectedRevision: 1,
            name: "Must not be updated",
          }),
        () => state.service.getDraft(agent.id),
        () =>
          state.service.replaceDraft(agent.id, {
            expectedRevision: 1,
            ...definition("Must not be saved"),
          }),
        () => state.service.listVersions(agent.id),
        () => state.service.getVersion(agent.id, 1),
        () => state.service.publishDraft(agent.id, { expectedRevision: 1 }),
      ]) {
        await assert.rejects(operation, hasNotFoundCode);
      }

      assert.equal(state.lookups.length, lookupCount);
      assert.equal(state.agents.length, 1);
      assert.equal(state.drafts.length, 1);
      assert.equal(state.versions.length, 0);
    }

    const state = createState();
    await assert.rejects(
      () => state.service.getAgent("not-an-agent-id"),
      hasNotFoundCode,
    );
    assert.equal(state.lookups.length, 0);
  });

  it("creates exactly one Draft and rejects stale positive revisions", async () => {
    const state = createState();
    const agent = await state.service.createAgent(agentPayload());

    assert.equal(state.agents.length, 1);
    assert.equal(state.drafts.length, 1);
    assert.equal(state.drafts[0]!.agentId, agent.id);
    assert.equal(state.drafts[0]!.workspaceId, WORKSPACE_A);

    const updatedAgent = await state.service.updateAgent(agent.id, {
      description: "Updated identity",
      expectedRevision: 1,
    });
    assert.equal(updatedAgent.revision, 2);
    await assert.rejects(
      () =>
        state.service.updateAgent(agent.id, {
          expectedRevision: 1,
          name: "Stale identity",
        }),
      (error: unknown) => hasCode(error, "AI_AGENT_REVISION_CONFLICT"),
    );

    const draft = await state.service.replaceDraft(agent.id, {
      expectedRevision: 1,
      ...definition("Second revision"),
    });
    assert.equal(draft.revision, 2);
    await assert.rejects(
      () =>
        state.service.replaceDraft(agent.id, {
          expectedRevision: 1,
          ...definition("Stale Draft"),
        }),
      (error: unknown) =>
        hasCode(error, "AI_AGENT_DRAFT_REVISION_CONFLICT"),
    );
  });

  it("publishes monotonic immutable snapshots from the exact locked Draft", async () => {
    const state = createState();
    const agent = await state.service.createAgent(agentPayload("First revision"));
    state.beforeVersionSave = () => {
      // Simulate a hostile in-memory mutation after snapshot construction. The
      // saved Version must still contain the already-cloned locked revision.
      state.drafts[0]!.graph.nodes[0].config.instructions =
        "Concurrent unvalidated content";
    };

    const first = await state.service.publishDraft(agent.id, {
      expectedRevision: 1,
    });
    state.beforeVersionSave = undefined;
    assert.equal(first.version, 1);
    assert.equal(first.draftRevision, 1);
    assert.match(first.contentDigest, /^[a-f0-9]{64}$/);
    assert.equal(modelInstructions(first), "First revision");
    assert.equal(modelInstructions(state.versions[0]), "First revision");
    assert.deepEqual(state.resolvedModels, [DEPLOYMENT_ID]);
    assert.deepEqual(state.resolvedTools, [`${TOOL_ID}:1.0.0`]);
    assert.ok(
      state.lockedReads.some(
        ({ entity, mode }) => entity === "Agent" && mode === "pessimistic_write",
      ),
    );
    assert.ok(
      state.lockedReads.some(
        ({ entity, mode }) => entity === "AgentDraft" && mode === "pessimistic_read",
      ),
    );

    // Restore the persisted Draft through the only supported write path.
    const secondDraft = await state.service.replaceDraft(agent.id, {
      expectedRevision: 1,
      ...definition("Second revision"),
    });
    const second = await state.service.publishDraft(agent.id, {
      expectedRevision: secondDraft.revision,
    });
    assert.equal(second.version, 2);
    assert.equal(second.draftRevision, 2);
    assert.equal(modelInstructions(second), "Second revision");
    assert.equal(modelInstructions(await state.service.getVersion(agent.id, 1)), "First revision");
    assert.equal((await state.service.getAgent(agent.id)).latestVersion, 2);

    const summaries = await state.service.listVersions(agent.id);
    assert.deepEqual(
      summaries.map(({ version }) => version),
      [2, 1],
    );
    assert.equal("graph" in summaries[0]!, false);
  });

  it("allows only one publication for a Draft revision under concurrent calls", async () => {
    const state = createState();
    const agent = await state.service.createAgent(agentPayload());
    const results = await Promise.allSettled([
      state.service.publishDraft(agent.id, { expectedRevision: 1 }),
      state.service.publishDraft(agent.id, { expectedRevision: 1 }),
    ]);

    assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    assert.ok(rejected);
    assert.equal(hasCode(rejected.reason, "AI_AGENT_VERSION_CONFLICT"), true);
    assert.equal(state.versions.length, 1);
    assert.equal(state.agents[0]!.latestVersion, 1);
  });

  it("rejects publication when the Agent is archived", async () => {
    const state = createState();
    const agent = await state.service.createAgent({
      ...agentPayload(),
      status: "archived",
    });

    await assert.rejects(
      () => state.service.publishDraft(agent.id, { expectedRevision: 1 }),
      (error: unknown) => hasCode(error, "AI_AGENT_ARCHIVED"),
    );
    assert.equal(state.versions.length, 0);
    assert.equal(state.agents[0]!.latestVersion, 0);
    assert.deepEqual(state.resolvedModels, []);
    assert.deepEqual(state.resolvedDefaults, []);
    assert.deepEqual(state.resolvedTools, []);
  });

  it("rolls back when any published Draft reference resolver fails", async () => {
    const failures: ReferenceFailure[] = [
      {
        error: new BadRequestException("Tool configuration is unavailable"),
        resolver: "tool",
      },
      {
        error: new ConflictException("Model deployment is unavailable"),
        resolver: "model",
      },
      {
        error: new NotFoundException("Default model is unavailable"),
        resolver: "default",
      },
    ];
    for (const failure of failures) {
      const state = createState();
      const payload = agentPayload() as AnyRow;
      payload.graph.nodes[0].config.model = {
        allowedModels: payload.modelReferences,
        apiVersion: "hermes.ai/v1",
        capability: "chat",
        fallback: { mode: "workspaceDefault" },
        mode: "requestOverride",
      };
      const agent = await state.service.createAgent(payload);
      state.referenceFailure = failure;

      await assert.rejects(
        () => state.service.publishDraft(agent.id, { expectedRevision: 1 }),
        (error: unknown) =>
          hasCode(error, "AI_AGENT_REFERENCE_UNAVAILABLE"),
      );
      assert.equal(state.versions.length, 0, failure.resolver);
      assert.equal(state.agents[0]!.latestVersion, 0, failure.resolver);
    }
  });

  it("preserves resolver outages instead of disguising them as 4xx conflicts", async () => {
    const outages: ReferenceFailure[] = [
      {
        error: new ServiceUnavailableException("Tool catalog database unavailable"),
        resolver: "tool",
      },
      {
        error: Object.assign(new Error("Model database unavailable"), {
          code: "ECONNREFUSED",
        }),
        resolver: "model",
      },
      {
        error: Object.assign(new Error("Default resolver network failure"), {
          code: "ECONNRESET",
        }),
        resolver: "default",
      },
    ];
    for (const outage of outages) {
      const state = createState();
      const payload = agentPayload() as AnyRow;
      payload.graph.nodes[0].config.model = {
        allowedModels: payload.modelReferences,
        apiVersion: "hermes.ai/v1",
        capability: "chat",
        fallback: { mode: "workspaceDefault" },
        mode: "requestOverride",
      };
      const agent = await state.service.createAgent(payload);
      state.referenceFailure = outage;

      await assert.rejects(
        () => state.service.publishDraft(agent.id, { expectedRevision: 1 }),
        (error: unknown) => error === outage.error,
      );
      assert.equal(state.versions.length, 0, outage.resolver);
      assert.equal(state.agents[0]!.latestVersion, 0, outage.resolver);
    }
  });

  it("validates pinned Platform models through the live resolver", async () => {
    const state = createState();
    const payload = agentPayload() as AnyRow;
    const platformModel = {
      ...payload.modelReferences[0],
      deploymentId: PLATFORM_DEPLOYMENT_ID,
      modelId: "chat-platform",
      providerScope: "platform",
    };
    payload.graph.nodes[0].config.model.model = platformModel;
    payload.modelReferences = [platformModel];
    const agent = await state.service.createAgent(payload);

    await state.service.publishDraft(agent.id, { expectedRevision: 1 });
    assert.deepEqual(state.resolvedModelReferences, [platformModel]);
  });

  it("validates direct Workspace defaults and request-override fallbacks", async () => {
    const state = createState();
    const defaultPayload = agentPayload() as AnyRow;
    defaultPayload.name = "Workspace Default Agent";
    defaultPayload.graph.nodes[0].config.model = {
      apiVersion: "hermes.ai/v1",
      capability: "chat",
      mode: "workspaceDefault",
    };
    defaultPayload.modelReferences = [];
    const defaultAgent = await state.service.createAgent(defaultPayload);
    await state.service.publishDraft(defaultAgent.id, { expectedRevision: 1 });

    const overridePayload = agentPayload() as AnyRow;
    overridePayload.name = "Request Override Agent";
    overridePayload.graph.nodes[0].config.model = {
      allowedModels: overridePayload.modelReferences,
      apiVersion: "hermes.ai/v1",
      capability: "chat",
      fallback: { mode: "workspaceDefault" },
      mode: "requestOverride",
    };
    const overrideAgent = await state.service.createAgent(overridePayload);

    await state.service.publishDraft(overrideAgent.id, { expectedRevision: 1 });
    assert.deepEqual(state.resolvedModels, [DEPLOYMENT_ID]);
    assert.deepEqual(state.resolvedDefaults, ["chat", "chat"]);
  });

  it("never exposes credentials and returns detached Version content", async () => {
    const state = createState();
    await assert.rejects(
      () =>
        state.service.createAgent({
          ...agentPayload(),
          modelReferences: [
            {
              ...definition().modelReferences[0],
              apiKey: "credential",
            },
          ],
        } as never),
      (error: unknown) => error instanceof BadRequestException,
    );

    const agent = await state.service.createAgent(agentPayload());
    const published = await state.service.publishDraft(agent.id, {
      expectedRevision: 1,
    });
    const serialized = JSON.stringify(published);
    assert.doesNotMatch(serialized, /apiKey|credential|secret|baseUrl|endpoint/i);

    (published.graph.nodes[0] as AnyRow).config.instructions = "mutated response";
    const reread = await state.service.getVersion(agent.id, 1);
    assert.equal(modelInstructions(reread), "First revision");
    assert.equal(modelInstructions(state.versions[0]), "First revision");
  });
});

type AnyRow = Record<string, any>;
type Lookup = { entity: string; where: AnyRow };
type ReferenceResolver = "default" | "model" | "tool";
type ReferenceFailure = { error: Error; resolver: ReferenceResolver };

function createState() {
  const agents: AnyRow[] = [];
  const drafts: AnyRow[] = [];
  const versions: AnyRow[] = [];
  const lookups: Lookup[] = [];
  const lockedReads: { entity: string; mode: string }[] = [];
  const hooks: { beforeVersionSave?: () => void } = {};
  const resolvedModels: string[] = [];
  const resolvedModelReferences: AnyRow[] = [];
  const resolvedDefaults: string[] = [];
  const resolvedTools: string[] = [];
  let referenceFailure: ReferenceFailure | null = null;
  const repositories = {
    Agent: fakeRepository("Agent", agents, lookups, lockedReads, hooks),
    AgentDraft: fakeRepository(
      "AgentDraft",
      drafts,
      lookups,
      lockedReads,
      hooks,
    ),
    AgentVersion: fakeRepository(
      "AgentVersion",
      versions,
      lookups,
      lockedReads,
      hooks,
    ),
  };
  let workspaceId: string | null = WORKSPACE_A;
  let transactionTail = Promise.resolve();
  const dataSource = {
    async transaction<T>(
      operation: (manager: {
        getRepository(entity: { name: keyof typeof repositories }): unknown;
      }) => Promise<T>,
    ) {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshots = {
        agents: structuredClone(agents),
        drafts: structuredClone(drafts),
        versions: structuredClone(versions),
      };
      try {
        return await operation({
          getRepository(entity) {
            const repository = repositories[entity.name];
            if (!repository) throw new Error(`Unexpected entity ${entity.name}`);
            return repository;
          },
        });
      } catch (error) {
        restoreRows(agents, snapshots.agents);
        restoreRows(drafts, snapshots.drafts);
        restoreRows(versions, snapshots.versions);
        throw error;
      } finally {
        release();
      }
    },
  };
  const service = new AgentCatalogService(
    repositories.Agent as never,
    repositories.AgentDraft as never,
    repositories.AgentVersion as never,
    dataSource as never,
    {
      current: (required = true) => {
        if (workspaceId === null) {
          if (required) throw new Error("Workspace context is required");
          return null;
        }
        return { scopeLevel: "workspace", workspaceId };
      },
    } as never,
    {
      resolveWorkspaceModelReference: async (reference: AnyRow) => {
        resolvedModels.push(reference.deploymentId);
        resolvedModelReferences.push(structuredClone(reference));
        if (referenceFailure?.resolver === "model") throw referenceFailure.error;
        return reference;
      },
      resolveWorkspaceDefault: async (capability: string) => {
        resolvedDefaults.push(capability);
        if (referenceFailure?.resolver === "default") {
          throw referenceFailure.error;
        }
        return { capability };
      },
    } as never,
    {
      resolveWorkspaceTool: async (toolDefinitionId: string, version: string) => {
        resolvedTools.push(`${toolDefinitionId}:${version}`);
        if (referenceFailure?.resolver === "tool") throw referenceFailure.error;
        return { available: true };
      },
    } as never,
  );
  return {
    agents,
    drafts,
    lockedReads,
    lookups,
    resolvedModels,
    resolvedModelReferences,
    resolvedDefaults,
    resolvedTools,
    service,
    versions,
    get referenceFailure() {
      return referenceFailure;
    },
    set referenceFailure(value: ReferenceFailure | null) {
      referenceFailure = value;
    },
    get beforeVersionSave() {
      return hooks.beforeVersionSave;
    },
    set beforeVersionSave(value: (() => void) | undefined) {
      hooks.beforeVersionSave = value;
    },
    get workspaceId() {
      return workspaceId;
    },
    set workspaceId(value: string | null) {
      workspaceId = value;
    },
  };
}

function fakeRepository(
  entity: string,
  rows: AnyRow[],
  lookups: Lookup[],
  lockedReads: { entity: string; mode: string }[],
  hooks: { beforeVersionSave?: () => void },
) {
  return {
    create(value: AnyRow) {
      return { ...value };
    },
    async find(options: { order?: AnyRow; where?: AnyRow } = {}) {
      const where = options.where ?? {};
      lookups.push({ entity, where: { ...where } });
      const found = rows.filter((row) => matches(row, where));
      const [orderKey] = Object.keys(options.order ?? {});
      if (!orderKey) return found;
      const direction = String(options.order?.[orderKey]).toUpperCase();
      return found.sort((left, right) => {
        const comparison = Number(left[orderKey]) - Number(right[orderKey]);
        return direction === "DESC" ? -comparison : comparison;
      });
    },
    async findOne(options: { lock?: { mode: string }; where: AnyRow }) {
      lookups.push({ entity, where: { ...options.where } });
      if (options.lock) {
        lockedReads.push({ entity, mode: options.lock.mode });
      }
      return rows.find((row) => matches(row, options.where)) ?? null;
    },
    async save(value: AnyRow) {
      if (entity === "AgentVersion") hooks.beforeVersionSave?.();
      assertUnique(entity, rows, value);
      const saved = {
        createdAt: value.createdAt ?? FIXED_TIME,
        id: value.id ?? randomUUID(),
        updatedAt: value.updatedAt ?? FIXED_TIME,
        ...structuredClone(value),
      };
      const index = rows.findIndex(({ id }) => id === saved.id);
      if (index < 0) rows.push(saved);
      else rows[index] = saved;
      return saved;
    },
    async update(criteria: AnyRow, patch: AnyRow) {
      lookups.push({ entity, where: { ...criteria } });
      const row = rows.find((candidate) => matches(candidate, criteria));
      if (!row) return { affected: 0 };
      for (const [key, value] of Object.entries(patch)) {
        row[key] =
          typeof value === "function" ? Number(row[key] ?? 0) + 1 : value;
      }
      row.updatedAt = new Date(FIXED_TIME.getTime() + 60_000);
      return { affected: 1 };
    },
  };
}

function assertUnique(entity: string, rows: AnyRow[], value: AnyRow) {
  const duplicate = rows.some((row) => {
    if (entity === "Agent") {
      return row.workspaceId === value.workspaceId && row.name === value.name;
    }
    if (entity === "AgentDraft") {
      return (
        row.workspaceId === value.workspaceId && row.agentId === value.agentId
      );
    }
    return (
      row.workspaceId === value.workspaceId &&
      row.agentId === value.agentId &&
      (row.version === value.version ||
        row.draftRevision === value.draftRevision)
    );
  });
  if (duplicate) throw Object.assign(new Error("unique violation"), { code: "23505" });
}

function restoreRows(target: AnyRow[], snapshot: AnyRow[]) {
  target.splice(0, target.length, ...snapshot);
}

function matches(row: AnyRow, criteria: AnyRow) {
  return Object.entries(criteria).every(([key, value]) => row[key] === value);
}

function hasCode(error: unknown, code: string) {
  if (!(error instanceof ConflictException)) return false;
  const response = error.getResponse();
  return typeof response === "object" && response !== null &&
    (response as { code?: unknown }).code === code;
}

function hasNotFoundCode(error: unknown) {
  if (!(error instanceof NotFoundException)) return false;
  const response = error.getResponse();
  return typeof response === "object" && response !== null &&
    (response as { code?: unknown }).code === "AI_AGENT_NOT_FOUND";
}

function modelInstructions(value: AnyRow) {
  return value.graph.nodes[0].config.instructions as string;
}

function agentPayload(instructions = "First revision") {
  return {
    description: "Answers support questions.",
    name: "Support Agent",
    status: "active" as const,
    ...definition(instructions),
  };
}

function definition(instructions = "First revision") {
  const emptyObjectSchema = {
    additionalProperties: false,
    properties: {},
    required: [],
    type: "object" as const,
  };
  const retry = {
    backoffMs: 100,
    maxAttempts: 1,
    strategy: "fixed" as const,
  };
  const model = {
    apiVersion: "hermes.ai/v1" as const,
    capability: "chat" as const,
    deploymentId: DEPLOYMENT_ID,
    modelId: "chat-primary",
    providerScope: "workspace" as const,
  };
  const tool = { toolDefinitionId: TOOL_ID, version: "1.0.0" };
  return {
    graph: {
      edges: [
        {
          id: "compose-to-tool",
          kind: "default" as const,
          sourceNodeId: "compose",
          targetNodeId: "lookup",
        },
        {
          id: "tool-to-done",
          kind: "default" as const,
          sourceNodeId: "lookup",
          targetNodeId: "done",
        },
      ],
      entryNodeId: "compose",
      nodes: [
        {
          config: {
            instructions,
            model: {
              apiVersion: "hermes.ai/v1" as const,
              mode: "pinned" as const,
              model,
            },
            schemaVersion: "hermes.agent-node.model/v1" as const,
          },
          id: "compose",
          inputSchema: emptyObjectSchema,
          label: "Compose",
          outputSchema: emptyObjectSchema,
          retry,
          timeoutMs: 30_000,
          type: "model" as const,
        },
        {
          config: {
            inputBindings: {},
            schemaVersion: "hermes.agent-node.tool/v1" as const,
            tool,
          },
          id: "lookup",
          inputSchema: emptyObjectSchema,
          label: "Lookup",
          outputSchema: emptyObjectSchema,
          retry,
          timeoutMs: 10_000,
          type: "tool" as const,
        },
        {
          config: {
            outputPath: null,
            result: "success" as const,
            schemaVersion: "hermes.agent-node.end/v1" as const,
          },
          id: "done",
          inputSchema: emptyObjectSchema,
          label: "Done",
          outputSchema: emptyObjectSchema,
          retry,
          timeoutMs: 100,
          type: "end" as const,
        },
      ],
      schemaVersion: "hermes.agent-graph/v1" as const,
      variables: [],
    },
    modelReferences: [model],
    toolReferences: [tool],
  };
}
