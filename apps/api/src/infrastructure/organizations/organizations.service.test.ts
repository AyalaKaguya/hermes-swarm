import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { createAuthSessionToken } from "../auth/auth-session.js";
import { OrganizationsService } from "./organizations.service.js";

type RoleRecord = {
  color: string | null;
  description: string | null;
  displayName: string | null;
  id: string;
  isSystem: boolean;
  label: string;
  name: string;
  organizationId: string;
  rolePermissions: unknown[];
  scope: "organization";
};

const ORGANIZATION_ID = "org-1";
const PLATFORM_ROLE_ID = "role-platform";
const PLATFORM_USER_ID = "user-platform";
const ORG_USER_ID = "user-org";
const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const platformToken = bearerToken(PLATFORM_USER_ID);
const orgToken = bearerToken(ORG_USER_ID);

describe("OrganizationsService role protections", () => {
  it("allows safe display metadata edits for system organization roles", async () => {
    const role = systemRole();
    const state = createService({ role });

    const result = await state.service.updateRole(ORGANIZATION_ID, role.id, {
      color: "#0f172a",
      description: "Primary organization owner",
      displayName: "Organization Owner",
      name: "owner",
    });

    assert.equal(result.id, role.id);
    assert.equal(result.displayName, "Organization Owner");
    assert.equal(result.label, "Organization Owner");
    assert.equal(result.color, "#0f172a");
    assert.equal(result.description, "Primary organization owner");
    assert.equal(result.name, "owner");
    assert.equal(state.savedRoles.length, 1);
  });

  it("rejects renaming system organization roles", async () => {
    const role = systemRole();
    const state = createService({ role });

    await assert.rejects(
      () =>
        state.service.updateRole(ORGANIZATION_ID, role.id, {
          name: "renamed-owner",
        }),
      BadRequestException,
    );

    assert.equal(state.savedRoles.length, 0);
  });

  it("rejects replacing permissions for system organization roles", async () => {
    const role = systemRole();
    const state = createService({ role });

    await assert.rejects(
      () =>
        state.service.replaceRolePermissions(ORGANIZATION_ID, role.id, {
          permissions: [
            {
              enabled: true,
              permission: "organization.profile.view:organization",
            },
          ],
        }),
      BadRequestException,
    );

    assert.equal(state.deletedRolePermissionQueries.length, 0);
    assert.equal(state.savedRolePermissions.length, 0);
  });

  it("rejects deleting system organization roles", async () => {
    const role = systemRole();
    const state = createService({ role });

    await assert.rejects(
      () => state.service.deleteRole(ORGANIZATION_ID, role.id),
      BadRequestException,
    );

    assert.equal(state.deletedRoleQueries.length, 0);
  });

  it("clears organization member role references and permissions when deleting a custom role", async () => {
    const role = customRole();
    const state = createService({
      role,
      roleMembershipUserIds: ["user-with-role"],
    });

    await state.service.deleteRole(ORGANIZATION_ID, role.id);

    assert.deepEqual(state.updatedMembershipRoleQueries, [
      {
        query: {
          organizationId: ORGANIZATION_ID,
          roleId: role.id,
          tenantId: TENANT_ID,
        },
        target: "UserOrganization",
        value: { roleId: null },
      },
    ]);
    assert.deepEqual(state.deletedRolePermissionQueries, [
      { roleId: role.id, tenantId: TENANT_ID },
    ]);
    assert.deepEqual(state.deletedRoleQueries, [
      { id: role.id, tenantId: TENANT_ID },
    ]);
    assert.equal(state.revokedIntegrationTokenUpdates.length, 1);
    assert.equal(
      getFindOperatorValues(
        state.revokedIntegrationTokenUpdates[0].query.ownerUserId,
      )[0],
      "user-with-role",
    );
  });

  it("continues to replace permissions for custom organization roles", async () => {
    const role = customRole();
    const state = createService({
      role,
      roleMembershipUserIds: ["user-with-role"],
    });

    const result = await state.service.replaceRolePermissions(
      ORGANIZATION_ID,
      role.id,
      {
        permissions: [
          {
            enabled: true,
            permission: "organization.profile.view:organization",
          },
          {
            enabled: false,
            permission: "organization.profile.update_basic:organization",
          },
        ],
      },
    );

    assert.deepEqual(state.deletedRolePermissionQueries, [
      { roleId: role.id, tenantId: TENANT_ID },
    ]);
    assert.equal(state.savedRolePermissions.length, 1);
    assert.equal(
      state.savedRolePermissions[0].permission,
      "organization.profile.view:organization",
    );
    assert.equal(state.revokedIntegrationTokenUpdates.length, 1);
    assert.equal(
      getFindOperatorValues(
        state.revokedIntegrationTokenUpdates[0].query.ownerUserId,
      )[0],
      "user-with-role",
    );
    assert.equal(result.length, 1);
  });

  it("rejects malformed organization role permission payloads before clearing permissions", async () => {
    const role = customRole();
    const state = createService({ role });

    await assert.rejects(
      () => state.service.replaceRolePermissions(ORGANIZATION_ID, role.id, null as any),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.replaceRolePermissions(ORGANIZATION_ID, role.id, {
          permissions: "all" as any,
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.replaceRolePermissions(ORGANIZATION_ID, role.id, {
          permissions: [{ enabled: true } as any],
        }),
      BadRequestException,
    );

    assert.equal(state.deletedRolePermissionQueries.length, 0);
    assert.equal(state.savedRolePermissions.length, 0);
    assert.equal(state.revokedIntegrationTokenUpdates.length, 0);
  });

  it("does not clear existing permissions when a requested organization permission is missing", async () => {
    const role = customRole();
    const state = createService({ role });

    await assert.rejects(
      () =>
        state.service.replaceRolePermissions(ORGANIZATION_ID, role.id, {
          permissions: [
            {
              enabled: true,
              permission: "missing.permission:organization",
            },
          ],
        }),
      BadRequestException,
    );

    assert.equal(state.deletedRolePermissionQueries.length, 0);
    assert.equal(state.savedRolePermissions.length, 0);
  });

  it("allows tenant-scoped organization lifecycle updates", async () => {
    const role = customRole();
    const organization = organizationRecord();
    const state = createService({ organization, role });

    const result = await state.service.update(orgToken, ORGANIZATION_ID, {
      status: "suspended",
    });

    assert.equal(result.status, "suspended");
    assert.equal(state.savedOrganizations.length, 1);
  });

  it("allows platform organization control updates with platform membership permission", async () => {
    const role = customRole();
    const organization = organizationRecord();
    const state = createService({
      organization,
      platformMember: {
        roleId: PLATFORM_ROLE_ID,
        status: "active",
        userId: PLATFORM_USER_ID,
      },
      platformRolePermissions: [
        {
          enabled: true,
          permission: "organization.platform_organization.create:platform",
          roleId: PLATFORM_ROLE_ID,
        },
      ],
      role,
    });

    const result = await state.service.update(platformToken, ORGANIZATION_ID, {
      isDefault: true,
      status: "suspended",
    });

    assert.equal(result.status, "suspended");
    assert.equal(result.isDefault, true);
    assert.equal(state.savedOrganizations.length, 1);
  });

  it("maps concurrent organization slug or subdomain uniqueness failures during create", async () => {
    const state = createService({
      failOrganizationSaveWithUniqueError: true,
      role: customRole(),
    });

    await assert.rejects(
      () =>
        state.service.create(platformToken, {
          name: "New Organization",
          slug: "new-org",
        }),
      BadRequestException,
    );

    assert.equal(state.createdMemberships.length, 0);
    assert.equal(state.createdRoles.length, 0);
  });

  it("maps concurrent organization slug or subdomain uniqueness failures during update", async () => {
    const role = customRole();
    const organization = organizationRecord();
    const state = createService({
      failOrganizationSaveWithUniqueError: true,
      organization,
      role,
    });

    await assert.rejects(
      () =>
        state.service.update(platformToken, ORGANIZATION_ID, {
          slug: "renamed-org",
        }),
      BadRequestException,
    );
  });

  it("maps concurrent organization role name uniqueness failures", async () => {
    const state = createService({
      failRoleSaveWithUniqueError: true,
      organization: organizationRecord(),
      role: customRole(),
    });

    await assert.rejects(
      () =>
        state.service.createRole(ORGANIZATION_ID, {
          displayName: "Support",
          name: "support",
        }),
      BadRequestException,
    );
  });

  it("rejects non-object organization and role payloads before side effects", async () => {
    const organization = organizationRecord();
    const role = customRole();
    const state = createService({ organization, role });

    for (const payload of [null, []] as const) {
      await assert.rejects(
        () => state.service.create(undefined, payload as any),
        BadRequestException,
      );
      await assert.rejects(
        () =>
          state.service.update(undefined, organization.id, payload as any),
        BadRequestException,
      );
      await assert.rejects(
        () => state.service.createRole(organization.id, payload as any),
        BadRequestException,
      );
      await assert.rejects(
        () => state.service.updateRole(organization.id, role.id, payload as any),
        BadRequestException,
      );
    }

    assert.equal(state.transactions, 0);
    assert.equal(state.createdOrganizations.length, 0);
    assert.equal(state.defaultOrganizationClearUpdates.length, 0);
    assert.equal(state.savedOrganizations.length, 0);
    assert.equal(state.savedRoles.length, 0);
  });

  it("creates organization, default roles, and owner membership in one transaction", async () => {
    const state = createService({ role: customRole() });

    const result = await state.service.create(platformToken, {
      name: "New Organization",
      slug: "new-org",
      status: "active",
    });

    assert.equal(result.slug, "new-org");
    assert.equal(state.transactions, 0);
    assert.equal(state.createdOrganizations.length, 1);
    assert.equal(state.createdRoles.length, 4);
    assert.equal(state.createdMemberships.length, 1);
    assert.equal(state.createdMemberships[0].roleId, "role-owner");
    assert.equal(state.seededTemplateOrganizationIds[0], "org-created");
  });

  it("rejects malformed organization create payloads before opening a transaction", async () => {
    const state = createService({ role: customRole() });

    await assert.rejects(
      () =>
        state.service.create(platformToken, {
          isDefault: "false" as any,
          name: "New Organization",
          slug: "new-org",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.create(platformToken, {
          name: "New Organization",
          status: "paused" as any,
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.create(platformToken, {
          name: 42 as any,
        }),
      BadRequestException,
    );

    assert.equal(state.transactions, 0);
    assert.equal(state.createdOrganizations.length, 0);
  });

  it("clears previous default organizations when creating a new default organization", async () => {
    const state = createService({ role: customRole() });

    const result = await state.service.create(platformToken, {
      isDefault: true,
      name: "New Default Organization",
      slug: "new-default",
      status: "active",
    });

    assert.equal(result.isDefault, true);
    assert.equal(state.defaultOrganizationClearUpdates.length, 1);
    assert.deepEqual(state.defaultOrganizationClearUpdates[0].update, {
      isDefault: false,
    });
    assert.equal(state.defaultOrganizationClearUpdates[0].where.isDefault, true);
    assert.equal(state.defaultOrganizationClearUpdates[0].where.tenantId, TENANT_ID);
    assert.equal(state.defaultOrganizationClearUpdates[0].where.deletedAt._type, "isNull");
  });

  it("rolls back organization creation when default role initialization fails", async () => {
    const state = createService({
      failDefaultRoleSave: true,
      role: customRole(),
    });

    await assert.rejects(() =>
      state.service.create(platformToken, {
        name: "New Organization",
        slug: "new-org",
        status: "active",
      }),
    );

    assert.equal(state.transactions, 0);
    assert.equal(state.createdOrganizations.length, 0);
    assert.equal(state.createdRoles.length, 0);
    assert.equal(state.createdMemberships.length, 0);
    assert.equal(state.seededTemplateOrganizationIds.length, 0);
  });

  it("rolls back organization creation when default email template initialization fails", async () => {
    const state = createService({
      failTemplateSeed: true,
      role: customRole(),
    });

    await assert.rejects(() =>
      state.service.create(platformToken, {
        name: "New Organization",
        slug: "new-org",
        status: "active",
      }),
    );

    assert.equal(state.transactions, 0);
    assert.equal(state.createdOrganizations.length, 0);
    assert.equal(state.createdRoles.length, 0);
    assert.equal(state.createdMemberships.length, 0);
    assert.equal(state.seededTemplateOrganizationIds.length, 0);
  });

  it("clears previous default organizations when updating an organization as default", async () => {
    const role = customRole();
    const organization = organizationRecord();
    const state = createService({
      organization,
      platformMember: {
        roleId: PLATFORM_ROLE_ID,
        status: "active",
        userId: PLATFORM_USER_ID,
      },
      platformRolePermissions: [
        {
          enabled: true,
          permission: "organization.platform_organization.create:platform",
          roleId: PLATFORM_ROLE_ID,
        },
      ],
      role,
    });

    const result = await state.service.update(platformToken, ORGANIZATION_ID, {
      isDefault: true,
    });

    assert.equal(result.isDefault, true);
    assert.equal(state.transactions, 0);
    assert.equal(state.defaultOrganizationClearUpdates.length, 1);
    assert.deepEqual(state.defaultOrganizationClearUpdates[0].update, {
      isDefault: false,
    });
    assert.equal(state.defaultOrganizationClearUpdates[0].where.isDefault, true);
    assert.equal(state.defaultOrganizationClearUpdates[0].where.tenantId, TENANT_ID);
    assert.equal(state.defaultOrganizationClearUpdates[0].where.deletedAt._type, "isNull");
    assert.equal(state.savedOrganizations.length, 1);
  });

  it("rejects malformed organization updates before saving or clearing defaults", async () => {
    const role = customRole();
    const organization = organizationRecord();
    const state = createService({
      organization,
      platformMember: {
        roleId: PLATFORM_ROLE_ID,
        status: "active",
        userId: PLATFORM_USER_ID,
      },
      platformRolePermissions: [
        {
          enabled: true,
          permission: "organization.platform_organization.create:platform",
          roleId: PLATFORM_ROLE_ID,
        },
      ],
      role,
    });

    await assert.rejects(
      () =>
        state.service.update(platformToken, ORGANIZATION_ID, {
          isDefault: "false" as any,
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.update(platformToken, ORGANIZATION_ID, {
          status: "paused" as any,
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.update(platformToken, ORGANIZATION_ID, {
          totalEmployees: "3" as any,
        }),
      BadRequestException,
    );

    assert.equal(state.defaultOrganizationClearUpdates.length, 0);
    assert.equal(state.savedOrganizations.length, 0);
    assert.equal(organization.isDefault, false);
    assert.equal(organization.status, "active");
  });

  it("revokes organization integration tokens before deleting an organization", async () => {
    const organization = organizationRecord();
    const state = createService({ organization, role: customRole() });

    await state.service.delete(organization.id);

    assert.equal(state.revokedIntegrationTokenUpdates.length, 1);
    assert.equal(
      state.revokedIntegrationTokenUpdates[0].query.organizationId,
      organization.id,
    );
    assert.equal(state.revokedIntegrationTokenUpdates[0].query.scope, "organization");
    assert.ok(state.revokedIntegrationTokenUpdates[0].value.revokedAt instanceof Date);
    assert.equal(
      state.revokedIntegrationTokenUpdates[0].value.revokedReason,
      "organization_deleted",
    );
    assert.deepEqual(state.deletedOrganizationQueries, [
      { id: organization.id, tenantId: TENANT_ID },
    ]);
  });
});

function createService(options: {
  failDefaultRoleSave?: boolean;
  failTemplateSeed?: boolean;
  failOrganizationSaveWithUniqueError?: boolean;
  failRoleSaveWithUniqueError?: boolean;
  organization?: ReturnType<typeof organizationRecord>;
  platformMember?: {
    roleId: string;
    status: string;
    userId: string;
  };
  platformRolePermissions?: Array<{
    enabled: boolean;
    permission: string;
    roleId: string;
  }>;
  role: RoleRecord;
  roleMembershipUserIds?: string[];
}) {
  const savedOrganizations: Array<ReturnType<typeof organizationRecord>> = [];
  const savedRoles: RoleRecord[] = [];
  const deletedRoleQueries: unknown[] = [];
  const deletedRolePermissionQueries: unknown[] = [];
  const savedRolePermissions: any[] = [];
  const createdOrganizations: any[] = [];
  const createdRoles: any[] = [];
  const createdMemberships: any[] = [];
  const createdDefaultRolePermissions: any[] = [];
  const defaultOrganizationClearUpdates: any[] = [];
  const deletedOrganizationQueries: any[] = [];
  const revokedIntegrationTokenUpdates: any[] = [];
  const seededTemplateOrganizationIds: string[] = [];
  const updatedMembershipRoleQueries: any[] = [];
  let transactions = 0;

  const legacyRepositories = [
    {
      create(value: any) {
        return value;
      },
      async findOne({ where }: any) {
        if (where.id === options.organization?.id) {
          return options.organization;
        }
        return null;
      },
      manager: {
        async transaction(callback: (manager: any) => Promise<unknown>) {
          transactions += 1;
          const snapshots = {
            memberships: [...createdMemberships],
            organizations: [...createdOrganizations],
            rolePermissions: [...createdDefaultRolePermissions],
            roles: [...createdRoles],
          };
          try {
            return await callback({
              async find() {
                return [
                  {
                    code: "organization.profile.view:organization",
                    defaultRoles: ["owner", "admin", "member", "viewer"],
                    id: "permission-view-profile",
                    scope: "organization",
                  },
                ];
              },
              async save(target: { name?: string }, value: any) {
                if (target.name === "Organization") {
                  if (options.failOrganizationSaveWithUniqueError) {
                    throw { driverError: { code: "23505" } };
                  }
                  if (value.id) {
                    savedOrganizations.push({ ...value });
                    return value;
                  }
                  const organization = {
                    createdAt: new Date("2026-07-01T00:00:00Z"),
                    id: "org-created",
                    updatedAt: new Date("2026-07-01T00:00:00Z"),
                    ...value,
                  };
                  createdOrganizations.push(organization);
                  return organization;
                }
                if (target.name === "Role") {
                  if (options.failDefaultRoleSave) {
                    throw new Error("role save failed");
                  }
                  const roles = value.map((role: any) => ({
                    id: `role-${role.name}`,
                    ...role,
                  }));
                  createdRoles.push(...roles);
                  return roles;
                }
                if (target.name === "RolePermission") {
                  createdDefaultRolePermissions.push(...value);
                  return value;
                }
                if (target.name === "UserOrganization") {
                  createdMemberships.push(value);
                  return value;
                }
                return value;
              },
              async update(
                target: { name?: string },
                where: unknown,
                update: unknown,
              ) {
                if (target.name === "Organization") {
                  defaultOrganizationClearUpdates.push({ update, where });
                }
                if (target.name === "IntegrationToken") {
                  revokedIntegrationTokenUpdates.push({
                    query: where,
                    value: update,
                  });
                }
              },
              async softDelete(target: { name?: string }, query: unknown) {
                if (target.name === "Organization") {
                  deletedOrganizationQueries.push(query);
                }
              },
            });
          } catch (error) {
            createdOrganizations.splice(
              0,
              createdOrganizations.length,
              ...snapshots.organizations,
            );
            createdRoles.splice(0, createdRoles.length, ...snapshots.roles);
            createdMemberships.splice(
              0,
              createdMemberships.length,
              ...snapshots.memberships,
            );
            createdDefaultRolePermissions.splice(
              0,
              createdDefaultRolePermissions.length,
              ...snapshots.rolePermissions,
            );
            throw error;
          }
        },
      },
      async save(organization: ReturnType<typeof organizationRecord>) {
        if (options.failOrganizationSaveWithUniqueError) {
          throw { driverError: { code: "23505" } };
        }
        savedOrganizations.push({ ...organization });
        return organization;
      },
    } as any,
    {
      async findOne({ where }: any) {
        const candidates = Array.isArray(where) ? where : [where];
        const match = candidates.find(
          (candidate) =>
            candidate.code === "organization.profile.view:organization" &&
            candidate.scope === "organization",
        );
        return match
          ? {
              code: match.code,
              id: "permission-1",
              scope: match.scope,
            }
          : null;
      },
    } as any,
    {
      create(value: any) {
        return value;
      },
      async delete(query: unknown) {
        deletedRoleQueries.push(query);
      },
      async findOne({ where }: any) {
        if (where.name === "support" && where.organizationId === ORGANIZATION_ID) {
          return null;
        }
        return where.id === options.role.id &&
          where.organizationId === options.role.organizationId &&
          where.scope === options.role.scope
          ? options.role
          : null;
      },
      manager: {
        async transaction(callback: (manager: any) => Promise<unknown>) {
          return callback({
            async delete(target: { name?: string }, query: unknown) {
              if (target.name === "RolePermission") {
                deletedRolePermissionQueries.push(query);
                return;
              }
              if (target.name === "Role") {
                deletedRoleQueries.push(query);
              }
            },
            async update(
              target: { name?: string },
              query: unknown,
              value: unknown,
            ) {
              if (target.name === "IntegrationToken") {
                revokedIntegrationTokenUpdates.push({ query, value });
              } else {
                updatedMembershipRoleQueries.push({
                  query,
                  target: target.name,
                  value,
                });
              }
            },
            async find(target: { name?: string }) {
              if (target.name === "UserOrganization") {
                return (options.roleMembershipUserIds ?? []).map((userId) => ({
                  userId,
                }));
              }
              return [];
            },
          });
        },
      },
      async save(role: RoleRecord) {
        if (options.failRoleSaveWithUniqueError) {
          throw { driverError: { code: "23505" } };
        }
        savedRoles.push({ ...role });
        return role;
      },
    } as any,
    {
      create(value: any) {
        return value;
      },
      async delete(query: unknown) {
        deletedRolePermissionQueries.push(query);
      },
      manager: {
        async transaction(callback: (manager: any) => Promise<unknown>) {
          return callback({
            async delete(_target: unknown, query: unknown) {
              deletedRolePermissionQueries.push(query);
            },
            async find(target: { name?: string }) {
              if (target.name === "UserOrganization") {
                return (options.roleMembershipUserIds ?? []).map((userId) => ({
                  userId,
                }));
              }
              return [];
            },
            async save(_target: unknown, values: any[]) {
              savedRolePermissions.push(...values);
              return values;
            },
            async update(target: { name?: string }, query: unknown, value: unknown) {
              if (target.name === "IntegrationToken") {
                revokedIntegrationTokenUpdates.push({ query, value });
              }
            },
          });
        },
      },
      async save(values: any[]) {
        savedRolePermissions.push(...values);
        return values;
      },
      async findOne({ where }: any) {
        const candidates = Array.isArray(where) ? where : [where];
        return (
          (options.platformRolePermissions ?? []).find((permission) =>
            candidates.some((candidate) =>
              Object.entries(candidate).every(
                ([key, value]) => (permission as any)[key] === value,
              ),
            ),
          ) ?? null
        );
      },
    } as any,
    {
      async findOne({ where }: any) {
        return where.userId === options.platformMember?.userId &&
          where.status === options.platformMember?.status
          ? options.platformMember
          : null;
      },
    } as any,
    {
      create(value: any) {
        return value;
      },
    } as any,
    {
      validateAccessToken: async (token: string | undefined) => {
        if (token === stripBearerToken(orgToken)) {
          return { sessionId: "session-org", tokenKind: "session", userId: ORG_USER_ID };
        }
        if (token === stripBearerToken(platformToken)) {
          return {
            sessionId: "session-platform",
            tokenKind: "session",
            userId: PLATFORM_USER_ID,
          };
        }
        throw new Error("invalid token");
      },
    } as any,
    {
      async getPlatformValue(_key: string, fallback: string) {
        return fallback;
      },
    } as any,
    {
      async ensureDefaultTemplatesForOrganization(organizationId: string) {
        if (options.failTemplateSeed) {
          createdOrganizations.splice(0);
          createdRoles.splice(0);
          createdMemberships.splice(0);
          createdDefaultRolePermissions.splice(0);
          throw new Error("template seed failed");
        }
        seededTemplateOrganizationIds.push(organizationId);
      },
    } as any,
  ];
  const tenantManager = {
    async find(target: { name?: string }) {
      if (target.name === "Permission") {
        return [{
          code: "organization.profile.view:organization",
          defaultRoles: ["owner", "admin", "member", "viewer"],
          id: "permission-view-profile",
          scope: "organization",
        }];
      }
      if (target.name === "UserOrganization") {
        return (options.roleMembershipUserIds ?? []).map((userId) => ({
          tenantId: TENANT_ID,
          userId,
        }));
      }
      return [];
    },
    async save(target: { name?: string }, value: any) {
      if (target.name === "Organization") {
        if (options.failOrganizationSaveWithUniqueError) {
          throw { driverError: { code: "23505" } };
        }
        if (value.id) {
          savedOrganizations.push({ ...value });
          return value;
        }
        const organization = {
          createdAt: new Date("2026-07-01T00:00:00Z"),
          id: "org-created",
          updatedAt: new Date("2026-07-01T00:00:00Z"),
          ...value,
        };
        createdOrganizations.push(organization);
        return organization;
      }
      if (target.name === "Role") {
        if (Array.isArray(value)) {
          if (options.failDefaultRoleSave) {
            createdOrganizations.splice(0);
            throw new Error("role save failed");
          }
          const roles = value.map((role: any) => ({ id: `role-${role.name}`, ...role }));
          createdRoles.push(...roles);
          return roles;
        }
        if (options.failRoleSaveWithUniqueError) {
          throw { driverError: { code: "23505" } };
        }
        savedRoles.push({ ...value });
        return value;
      }
      if (target.name === "RolePermission") {
        const values = Array.isArray(value) ? value : [value];
        savedRolePermissions.push(...values);
        createdDefaultRolePermissions.push(...values);
        return value;
      }
      if (target.name === "UserOrganization") {
        createdMemberships.push(value);
      }
      return value;
    },
    async update(target: { name?: string }, query: unknown, value: unknown) {
      if (target.name === "Organization") {
        defaultOrganizationClearUpdates.push({ update: value, where: query });
      } else if (target.name === "IntegrationToken") {
        revokedIntegrationTokenUpdates.push({ query, value });
      } else {
        updatedMembershipRoleQueries.push({ query, target: target.name, value });
      }
    },
    async delete(target: { name?: string }, query: unknown) {
      if (target.name === "RolePermission") deletedRolePermissionQueries.push(query);
      if (target.name === "Role") deletedRoleQueries.push(query);
    },
    async softDelete(target: { name?: string }, query: unknown) {
      if (target.name === "Organization") deletedOrganizationQueries.push(query);
    },
  };
  const tenantContext = {
    current: () => ({ manager: tenantManager, tenantId: TENANT_ID }),
    repository: (target: { name?: string }) => {
      if (target.name === "Organization") return legacyRepositories[0];
      if (target.name === "Permission") return legacyRepositories[1];
      if (target.name === "Role") return legacyRepositories[2];
      if (target.name === "RolePermission") return legacyRepositories[3];
      return legacyRepositories[5];
    },
  } as any;
  const service = new OrganizationsService(
    tenantContext,
    legacyRepositories[6],
    legacyRepositories[7],
    legacyRepositories[8],
  );

  return {
    createdDefaultRolePermissions,
    createdMemberships,
    createdOrganizations,
    createdRoles,
    defaultOrganizationClearUpdates,
    deletedOrganizationQueries,
    deletedRolePermissionQueries,
    deletedRoleQueries,
    revokedIntegrationTokenUpdates,
    savedOrganizations,
    savedRolePermissions,
    savedRoles,
    seededTemplateOrganizationIds,
    service,
    updatedMembershipRoleQueries,
    get transactions() {
      return transactions;
    },
  };
}

function organizationRecord() {
  return {
    banner: null,
    brandColor: null,
    clientFocus: null,
    createdByUserId: ORG_USER_ID,
    currency: null,
    dateFormat: null,
    deletedAt: null,
    id: ORGANIZATION_ID,
    imageUrl: null,
    isDefault: false,
    logoUrl: null,
    name: "Hermes",
    officialName: "Hermes",
    overview: null,
    preferredLanguage: "zh-CN",
    profileLink: null,
    regionCode: null,
    shortDescription: null,
    slug: "hermes",
    status: "active" as const,
    subdomain: "hermes",
    timeZone: null,
    totalEmployees: null,
    website: null,
  };
}

function bearerToken(userId: string) {
  return `Bearer ${createAuthSessionToken({
    jti: `jti-${userId}`,
    principalType: "tenant",
    sessionId: `session-${userId}`,
    tenantId: "00000000-0000-4000-8000-000000000001",
    userId,
  })}`;
}

function stripBearerToken(value: string) {
  return value.replace(/^Bearer\s+/i, "").trim();
}

function getFindOperatorValues(value: unknown) {
  const typed = value as { _value?: unknown };
  return Array.isArray(typed._value) ? typed._value : [];
}

function systemRole(): RoleRecord {
  return {
    color: "#2563eb",
    description: "Owner",
    displayName: "Owner",
    id: "role-owner",
    isSystem: true,
    label: "Owner",
    name: "owner",
    organizationId: ORGANIZATION_ID,
    rolePermissions: [],
    scope: "organization",
  };
}

function customRole(): RoleRecord {
  return {
    color: null,
    description: null,
    displayName: "Support",
    id: "role-support",
    isSystem: false,
    label: "Support",
    name: "support",
    organizationId: ORGANIZATION_ID,
    rolePermissions: [],
    scope: "organization",
  };
}
