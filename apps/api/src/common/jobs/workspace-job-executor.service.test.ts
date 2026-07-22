import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkspaceContextService } from "../database/workspace-context.service.js";
import {
  WorkspaceJobExecutor,
  workspaceJobKeys,
} from "./workspace-job-executor.service.js";

describe("WorkspaceJobExecutor", () => {
  it("runs a job in a workspace context and records workspace-namespaced idempotency", async () => {
    const redis = new FakeRedis();
    const context = new WorkspaceContextService();
    const executor = new WorkspaceJobExecutor(
      activeWorkspaceRepository(),
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
    assert.equal(redis.values.has(workspaceJobKeys(job).completed), true);
    assert.equal(redis.values.has(workspaceJobKeys(job).lock), false);
    assert.equal(redis.setCalls[0]?.key, workspaceJobKeys(job).lock);
  });

  it("does not open Redis without an explicit workspaceId", async () => {
    let redisCalls = 0;
    const executor = new WorkspaceJobExecutor(
      activeWorkspaceRepository(),
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
  });

  it("does not open Redis for an inactive or unknown workspace", async () => {
    let redisCalls = 0;
    const executor = new WorkspaceJobExecutor(
      { exists: async () => false } as any,
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
            workspaceId: "workspace-missing",
          },
          async () => undefined,
        ),
      /inactive or unknown workspace/,
    );
    assert.equal(redisCalls, 0);
  });

  it("does not switch from an existing workspace context", async () => {
    let workspaceChecks = 0;
    const context = new WorkspaceContextService();
    const executor = new WorkspaceJobExecutor(
      {
        exists: async () => {
          workspaceChecks += 1;
          return true;
        },
      } as any,
      context,
      { getClient: async () => new FakeRedis() } as any,
    );

    await context.run(
      { scopeLevel: "workspace", workspaceId: "workspace-a" },
      async () =>
        assert.rejects(
          () =>
            executor.execute(
              {
                idempotencyKey: "run-1",
                name: "example.job",
                payload: null,
                workspaceId: "workspace-b",
              },
              async () => undefined,
            ),
          /cannot cross workspace context/,
        ),
    );
    assert.equal(workspaceChecks, 0);
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
  return new WorkspaceJobExecutor(
    activeWorkspaceRepository(),
    context,
    { getClient: async () => redis } as any,
  );
}

function activeWorkspaceRepository() {
  return { exists: async () => true } as any;
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
