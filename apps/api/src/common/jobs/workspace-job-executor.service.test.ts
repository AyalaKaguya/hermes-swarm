import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkspaceContextService } from "../database/workspace-context.service.js";
import {
  WorkspaceJobExecutor,
  workspaceJobKeys,
} from "./workspace-job-executor.service.js";

describe("WorkspaceJobExecutor", () => {
  it("runs a job in a workspace RLS transaction and records workspace-namespaced idempotency", async () => {
    const redis = new FakeRedis();
    const context = new WorkspaceContextService();
    const queries: Array<{ parameters: unknown[]; sql: string }> = [];
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        queries.push({ parameters, sql });
      },
    };
    const dataSource = {
      transaction: async (work: (value: any) => Promise<unknown>) => work(manager),
    };
    const executor = new WorkspaceJobExecutor(
      dataSource as any,
      context,
      { getClient: async () => redis } as any,
    );
    const job = {
      idempotencyKey: "2026-07-11",
      name: "tickets.archive-expired",
      payload: { marker: 42 },
      workspaceId: "workspace-a",
    };

    const result = await executor.execute(job, async (payload) => {
      const current = context.current();
      assert.equal(current?.workspaceId, "workspace-a");
      assert.equal(current?.scopeLevel, "workspace");
      assert.equal(payload.marker, 42);
      return "done";
    });

    assert.deepEqual(result, { result: "done", status: "completed" });
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0]?.parameters, ["workspace-a"]);
    assert.match(queries[0]?.sql ?? "", /app\.workspace_id/);
    assert.equal(redis.values.has(workspaceJobKeys(job).completed), true);
    assert.equal(redis.values.has(workspaceJobKeys(job).lock), false);
    assert.equal(redis.setCalls[0]?.key, workspaceJobKeys(job).lock);
  });

  it("does not open Redis or a transaction without an explicit workspaceId", async () => {
    let redisCalls = 0;
    let transactions = 0;
    const executor = new WorkspaceJobExecutor(
      {
        transaction: async () => {
          transactions += 1;
        },
      } as any,
      new WorkspaceContextService(),
      {
        getClient: async () => {
          redisCalls += 1;
          return new FakeRedis();
        },
      } as any,
    );

    await assert.rejects(
      () =>
        executor.execute(
          {
            idempotencyKey: "run-1",
            name: "example.job",
            payload: null,
            workspaceId: "",
          },
          async () => undefined,
        ),
      /workspaceId is required/,
    );
    assert.equal(redisCalls, 0);
    assert.equal(transactions, 0);
  });

  it("skips a completed delivery without invoking its handler", async () => {
    const redis = new FakeRedis();
    const job = {
      idempotencyKey: "run-1",
      name: "example.job",
      payload: null,
      workspaceId: "workspace-a",
    };
    redis.values.set(workspaceJobKeys(job).completed, "completed");
    let handled = false;
    const executor = createExecutor(redis);

    const result = await executor.execute(job, async () => {
      handled = true;
    });

    assert.deepEqual(result, { status: "already-completed" });
    assert.equal(handled, false);
  });

  it("returns locked when another worker owns the same workspace job", async () => {
    const redis = new FakeRedis();
    const job = {
      idempotencyKey: "run-1",
      name: "example.job",
      payload: null,
      workspaceId: "workspace-a",
    };
    redis.values.set(workspaceJobKeys(job).lock, "other-worker");
    const result = await createExecutor(redis).execute(job, async () => undefined);
    assert.deepEqual(result, { status: "locked" });
  });

  it("releases its lock and leaves no completion marker after failure", async () => {
    const redis = new FakeRedis();
    const job = {
      idempotencyKey: "run-1",
      name: "example.job",
      payload: null,
      workspaceId: "workspace-a",
    };
    await assert.rejects(
      () =>
        createExecutor(redis).execute(job, async () => {
          throw new Error("handler failed");
        }),
      /handler failed/,
    );
    const keys = workspaceJobKeys(job);
    assert.equal(redis.values.has(keys.lock), false);
    assert.equal(redis.values.has(keys.completed), false);
  });
});

function createExecutor(redis: FakeRedis) {
  const context = new WorkspaceContextService();
  const manager = { query: async () => undefined };
  return new WorkspaceJobExecutor(
    {
      transaction: async (work: (value: any) => Promise<unknown>) => work(manager),
    } as any,
    context,
    { getClient: async () => redis } as any,
  );
}

class FakeRedis {
  readonly setCalls: Array<{ key: string; options: unknown; value: string }> = [];
  readonly values = new Map<string, string>();

  async exists(key: string) {
    return this.values.has(key) ? 1 : 0;
  }

  async set(key: string, value: string, options?: { NX?: boolean }) {
    this.setCalls.push({ key, options, value });
    if (options?.NX && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async eval(
    _script: string,
    input: { arguments: string[]; keys: string[] },
  ) {
    const [key] = input.keys;
    const [owner] = input.arguments;
    if (key && this.values.get(key) === owner) {
      this.values.delete(key);
      return 1;
    }
    return 0;
  }
}
