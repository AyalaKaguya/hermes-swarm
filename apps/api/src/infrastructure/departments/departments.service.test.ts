import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  Department,
  DepartmentDispatchRelation,
  Organization,
  UserDepartment,
  UserOrganization,
} from "@hermes-swarm/core";
import type { EntityManager } from "typeorm";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { DepartmentsService } from "./departments.service.js";

describe("DepartmentsService tenant hierarchy", () => {
  it("creates departments only inside the active tenant organization", async () => {
    const state = createState();
    const result = await state.run(() =>
      state.service.create("tenant-a", "org-a", {
        name: "Customer Success",
        slug: "customer-success",
      }),
    );
    assert.equal(result.tenantId, "tenant-a");
    assert.equal(result.organizationId, "org-a");
    assert.equal(result.slug, "customer-success");
  });

  it("rejects cyclic department parents", async () => {
    const state = createState([
      {
        id: "dept-a",
        name: "A",
        organizationId: "org-a",
        parentDepartmentId: "dept-b",
        slug: "a",
        status: "active",
        tenantId: "tenant-a",
      },
      {
        id: "dept-b",
        name: "B",
        organizationId: "org-a",
        parentDepartmentId: null,
        slug: "b",
        status: "active",
        tenantId: "tenant-a",
      },
    ]);
    await assert.rejects(
      state.run(() =>
        state.service.update("tenant-a", "org-a", "dept-b", {
          parentDepartmentId: "dept-a",
        }),
      ),
      BadRequestException,
    );
  });

  it("allows cross-organization dispatch only inside the same tenant", async () => {
    const state = createState([
      {
        id: "source",
        name: "Source",
        organizationId: "org-a",
        parentDepartmentId: null,
        slug: "source",
        status: "active",
        tenantId: "tenant-a",
      },
      {
        id: "target",
        name: "Target",
        organizationId: "org-b",
        parentDepartmentId: null,
        slug: "target",
        status: "active",
        tenantId: "tenant-a",
      },
    ]);
    const relation = await state.run(() =>
      state.service.createDispatchRelation("tenant-a", "org-a", "source", {
        targetDepartmentId: "target",
        type: "handoff",
      }),
    );
    assert.equal(relation.tenantId, "tenant-a");
    assert.equal(relation.targetDepartmentId, "target");
  });
});

function createState(seedDepartments: Array<Record<string, any>> = []) {
  const departments = [...seedDepartments];
  const relations: Array<Record<string, any>> = [];
  const repositories = new Map<any, any>();
  repositories.set(Organization, {
    findOne: async ({ where }: any) =>
      where.tenantId === "tenant-a" && where.id === "org-a"
        ? { id: "org-a", status: "active", tenantId: "tenant-a" }
        : null,
  });
  repositories.set(Department, {
    create: (value: any) => ({ id: value.id ?? `dept-${departments.length + 1}`, ...value }),
    find: async () => departments,
    findOne: async ({ where }: any) =>
      departments.find(
        (item) =>
          Object.entries(where).every(([key, value]) => item[key] === value),
      ) ?? null,
    save: async (value: any) => {
      const index = departments.findIndex((item) => item.id === value.id);
      if (index >= 0) departments[index] = value;
      else departments.push(value);
      return value;
    },
    softDelete: async () => ({ affected: 1 }),
  });
  repositories.set(DepartmentDispatchRelation, {
    create: (value: any) => ({ id: `relation-${relations.length + 1}`, ...value }),
    delete: async () => ({ affected: 1 }),
    find: async () => relations,
    findOne: async ({ where }: any) =>
      relations.find((item) =>
        Object.entries(where).every(([key, value]) => item[key] === value),
      ) ?? null,
    save: async (value: any) => {
      relations.push(value);
      return value;
    },
  });
  repositories.set(UserDepartment, { delete: async () => ({ affected: 1 }) });
  repositories.set(UserOrganization, { findOne: async () => null });

  const manager = {
    getRepository: (target: any) => repositories.get(target),
  } as EntityManager;
  const tenantContext = new TenantContextService();
  return {
    run: <T>(work: () => T) =>
      tenantContext.run(
        {
          departmentId: null,
          manager,
          organizationId: "org-a",
          scopeLevel: "organization",
          tenantId: "tenant-a",
        },
        work,
      ),
    service: new DepartmentsService(tenantContext),
  };
}
