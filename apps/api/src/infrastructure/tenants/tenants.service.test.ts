import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  buildTenantApplicationLinks,
  buildTenantOwnerActivationLink,
  TenantsService,
} from "./tenants.service.js";

describe("TenantsService applications", () => {
  it("normalizes a public application and requires email verification", async () => {
    const state = createState();
    const result = await state.service.apply({
      ownerDisplayName: " Alice ",
      ownerEmail: "ALICE@example.com",
      requestedName: "North Region",
      requestedSlug: "North Region",
    });
    assert.equal(result.applicationId, "application-1");
    assert.ok(result.verificationToken);
    assert.equal(state.applications[0]?.ownerEmail, "alice@example.com");
    assert.equal(state.applications[0]?.requestedSlug, "north-region");
    assert.equal(state.applications[0]?.status, "pending_email_verification");
    assert.ok(result.cancellationToken);
    assert.equal(result.verificationEmailSent, true);
    assert.equal(state.sentEmails[0]?.templateName, "tenant-application-verification");
  });

  it("keeps an application when platform email delivery fails", async () => {
    const state = createState({ failEmail: true });
    const result = await state.service.apply({
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
      preferredLanguage: "en-US",
      requestedName: "North Region",
    });
    assert.equal(result.verificationEmailSent, false);
    assert.equal(state.applications[0]?.preferredLanguage, "en");
  });

  it("builds encoded public application and activation links", () => {
    const links = buildTenantApplicationLinks("app/1", "verify token", "cancel token");
    assert.match(links.verificationLink, /applicationId=app%2F1/);
    assert.match(links.cancellationLink, /cancelToken=cancel\+token/);
    assert.match(
      buildTenantOwnerActivationLink("owner+tenant@example.com", "token value"),
      /email=owner%2Btenant%40example.com&token=token\+value/,
    );
  });

  it("moves a verified application into platform review", async () => {
    const state = createState();
    const applied = await state.service.apply({
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
      requestedName: "North Region",
      requestedSlug: "north-region",
    });
    const verified = await state.service.verifyApplication(
      applied.applicationId,
      applied.verificationToken,
    );
    assert.equal(verified.status, "pending_review");
    assert.ok(verified.emailVerifiedAt instanceof Date);
    assert.equal(verified.emailVerificationTokenHash, null);
  });

  it("rejects duplicate tenant slugs before creating an application", async () => {
    const state = createState({ duplicateSlug: "north-region" });
    await assert.rejects(
      state.service.apply({
        ownerDisplayName: "Alice",
        ownerEmail: "alice@example.com",
        requestedName: "North Region",
        requestedSlug: "north-region",
      }),
      BadRequestException,
    );
  });

  it("allows the applicant to cancel an unprocessed application with a private token", async () => {
    const state = createState();
    const applied = await state.service.apply({
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
      requestedName: "North Region",
      requestedSlug: "north-region",
    });
    const cancelled = await state.service.cancelApplication(
      applied.applicationId,
      applied.cancellationToken,
    );
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.cancellationTokenHash, null);
    assert.equal(cancelled.emailVerificationTokenHash, null);
  });

  it("does not expose application cancellation by id alone", async () => {
    const state = createState();
    const applied = await state.service.apply({
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
      requestedName: "North Region",
      requestedSlug: "north-region",
    });
    await assert.rejects(
      state.service.cancelApplication(applied.applicationId, "wrong-token"),
      BadRequestException,
    );
    assert.equal(state.applications[0]?.status, "pending_email_verification");
  });

  it("lets the platform suspend an active tenant but never directly activates provisioning", async () => {
    const active = createState({ tenant: { id: "tenant-1", status: "active" } });
    assert.equal(
      (await active.service.updateTenantStatus("tenant-1", "suspended")).status,
      "suspended",
    );

    const provisioning = createState({
      tenant: { id: "tenant-2", status: "provisioning" },
    });
    await assert.rejects(
      provisioning.service.updateTenantStatus("tenant-2", "active"),
      BadRequestException,
    );
    await assert.rejects(
      provisioning.service.updateTenantStatus("tenant-2", "suspended"),
      BadRequestException,
    );
    await assert.rejects(
      provisioning.service.updateTenantStatus("missing", "suspended"),
      NotFoundException,
    );
  });

  it("creates tenant roles without organization or department scope leakage", async () => {
    const state = createTenantRoleState();
    const created = await state.service.createTenantRole("tenant-1", {
      displayName: "Support Lead",
      name: "Support Lead",
    });
    assert.equal(created.name, "support-lead");
    assert.equal(created.scope, "tenant");
    assert.equal(state.roles[0]?.organizationId, null);
    assert.equal("departmentId" in state.roles[0], false);
  });

  it("keeps reserved system role names and tenant context isolated", async () => {
    const state = createTenantRoleState();
    await assert.rejects(
      state.service.createTenantRole("tenant-1", {
        displayName: "Looks like owner",
        name: "tenant-owner",
      }),
      BadRequestException,
    );
    await assert.rejects(
      state.service.listTenantRoles("tenant-2"),
      NotFoundException,
    );
  });

  it("returns tenant role permissions as the shared role DTO contract", async () => {
    const state = createTenantRoleState();
    state.roles.push({
      id: "role-owner",
      isSystem: true,
      label: "Tenant Owner",
      name: "tenant-owner",
      rolePermissions: [
        {
          enabled: true,
          id: "role-permission-1",
          permission: "tenant.tenant_profile.list_roles:tenant",
          permissionId: "permission-1",
          roleId: "role-owner",
        },
      ],
      scope: "tenant",
      tenantId: "tenant-1",
    });

    const [role] = await state.service.listTenantRoles("tenant-1");

    assert.deepEqual(role.permissions, [
      {
        enabled: true,
        id: "role-permission-1",
        permission: "tenant.tenant_profile.list_roles:tenant",
        permissionId: "permission-1",
        roleId: "role-owner",
      },
    ]);
  });

  it("rejects duplicate tenant role renames", async () => {
    const state = createTenantRoleState();
    const first = await state.service.createTenantRole("tenant-1", {
      displayName: "First",
      name: "first",
    });
    await state.service.createTenantRole("tenant-1", {
      displayName: "Second",
      name: "second",
    });
    await assert.rejects(
      state.service.updateTenantRole("tenant-1", first.id, { name: "second" }),
      BadRequestException,
    );
  });

  it("allows Tenant Owner to replace a system Tenant Member role's permissions", async () => {
    const state = createTenantRoleState();
    state.permissions.push({
      code: "user.tenant_user.list:tenant",
      id: "permission-list-users",
      scope: "tenant",
    });
    state.roles.push({
      id: "role-member",
      isSystem: true,
      label: "Tenant Member",
      name: "tenant-member",
      organizationId: null,
      rolePermissions: [],
      scope: "tenant",
      tenantId: "tenant-1",
    });

    const updated = await state.service.replaceTenantRolePermissions(
      "tenant-1",
      "role-member",
      {
        permissions: [
          { enabled: true, permission: "user.tenant_user.list:tenant" },
        ],
      },
    );

    assert.deepEqual(
      updated.permissions.map((item: any) => item.permission),
      ["user.tenant_user.list:tenant"],
    );
  });

  it("keeps Tenant Owner's full permission set immutable", async () => {
    const state = createTenantRoleState();
    state.roles.push({
      id: "role-owner",
      isSystem: true,
      label: "Tenant Owner",
      name: "tenant-owner",
      organizationId: null,
      rolePermissions: [],
      scope: "tenant",
      tenantId: "tenant-1",
    });

    await assert.rejects(
      state.service.replaceTenantRolePermissions("tenant-1", "role-owner", {
        permissions: [],
      }),
      BadRequestException,
    );
  });
});

