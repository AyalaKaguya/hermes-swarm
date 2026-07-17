import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  Invite,
  Organization,
  Role,
  RolePermission,
  Tenant,
  User,
  UserOrganization,
  UserOrganizationRole,
} from "@hermes-swarm/core";
import { InviteService } from "./invite.service.js";

describe("InviteService workspace invitation contract", () => {
  it("creates one invitation with workspace and multiple organization assignments", async () => {
    const state = createState();
    const invite = await state.service.create("owner-a", {
      email: " Member@Example.com ",
      workspaceRoleId: "tenant-member",
      organizations: [
        { isDefault: true, organizationId: "org-a", roleId: "organization-member-a" },
        { organizationId: "org-b", roleId: "organization-viewer-b" },
      ],
    });
    assert.equal(invite.email, "member@example.com");
    assert.equal(invite.organizationAssignments.length, 2);
    assert.equal(invite.workspaceRoleId, "tenant-member");
    assert.match(invite.link ?? "", /workspace=workspace-a/);
    assert.equal(state.sentEmails.length, 1);
  });

  it("rejects cross-tenant organizations, wrong role scopes and multiple defaults", async () => {
    const state = createState();
    await assert.rejects(
      state.service.create("owner-a", {
        email: "member@example.com",
        workspaceRoleId: "tenant-member",
        organizations: [{ organizationId: "other-tenant-org", roleId: "organization-member-a" }],
      }),
      BadRequestException,
    );
    await assert.rejects(
      state.service.create("owner-a", {
        email: "member@example.com",
        workspaceRoleId: "tenant-member",
        organizations: [{ organizationId: "org-a", roleId: "tenant-member" }],
      }),
      BadRequestException,
    );
    await assert.rejects(
      state.service.create("owner-a", {
        email: "member@example.com",
        workspaceRoleId: "tenant-member",
        organizations: [{ organizationId: "org-a", roleId: "organization-viewer-b" }],
      }),
      BadRequestException,
    );
    await assert.rejects(
      state.service.create("owner-a", {
        email: "member@example.com",
        workspaceRoleId: "tenant-member",
        organizations: [
          { isDefault: true, organizationId: "org-a", roleId: "organization-member-a" },
          { isDefault: true, organizationId: "org-b", roleId: "organization-viewer-b" },
        ],
      }),
      BadRequestException,
    );
  });

  it("keeps one pending invitation per normalized tenant email", async () => {
    const state = createState();
    const payload = {
      email: "member@example.com",
      organizations: [],
      workspaceRoleId: "tenant-member",
    };
    await state.service.create("owner-a", payload);
    await assert.rejects(
      state.service.create("owner-a", { ...payload, email: "MEMBER@example.com" }),
      ConflictException,
    );
  });

  it("requires member-management access in every target organization", async () => {
    const state = createState();
    state.organizationPermissions.splice(0, state.organizationPermissions.length);
    await assert.rejects(
      state.service.create("owner-a", {
        email: "member@example.com",
        organizations: [{ organizationId: "org-a", roleId: "organization-member-a" }],
        workspaceRoleId: "tenant-member",
      }),
      /没有目标组织的成员管理权限/,
    );
  });
});

function createState() {
  const invites: Array<Record<string, any>> = [];
  const sentEmails: unknown[] = [];
  const organizations = [
    { id: "org-a", name: "A", status: "active", tenantId: "tenant-a" },
    { id: "org-b", name: "B", status: "active", tenantId: "tenant-a" },
    { id: "other-tenant-org", name: "Other", status: "active", tenantId: "tenant-b" },
  ];
  const roles = [
    { id: "tenant-member", organizationId: null, scope: "tenant", tenantId: "tenant-a" },
    { id: "organization-member-a", organizationId: "org-a", scope: "organization", tenantId: "tenant-a" },
    { id: "organization-viewer-b", organizationId: "org-b", scope: "organization", tenantId: "tenant-a" },
  ];
  const memberships = [
    { id: "membership-owner-a", organizationId: "org-a", status: "active", tenantId: "tenant-a", userId: "owner-a" },
    { id: "membership-owner-b", organizationId: "org-b", status: "active", tenantId: "tenant-a", userId: "owner-a" },
  ];
  const organizationRoleAssignments = [
    { membershipId: "membership-owner-a", organizationId: "org-a", roleId: "owner-role-a", tenantId: "tenant-a" },
    { membershipId: "membership-owner-b", organizationId: "org-b", roleId: "owner-role-b", tenantId: "tenant-a" },
  ];
  const organizationPermissions = [
    { enabled: true, permission: "user.organization_member.create:organization", roleId: "owner-role-a", tenantId: "tenant-a" },
    { enabled: true, permission: "user.organization_member.create:organization", roleId: "owner-role-b", tenantId: "tenant-a" },
  ];
  const manager = {
    find: async (target: unknown, { where }: any) => {
      const ids = readInValues(where.id);
      if (target === Organization) return organizations.filter((item) => ids.includes(item.id) && item.status === where.status && item.tenantId === where.tenantId);
      if (target === Role) return roles.filter((item) => ids.includes(item.id) && item.scope === where.scope && item.tenantId === where.tenantId);
      return [];
    },
    findOne: async (target: unknown, { where }: any = {}) => {
      if (target === Tenant) return { id: "tenant-a", slug: "workspace-a" };
      if (target === Role) {
        return roles.find((item) =>
          item.id === where.id &&
          item.organizationId === (where.organizationId?._type === "isNull" ? null : where.organizationId) &&
          item.scope === where.scope &&
          item.tenantId === where.tenantId,
        ) ?? null;
      }
      if (target === UserOrganization) {
        return memberships.find((item) =>
          item.organizationId === where.organizationId &&
          item.status === where.status &&
          item.tenantId === where.tenantId &&
          item.userId === where.userId,
        ) ?? null;
      }
      if (target === UserOrganizationRole) {
        return organizationRoleAssignments.find((item) =>
          item.membershipId === where.membershipId &&
          item.organizationId === where.organizationId &&
          item.tenantId === where.tenantId,
        ) ?? null;
      }
      if (target === RolePermission) {
        return organizationPermissions.find((item) =>
          item.enabled === where.enabled &&
          item.permission === where.permission &&
          item.roleId === where.roleId &&
          item.tenantId === where.tenantId,
        ) ?? null;
      }
      return null;
    },
    transaction: async (work: (manager: unknown) => unknown) => work(manager),
  };
  const repositories = new Map<any, any>([
    [Invite, {
      create: (value: any) => ({ id: `invite-${invites.length + 1}`, createdAt: new Date(), invitedBy: null, ...value }),
      find: async () => invites,
      findOne: async ({ where }: any) => invites.find((item) => item.email === where.email && item.status === where.status && item.tenantId === where.tenantId) ?? null,
      save: async (value: any) => { invites.push(value); return value; },
    }],
    [User, { findOne: async () => null }],
    [Organization, { find: async ({ where }: any) => organizations.filter((item) => readInValues(where.id).includes(item.id) && item.tenantId === where.tenantId) }],
  ]);
  const tenantContext = {
    current: () => ({ manager, tenantId: "tenant-a" }),
    repository: (target: unknown) => repositories.get(target),
  };
  const service = new InviteService(
    {} as never,
    tenantContext as never,
    { send: async (input: unknown) => { sentEmails.push(input); return { sent: true }; } } as never,
    {} as never,
    { getPlatformValue: async () => "http://localhost:3100" } as never,
  );
  return { organizationPermissions, sentEmails, service };
}

function readInValues(value: any): string[] {
  return value?._value ?? value?.value ?? [];
}
