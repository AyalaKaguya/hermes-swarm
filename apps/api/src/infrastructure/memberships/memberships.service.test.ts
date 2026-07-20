import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  Organization,
  Role,
  User,
  UserOrganization,
  UserOrganizationRole,
} from "@hermes-swarm/core";
import { MembershipsService } from "./memberships.service.js";

describe("MembershipsService multi-organization membership", () => {
  it("reuses one tenant user across multiple organizations", async () => {
    const state = createState();
    const first = await state.service.create("org-a", { userId: "user-a", roleId: "role-member-a" });
    const second = await state.service.create("org-b", { userId: "user-a", roleId: "role-member-b" });
    assert.equal(first.userId, "user-a");
    assert.equal(second.userId, "user-a");
    assert.deepEqual(state.memberships.map((item) => item.organizationId).sort(), ["org-a", "org-b"]);
    assert.equal(state.users.length, 1);
  });

  it("lists only active workspace users who are not active organization members", async () => {
    const state = createState();
    state.users.push(
      {
        id: "user-b",
        displayName: "User B",
        email: "b@example.com",
        status: "active",
        tenantId: "tenant-a",
        type: "user",
      },
      {
        id: "user-disabled",
        displayName: "Disabled",
        email: "disabled@example.com",
        status: "disabled",
        tenantId: "tenant-a",
        type: "user",
      },
      {
        id: "user-other-tenant",
        displayName: "Other Tenant",
        email: "other@example.com",
        status: "active",
        tenantId: "tenant-b",
        type: "user",
      },
    );
    state.memberships.push({
      id: "membership-active",
      organizationId: "org-a",
      status: "active",
      tenantId: "tenant-a",
      userId: "user-a",
    });

    const candidates = await state.service.listCandidates("org-a");

    assert.deepEqual(candidates.map((candidate) => candidate.id), ["user-b"]);
  });

  it("rejects payloads that try to create a workspace user", async () => {
    const state = createState();

    await assert.rejects(
      state.service.create(
        "org-a",
        {
          email: "new@example.com",
          password: "not-allowed",
          roleId: "role-member-a",
        } as never,
      ),
      /不支持的字段/,
    );
    assert.equal(state.users.length, 1);
  });

  it("accepts only organization-scoped roles for memberships", async () => {
    const state = createState();
    const membership = await state.service.create("org-a", { userId: "user-a", roleId: "role-member-a" });
    await assert.rejects(
      state.service.replaceRole("org-a", membership.id, "role-tenant"),
      BadRequestException,
    );
  });

  it("replaces the membership's single organization role", async () => {
    const state = createState();
    const membership = await state.service.create("org-a", { userId: "user-a", roleId: "role-member-a" });
    const updated = await state.service.replaceRole("org-a", membership.id, "role-viewer-a");
    assert.equal(updated.role.id, "role-viewer-a");
  });

  it("removing a membership does not delete the tenant user", async () => {
    const state = createState();
    const membership = await state.service.create("org-a", { userId: "user-a", roleId: "role-member-a" });
    await state.service.remove("org-a", membership.id);
    assert.equal(state.memberships.length, 0);
    assert.equal(state.users.length, 1);
  });
});

function createState() {
  const users: Array<Record<string, any>> = [{
    id: "user-a",
    displayName: "User A",
    email: "a@example.com",
    status: "active",
    tenantId: "tenant-a",
    type: "user",
  }];
  const organizations = [
    { id: "org-a", name: "A", parentOrganizationId: "root", status: "active", tenantId: "tenant-a" },
    { id: "org-b", name: "B", parentOrganizationId: "root", status: "active", tenantId: "tenant-a" },
  ];
  const roles = [
    { id: "role-member-a", name: "member", organizationId: "org-a", scope: "organization", tenantId: "tenant-a" },
    { id: "role-viewer-a", name: "viewer", organizationId: "org-a", scope: "organization", tenantId: "tenant-a" },
    { id: "role-member-b", name: "member", organizationId: "org-b", scope: "organization", tenantId: "tenant-a" },
    { id: "role-tenant", name: "tenant-member", organizationId: null, scope: "tenant", tenantId: "tenant-a" },
  ];
  const memberships: Array<Record<string, any>> = [];
  const assignments: Array<Record<string, any>> = [];
  const manager = {
    delete: async (target: unknown, where: any) => {
      if (target === UserOrganizationRole) {
        for (let i = assignments.length - 1; i >= 0; i -= 1) if (assignments[i].membershipId === where.membershipId) assignments.splice(i, 1);
      }
    },
    save: async (target: unknown, values: any) => {
      if (target === UserOrganizationRole) assignments.push(...(Array.isArray(values) ? values : [values]));
      return values;
    },
  };
  const repositories = new Map<any, any>([
    [Organization, { findOne: async ({ where }: any) => organizations.find((item) => item.id === where.id && item.tenantId === where.tenantId) ?? null }],
    [User, {
      find: async ({ where }: any) => users
        .filter((item) => item.tenantId === where.tenantId)
        .filter((item) => where.status === undefined || item.status === where.status)
        .filter((item) => where.type === undefined || item.type === where.type)
        .sort((left, right) => left.displayName.localeCompare(right.displayName)),
      findOne: async ({ where }: any) => users.find(
        (item) =>
          item.id === where.id &&
          item.tenantId === where.tenantId &&
          (where.status === undefined || item.status === where.status) &&
          (where.type === undefined || item.type === where.type),
      ) ?? null,
    }],
    [Role, { findOne: async ({ where }: any) => roles.find((item) => item.id === where.id && item.organizationId === where.organizationId && item.scope === where.scope && item.tenantId === where.tenantId) ?? null }],
    [UserOrganization, {
      count: async () => 2,
      create: (value: any) => ({ id: `membership-${memberships.length + 1}`, ...value }),
      find: async ({ where }: any) => memberships
        .filter((item) => item.organizationId === where.organizationId)
        .filter((item) => item.tenantId === where.tenantId)
        .filter((item) => where.status === undefined || item.status === where.status),
      findOne: async ({ where }: any) => memberships.find((item) => item.id === where.id || (item.organizationId === where.organizationId && item.userId === where.userId)) ?? null,
      remove: async (value: any) => { const index = memberships.indexOf(value); if (index >= 0) memberships.splice(index, 1); },
      save: async (value: any) => { if (!memberships.includes(value)) memberships.push(value); return value; },
    }],
    [UserOrganizationRole, {
      count: async ({ where }: any) => assignments.filter((item) => item.organizationId === where.organizationId && item.roleId === where.roleId && item.tenantId === where.tenantId).length,
      find: async ({ where }: any) => assignments.filter((item) => readInValues(where.membershipId).includes(item.membershipId)).map((item) => ({ ...item, role: roles.find((role) => role.id === item.roleId) })),
      findOne: async ({ where }: any) => {
        const item = assignments.find((assignment) => assignment.membershipId === where.membershipId && assignment.tenantId === where.tenantId);
        return item ? { ...item, role: roles.find((role) => role.id === item.roleId) } : null;
      },
    }],
  ]);
  const service = new MembershipsService({
    current: () => ({ manager, tenantId: "tenant-a" }),
    repository: (target: unknown) => repositories.get(target),
  } as never);
  return { memberships, service, users };
}

function readInValues(value: any): string[] {
  return value?._value ?? value?.value ?? [];
}