function createState(options: {
  duplicateSlug?: string;
  failEmail?: boolean;
  tenant?: { id: string; status: string };
} = {}) {
  const applications: any[] = [];
  const applicationRepository: any = {
    create: (value: any) => ({ id: `application-${applications.length + 1}`, ...value }),
    findOne: async ({ where }: any) =>
      applications.find((item) => item.id === where.id) ?? null,
    save: async (value: any) => {
      const index = applications.findIndex((item) => item.id === value.id);
      if (index >= 0) applications[index] = value;
      else applications.push(value);
      return value;
    },
  };
  const tenantRepository: any = {
    find: async () => options.tenant ? [options.tenant] : [],
    findOne: async ({ where }: any) => {
      const candidates = Array.isArray(where) ? where : [where];
      if (options.tenant && candidates.some((candidate) => candidate.id === options.tenant?.id)) {
        return options.tenant;
      }
      return options.duplicateSlug &&
        candidates.some((candidate) => candidate.slug === options.duplicateSlug)
        ? { id: "existing-tenant" }
        : null;
    },
    save: async (value: any) => value,
  };
  const manager = {
    findOne: async (target: { name?: string }, { where }: any) => {
      if (target.name === "TenantApplication") {
        return applications.find((item) => item.id === where.id) ?? null;
      }
      return tenantRepository.findOne({ where });
    },
    save: async (target: { name?: string }, value: any) => {
      if (target.name === "TenantApplication") return applicationRepository.save(value);
      return tenantRepository.save(value);
    },
    transaction: async (work: (manager: any) => Promise<unknown>) => work(manager),
  };
  applicationRepository.manager = manager;
  tenantRepository.manager = manager;
  const sentEmails: any[] = [];
  return {
    applications,
    sentEmails,
    service: new TenantsService(
      tenantRepository as never,
      applicationRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        send: async (input: any) => {
          sentEmails.push(input);
          if (options.failEmail) throw new Error("smtp failed");
          return { sent: true };
        },
      } as never,
    ),
  };
}

