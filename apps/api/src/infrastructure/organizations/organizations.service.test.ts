import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
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

  it("continues to replace permissions for custom organization roles", async () => {
    const role = customRole();
    const state = createService({ role });

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

    assert.deepEqual(state.deletedRolePermissionQueries, [{ roleId: role.id }]);
    assert.equal(state.savedRolePermissions.length, 1);
    assert.equal(
      state.savedRolePermissions[0].permission,
      "organization.profile.view:organization",
    );
    assert.equal(result.length, 1);
  });

  it("rejects organization-scoped updates to platform organization controls", async () => {
    const role = customRole();
    const organization = organizationRecord();
    const state = createService({ organization, role });

    await assert.rejects(
      () =>
        state.service.update(orgToken, ORGANIZATION_ID, {
          status: "suspended",
        }),
      ForbiddenException,
    );

    assert.equal(organization.status, "active");
    assert.equal(state.savedOrganizations.length, 0);
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
});

function createService(options: {
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
}) {
  const savedOrganizations: Array<ReturnType<typeof organizationRecord>> = [];
  const savedRoles: RoleRecord[] = [];
  const deletedRoleQueries: unknown[] = [];
  const deletedRolePermissionQueries: unknown[] = [];
  const savedRolePermissions: any[] = [];

  const service = new OrganizationsService(
    {
      async findOne({ where }: any) {
        if (where.id === options.organization?.id) {
          return options.organization;
        }
        return null;
      },
      async save(organization: ReturnType<typeof organizationRecord>) {
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
      async delete(query: unknown) {
        deletedRoleQueries.push(query);
      },
      async findOne({ where }: any) {
        return where.id === options.role.id &&
          where.organizationId === options.role.organizationId &&
          where.scope === options.role.scope
          ? options.role
          : null;
      },
      async save(role: RoleRecord) {
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
    {} as any,
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
    {} as any,
  );

  return {
    deletedRolePermissionQueries,
    deletedRoleQueries,
    savedOrganizations,
    savedRolePermissions,
    savedRoles,
    service,
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
    sessionId: `session-${userId}`,
    userId,
  })}`;
}

function stripBearerToken(value: string) {
  return value.replace(/^Bearer\s+/i, "").trim();
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
