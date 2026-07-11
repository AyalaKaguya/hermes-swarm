import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { Department, DepartmentDispatchRelation } from "@hermes-swarm/core";
import { DepartmentDispatchResolverService } from "./department-dispatch-resolver.service.js";

describe("DepartmentDispatchResolverService", () => {
  it("resolves tenant-scoped routes by priority and stops cycles", async () => {
    const { relationRepository, service } = createService([
      relation("r-low", "dept-a", "dept-b", "handoff", 10, "org-a"),
      relation("r-high", "dept-a", "dept-c", "fallback", 50, "org-b"),
      relation("r-cycle", "dept-b", "dept-a", "handoff", 10, "org-a"),
    ]);

    const result = await service.resolveTicketAssignment({
      idempotencyKey: "ticket:1:create",
      maxHops: 4,
      sourceDepartmentId: "dept-a",
      tenantId: "tenant-1",
    });

    assert.deepEqual(
      result.targets.map((target) => target.departmentId),
      ["dept-b", "dept-c"],
    );
    assert.equal(result.cycleDetected, true);
    assert.deepEqual(result.targets[0]?.path, ["dept-a", "dept-b"]);
    assert.equal(relationRepository.findCalls, 2);
  });

  it("reuses the same promise for an idempotency key", async () => {
    const { relationRepository, service } = createService([
      relation("r-1", "dept-a", "dept-b", "collaboration", 10, "org-a"),
    ]);
    const input = {
      idempotencyKey: "notification:event-1",
      sourceDepartmentId: "dept-a",
      tenantId: "tenant-1",
    };

    const first = service.resolveNotificationTargets(input);
    const second = service.resolveNotificationTargets(input);
    assert.equal(first, second);
    assert.deepEqual(await first, await second);
    assert.equal(relationRepository.findCalls, 2);
  });

  it("rejects reuse of an idempotency key with different routing input", async () => {
    const { service } = createService([]);
    await service.resolveEscalationRoute({
      idempotencyKey: "ticket:1:escalate",
      sourceDepartmentId: "dept-a",
      tenantId: "tenant-1",
    });
    assert.throws(
      () =>
        service.resolveEscalationRoute({
          idempotencyKey: "ticket:1:escalate",
          sourceDepartmentId: "dept-other",
          tenantId: "tenant-1",
        }),
      BadRequestException,
    );
  });

  it("fails closed when a malformed relation crosses tenants", async () => {
    const crossTenant = relation(
      "r-cross",
      "dept-a",
      "dept-b",
      "escalation",
      10,
      "org-b",
    );
    crossTenant.targetDepartment.tenantId = "tenant-2";
    const { service } = createService([crossTenant]);

    await assert.rejects(
      service.resolveEscalationRoute({
        idempotencyKey: "ticket:1:escalate",
        sourceDepartmentId: "dept-a",
        tenantId: "tenant-1",
      }),
      BadRequestException,
    );
  });

  it("reports truncation when the maximum hop count stops traversal", async () => {
    const { service } = createService([
      relation("r-1", "dept-a", "dept-b", "escalation", 10, "org-a"),
      relation("r-2", "dept-b", "dept-c", "escalation", 10, "org-a"),
    ]);
    const result = await service.resolveEscalationRoute({
      idempotencyKey: "ticket:1:escalate",
      maxHops: 1,
      sourceDepartmentId: "dept-a",
      tenantId: "tenant-1",
    });
    assert.equal(result.truncated, true);
    assert.deepEqual(result.visitedDepartmentIds, ["dept-a", "dept-b"]);
  });
});

function createService(relations: DepartmentDispatchRelation[]) {
  const relationRepository = new FakeRelationRepository(relations);
  const departmentRepository = {
    findOne: async ({ where }: { where: { id: string; tenantId: string } }) =>
      where.tenantId === "tenant-1" && where.id === "dept-a"
        ? ({ id: "dept-a", organizationId: "org-a", tenantId: "tenant-1" } as Department)
        : null,
  };
  const tenantContext = {
    repository: (target: unknown) =>
      String(target).includes("DepartmentDispatchRelation")
        ? relationRepository
        : departmentRepository,
  };
  return {
    relationRepository,
    service: new DepartmentDispatchResolverService(tenantContext as never),
  };
}

class FakeRelationRepository {
  findCalls = 0;
  constructor(private readonly relations: DepartmentDispatchRelation[]) {}

  async find(options: {
    where: {
      sourceDepartmentId: { _value: string[] } | string[];
      tenantId: string;
      type: { _value: string[] } | string[];
    };
  }) {
    this.findCalls += 1;
    const sources = extractInValues(options.where.sourceDepartmentId);
    const types = extractInValues(options.where.type);
    return this.relations
      .filter(
        (item) =>
          item.tenantId === options.where.tenantId &&
          sources.includes(item.sourceDepartmentId) &&
          types.includes(item.type),
      )
      .sort((left, right) => left.priority - right.priority);
  }
}

function extractInValues(value: { _value: string[] } | string[]) {
  return Array.isArray(value) ? value : value._value;
}

function relation(
  id: string,
  sourceDepartmentId: string,
  targetDepartmentId: string,
  type: DepartmentDispatchRelation["type"],
  priority: number,
  organizationId: string,
) {
  return {
    createdAt: new Date(),
    id,
    isEnabled: true,
    policy: {},
    priority,
    sourceDepartmentId,
    targetDepartment: {
      id: targetDepartmentId,
      organizationId,
      tenantId: "tenant-1",
    },
    targetDepartmentId,
    tenantId: "tenant-1",
    type,
  } as DepartmentDispatchRelation;
}
