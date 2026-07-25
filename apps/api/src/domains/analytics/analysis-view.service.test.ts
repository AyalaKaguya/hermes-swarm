import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  ANALYTICS_QUERY_VERSION,
  ANALYTICS_VISUALIZATION_VERSION,
  type CreateAnalysisViewRequest,
} from "@hermes-swarm/api-contracts/analytics";
import { AnalysisViewService } from "./analysis-view.service.js";
import type { AnalyticsAuthorizationContext } from "./analytics-source.adapter.js";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUTHORIZATION: AnalyticsAuthorizationContext = {
  actorId: "11111111-1111-4111-8111-111111111111",
  locale: "en",
  permissions: new Set(["analytics.ticket_dataset.query:workspace"]),
  principalType: "workspace",
  requestId: "analysis-view-test",
  timeZone: "UTC",
};

describe("AnalysisViewService", () => {
  it("implements workspace-scoped CRUD with immutable creation time and optimistic revisions", async () => {
    const state = createState();
    const created = await state.service.create(viewInput(), AUTHORIZATION);
    const createdAt = created.createdAt;

    assert.equal(created.workspaceId, WORKSPACE_A);
    assert.equal(created.revision, 1);
    assert.deepEqual(await state.service.list(), [created]);
    assert.deepEqual(await state.service.get(created.id), created);

    const updated = await state.service.update(
      created.id,
      { expectedRevision: created.revision, name: "Ticket status overview" },
      AUTHORIZATION,
    );
    assert.equal(updated.name, "Ticket status overview");
    assert.equal(updated.revision, 2);
    assert.equal(updated.createdAt, createdAt);
    assert.ok(Date.parse(updated.updatedAt) >= Date.parse(created.updatedAt));

    await state.service.delete(updated.id, { expectedRevision: updated.revision });
    assert.deepEqual(await state.service.list(), []);
  });

  it("fails closed when Workspace B guesses Workspace A view ids", async () => {
    const state = createState();
    const created = await state.service.create(viewInput(), AUTHORIZATION);

    state.workspaceId = WORKSPACE_B;
    assert.deepEqual(await state.service.list(), []);
    await assert.rejects(() => state.service.get(created.id), NotFoundException);
    await assert.rejects(
      () => state.service.update(
        created.id,
        { expectedRevision: created.revision, name: "Guessed view" },
        AUTHORIZATION,
      ),
      NotFoundException,
    );
    await assert.rejects(
      () => state.service.delete(created.id, { expectedRevision: created.revision }),
      NotFoundException,
    );
  });

  it("rejects stale expectedRevision values for update and delete", async () => {
    const state = createState();
    const created = await state.service.create(viewInput(), AUTHORIZATION);
    const updated = await state.service.update(
      created.id,
      { expectedRevision: 1, name: "Current name" },
      AUTHORIZATION,
    );

    await assert.rejects(
      () => state.service.update(
        created.id,
        { expectedRevision: 1, name: "Stale name" },
        AUTHORIZATION,
      ),
      ConflictException,
    );
    await assert.rejects(
      () => state.service.delete(created.id, { expectedRevision: 1 }),
      ConflictException,
    );
    assert.equal((await state.service.get(created.id)).name, updated.name);
  });

  it("validates saved definitions through the query gateway and rejects incompatible charts", async () => {
    const state = createState();
    await state.service.create(viewInput(), AUTHORIZATION);
    assert.equal(state.validatedQueries.length, 1);
    assert.equal(state.validatedQueries[0]?.sourceKey, "support.tickets");

    await assert.rejects(
      () => state.service.create({
        ...viewInput(),
        name: "Invalid chart",
        visualization: {
          measure: "status",
          schemaVersion: ANALYTICS_VISUALIZATION_VERSION,
          type: "kpi",
        },
      }, AUTHORIZATION),
      (error: unknown) =>
        error instanceof Error &&
        "getResponse" in error &&
        (error as { getResponse(): { code?: string } }).getResponse().code ===
          "ANALYTICS_VISUALIZATION_INVALID",
    );
  });
});

function viewInput(): CreateAnalysisViewRequest {
  return {
    datasetId: "support.tickets",
    name: "Tickets by status",
    query: {
      filters: [],
      groupBy: ["status"],
      measures: [{ aggregation: "count", as: "ticketCount" }],
      page: { size: 50 },
      schemaVersion: ANALYTICS_QUERY_VERSION,
      select: ["status"],
      sort: [{ direction: "desc", field: "ticketCount" }],
      sourceKey: "support.tickets",
      sourceRevision: "support.tickets/v1",
    },
    visualization: {
      schemaVersion: ANALYTICS_VISUALIZATION_VERSION,
      series: [{ field: "ticketCount" }],
      type: "bar",
      x: "status",
    },
  };
}

function createState() {
  let workspaceId = WORKSPACE_A;
  let sequence = 0;
  const views: Array<Record<string, any>> = [];
  const validatedQueries: Array<Record<string, any>> = [];
  const repository = {
    create: (value: Record<string, unknown>) => ({ ...value }),
    delete: async (where: Record<string, unknown>) => {
      const index = views.findIndex((view) => matches(view, where));
      if (index < 0) return { affected: 0 };
      views.splice(index, 1);
      return { affected: 1 };
    },
    find: async ({ where }: { where: Record<string, unknown> }) =>
      views
        .filter((view) => matches(view, where))
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()),
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      views.find((view) => matches(view, where)) ?? null,
    save: async (value: Record<string, unknown>) => {
      const now = new Date("2026-07-25T00:00:00.000Z");
      const saved = {
        ...value,
        createdAt: now,
        id: `11111111-1111-4111-8111-${String(++sequence).padStart(12, "0")}`,
        updatedAt: now,
      };
      views.push(saved);
      return saved;
    },
    update: async (
      where: Record<string, unknown>,
      patch: Record<string, unknown>,
    ) => {
      const view = views.find((candidate) => matches(candidate, where));
      if (!view) return { affected: 0 };
      for (const [key, value] of Object.entries(patch)) {
        view[key] = key === "revision" && typeof value === "function"
          ? view.revision + 1
          : value;
      }
      return { affected: 1 };
    },
  };
  const gateway = {
    validate: async (query: Record<string, any>) => {
      validatedQueries.push(query);
      return {
        query,
        resultSchema: [
          {
            key: "status",
            label: "Ticket status",
            nullable: false,
            scalarType: "enum",
            semanticType: "category",
          },
          {
            key: "ticketCount",
            label: "Ticket count",
            nullable: false,
            scalarType: "number",
          },
        ],
        schema: { sourceKey: "support.tickets" },
      };
    },
  };
  const context = {
    current: () => ({ scopeLevel: "workspace", workspaceId }),
  };
  const service = new AnalysisViewService(
    context as never,
    gateway as never,
    repository as never,
  );
  return {
    get workspaceId() {
      return workspaceId;
    },
    set workspaceId(value: string) {
      workspaceId = value;
    },
    service,
    validatedQueries,
    views,
  };
}

function matches(value: Record<string, any>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, expected]) => value[key] === expected);
}