function createTenantRoleState() {
  const roles: any[] = [];
  const permissions: any[] = [];
  const tenantContext = {
    current: () => ({
      manager: {
        delete: async (target: { name?: string }, where: any) => {
          if (target.name === "RolePermission") {
            const role = roles.find((item) => item.id === where.roleId);
            if (role) role.rolePermissions = [];
          }
          return { affected: 0 };
        },
        save: async (target: { name?: string }, values: any) => {
          if (target.name === "RolePermission") {
            const rows = Array.isArray(values) ? values : [values];
            const role = roles.find((item) => item.id === rows[0]?.roleId);
            if (role) {
              role.rolePermissions = rows.map((row, index) => ({
                id: `role-permission-${index + 1}`,
                ...row,
              }));
            }
          }
          return values;
        },
      },
      tenantId: "tenant-1",
    }),
    repository: (target: { name?: string }) => {
      if (target.name === "Role") {
        return {
          create: (value: any) => ({ id: `role-${roles.length + 1}`, ...value }),
          find: async () => roles,
          findOne: async ({ where }: any) =>
            roles.find(
              (role) =>
                (!where.id || role.id === where.id) &&
                (!where.name || role.name === where.name) &&
                role.tenantId === where.tenantId,
            ) ?? null,
          save: async (value: any) => {
            const index = roles.findIndex((role) => role.id === value.id);
            if (index >= 0) roles[index] = value;
            else roles.push(value);
            return value;
          },
        };
      }
      if (target.name === "Permission") {
        return {
          findOne: async ({ where }: any) =>
            permissions.find((permission) => permission.code === where.code) ?? null,
        };
      }
      return { findOne: async () => null };
    },
  };
  return {
    permissions,
    roles,
    service: new TenantsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      tenantContext as never,
      { send: async () => ({ sent: true }) } as never,
    ),
  };
}
