import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantContextService } from "../database/tenant-context.service.js";
import {
  TenantJobExecutor,
  tenantJobKeys,
} from "./tenant-job-executor.service.js";

describe("TenantJobExecutor", () => {
  it("runs a job in a tenant RLS transaction and records tenant-namespaced idempotency", async () => {
    const redis = new FakeRedis();
    const context = new TenantContextService();
    const queries: Array<{ parameters: unknown[]; sql: string }> = [];
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        queries.push({ parameters, sql });
      },
    };
    const dataSource = {
      transaction: async (work: (value: any) => Promise<unknown>) => work(manager),
    };
    const executor = new TenantJobExecutor(
      dataSource as any,
      context,
      { getClient: async () => redis } as any,
    );
    const job = {
      idempotencyKey: "2026-07-11",
      name: "tickets.archive-expired",
      payload: { marker: 42 },
      tenantId: "tenant-a",
    };

    const result = await executor.execute(job, async (payload) => {
      const current = context.current();
      assert.equal(current?.tenantId, "tenant-a");
      assert.equal(current?.scopeLevel, "tenant");
      assert.equal(current?.organizationId, null);
      assert.equal(payload.marker, 42);
      return "done";
    });

    assert.deepEqual(result, { result: "done", status: "completed" });
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0]?.parameters, ["tenant-a"]);
    assert.match(queries[0]?.sql ?? "", /app\.tenant_id/);
    assert.equal(redis.values.has(tenantJobKeys(job).completed), true);
    assert.equal(redis.values.has(tenantJobKeys(job).lock), false);
    assert.equal(redis.setCalls[0]?.key, tenantJobKeys(job).lock);
  });

  it("does not open Redis or a transaction without an explicit tenantId", async () => {
    let redisCalls = 0;
    let transactions = 0;
    const executor = new TenantJobExecutor(
      {
        transaction: async () => {
          transactions += 1;
        },
      } as any,
      new TenantContextService(),
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
            tenantId: "",
          },
          async () => undefined,
        ),
      /tenantId is required/,
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
      tenantId: "tenant-a",
    };
    redis.values.set(tenantJobKeys(job).completed, "completed");
    let handled = false;
    const executor = createExecutor(redis);

    const result = await executor.execute(job, async () => {
      handled = true;
    });

    assert.deepEqual(result, { status: "already-completed" });
    assert.equal(handled, false);
  });

  it("returns locked when another worker owns the same tenant job", async () => {
    const redis = new FakeRedis();
    const job = {
      idempotencyKey: "run-1",
      name: "example.job",
      payload: null,
      tenantId: "tenant-a",
    };
    redis.values.set(tenantJobKeys(job).lock, "other-worker");
    const result = await createExecutor(redis).execute(job, async () => undefined);
    assert.deepEqual(result, { status: "locked" });
  });

  it("releases its lock and leaves no completion marker after failure", async () => {
    const redis = new FakeRedis();
    const job = {
      idempotencyKey: "run-1",
      name: "example.job",
      payload: null,
      tenantId: "tenant-a",
    };
    await assert.rejects(
      () =>
        createExecutor(redis).execute(job, async () => {
          throw new Error("handler failed");
        }),
      /handler failed/,
    );
    const keys = tenantJobKeys(job);
    assert.equal(redis.values.has(keys.lock), false);
    assert.equal(redis.values.has(keys.completed), false);
  });
});

function createExecutor(redis: FakeRedis) {
  const context = new TenantContextService();
  const manager = { query: async () => undefined };
  return new TenantJobExecutor(
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
