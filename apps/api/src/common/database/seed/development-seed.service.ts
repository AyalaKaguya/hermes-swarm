import {
  Organization,
  Permission,
  PlatformRole,
  PlatformRolePermission,
  PlatformUser,
  PlatformUserRole,
  Role,
  RolePermission,
  Tenant,
  User,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import type { ResolvedAccessDefinition } from "@hermes-swarm/rbac";
import { DataSource, IsNull, type EntityManager } from "typeorm";
import { hashPassword } from "../../security/password-hash.js";
import { TenantContextService } from "../tenant-context.service.js";
import { TENANT_DATABASE_GUCS } from "../tenant-database.constants.js";
import { buildSeedPermissionCatalog } from "./seed-permission-catalog.js";
import {
  seedDevelopmentFixtures,
  type DevelopmentFixtureCounts,
} from "./development-seed-fixtures.js";

export type DevelopmentSeedConfig = {
  organizationName: string;
  organizationSlug: string;
  ownerDisplayName: string;
  ownerEmail: string;
  ownerPassword: string;
  platformAdminDisplayName: string;
  platformAdminEmail: string;
  platformAdminPassword: string;
  tenantName: string;
  tenantSlug: string;
};

export type DevelopmentSeedResult = {
  fixtures: DevelopmentFixtureCounts;
  organizationId: string;
  ownerUserId: string;
  permissionCount: number;
  platformAdminId: string;
  tenantId: string;
};

export class DevelopmentSeedService {
  constructor(
    private readonly platformDataSource: DataSource,
    private readonly tenantDataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  async run(config: DevelopmentSeedConfig): Promise<DevelopmentSeedResult> {
    const definitions = buildSeedPermissionCatalog();
    const platform = await this.platformDataSource.transaction((manager) =>
      seedPlatform(manager, config, definitions),
    );
    const tenant = await this.tenantDataSource.transaction(async (manager) => {
      await configureSeedTenantContext(manager, platform.tenant.id);
      return this.tenantContext.run(
        {
          manager,
          organizationId: null,
          scopeLevel: "tenant",
          tenantId: platform.tenant.id,
        },
        () => seedTenantData(manager, platform.tenant, config, definitions),
      );
    });
    return {
      fixtures: tenant.fixtures,
      organizationId: tenant.organization.id,
      ownerUserId: tenant.owner.id,
      permissionCount: definitions.length,
      platformAdminId: platform.admin.id,
      tenantId: platform.tenant.id,
    };
  }
}

async function seedPlatform(
  manager: EntityManager,
  config: DevelopmentSeedConfig,
  definitions: ResolvedAccessDefinition[],
) {
  const permissions = await seedPermissions(manager, definitions);
  let role = await manager.findOne(PlatformRole, {
    where: { name: "platform-admin" },
  });
  role ??= manager.create(PlatformRole, { name: "platform-admin" });
  Object.assign(role, {
    description: "Platform administrator with all platform permissions.",
    isSystem: true,
    label: "Platform Admin",
  });
  role = await manager.save(PlatformRole, role);

  let admin = await manager.findOne(PlatformUser, {
    where: { email: config.platformAdminEmail },
    withDeleted: true,
  });
  admin ??= manager.create(PlatformUser, { email: config.platformAdminEmail });
  Object.assign(admin, {
    deletedAt: null,
    displayName: config.platformAdminDisplayName,
    passwordHash: hashPassword(config.platformAdminPassword),
    preferredLanguage: "zh-CN",
    status: "active",
  });
  admin = await manager.save(PlatformUser, admin);
  await ensurePlatformUserRole(manager, admin.id, role.id);

  const platformPermissions = permissions.filter(
    (permission) =>
      permission.scope === "platform" &&
      permission.defaultRoles?.includes("platform-admin"),
  );
  for (const permission of platformPermissions) {
    await ensurePlatformRolePermission(manager, role.id, permission.id);
  }

  let tenant = await manager.findOne(Tenant, {
    where: { deletedAt: IsNull(), slug: config.tenantSlug },
  });
  tenant ??= manager.create(Tenant, { slug: config.tenantSlug });
  Object.assign(tenant, {
    deletedAt: null,
    name: config.tenantName,
    status: "active",
    subdomain: config.tenantSlug,
  });
  tenant = await manager.save(Tenant, tenant);
  return { admin, tenant };
}

async function seedPermissions(
  manager: EntityManager,
  definitions: ResolvedAccessDefinition[],
) {
  const permissions: Permission[] = [];
  for (const definition of definitions) {
    let permission = await manager.findOne(Permission, {
      where: { code: definition.id },
    });
    permission ??= manager.create(Permission, { code: definition.id });
    Object.assign(permission, {
      action: definition.source === "navigation" ? "access" : definition.operation,
      code: definition.id,
      defaultRoles: definition.defaultRoles,
      description: definition.description,
      entity: definition.entity,
      entityLabel: definition.entityLabel,
      entityOrder: definition.entityOrder ?? null,
      isDangerous: definition.isDangerous,
      operation: definition.operation,
      operationLabel: definition.operationLabel,
      operationOrder: definition.operationOrder,
      purpose: definition.purpose,
      purposeLabel: definition.purposeLabel,
      purposeOrder: definition.purposeOrder ?? null,
      scope: definition.scope,
      source: definition.source ?? "controller",
    });
    permissions.push(await manager.save(Permission, permission));
  }
  return permissions;
}

async function seedTenantData(
  manager: EntityManager,
  tenant: Tenant,
  config: DevelopmentSeedConfig,
  definitions: ResolvedAccessDefinition[],
) {
  const current = await manager.findOne(Tenant, { where: { id: tenant.id } });
  if (!current) throw new Error("Seed tenant is not visible in tenant context");

  let owner = await manager.findOne(User, {
    where: { email: config.ownerEmail, tenantId: tenant.id },
    withDeleted: true,
  });
  owner ??= manager.create(User, {
    email: config.ownerEmail,
    tenantId: tenant.id,
  });
  Object.assign(owner, {
    deletedAt: null,
    displayName: config.ownerDisplayName,
    emailVerified: true,
    nickname: config.ownerDisplayName,
    passwordHash: hashPassword(config.ownerPassword),
    preferredLanguage: "zh-CN",
    status: "active",
    type: "user",
  });
  owner = await manager.save(User, owner);

  let organization = await manager.findOne(Organization, {
    where: {
      deletedAt: IsNull(),
      slug: config.organizationSlug,
      tenantId: tenant.id,
    },
  });
  organization ??= manager.create(Organization, {
    slug: config.organizationSlug,
    tenantId: tenant.id,
  });
  Object.assign(organization, {
    createdByUserId: owner.id,
    deletedAt: null,
    name: config.organizationName,
    parentOrganizationId: null,
    status: "active",
  });
  organization = await manager.save(Organization, organization);

  const tenantOwnerRole = await ensureRole(manager, {
    description: "Tenant owner with tenant governance access.",
    label: "Tenant Owner",
    name: "tenant-owner",
    scope: "tenant",
    organizationId: null,
    tenantId: tenant.id,
  });
  const organizationOwnerRole = await ensureRole(manager, {
    description: "Organization owner with administration access.",
    label: "Owner",
    name: "owner",
    scope: "organization",
    organizationId: organization.id,
    tenantId: tenant.id,
  });
  const tenantAdminRole = await ensureRole(manager, {
    description: "Tenant administrator with tenant governance access.",
    label: "Tenant Admin",
    name: "tenant-admin",
    scope: "tenant",
    organizationId: null,
    tenantId: tenant.id,
  });
  const tenantMemberRole = await ensureRole(manager, {
    description: "Tenant member with standard tenant access.",
    label: "Tenant Member",
    name: "tenant-member",
    scope: "tenant",
    organizationId: null,
    tenantId: tenant.id,
  });
  const organizationAdminRole = await ensureRole(manager, {
    description: "Organization administrator for membership and settings.",
    label: "Admin",
    name: "admin",
    scope: "organization",
    organizationId: organization.id,
    tenantId: tenant.id,
  });
  const organizationMemberRole = await ensureRole(manager, {
    description: "Organization member with standard business access.",
    label: "Member",
    name: "member",
    scope: "organization",
    organizationId: organization.id,
    tenantId: tenant.id,
  });
  const organizationViewerRole = await ensureRole(manager, {
    description: "Organization viewer with read-oriented access.",
    label: "Viewer",
    name: "viewer",
    scope: "organization",
    organizationId: organization.id,
    tenantId: tenant.id,
  });

  let membership = await manager.findOne(UserOrganization, {
    where: {
      organizationId: organization.id,
      tenantId: tenant.id,
      userId: owner.id,
    },
  });
  membership ??= manager.create(UserOrganization, {
    organizationId: organization.id,
    tenantId: tenant.id,
    userId: owner.id,
  });
  Object.assign(membership, {
    displayName: owner.displayName,
    isDefault: true,
    joinedAt: membership.joinedAt ?? new Date(),
    status: "active",
  });
  membership = await manager.save(UserOrganization, membership);
  await ensureTenantRoleAssignment(manager, tenant.id, owner.id, tenantOwnerRole.id);
  await ensureOrganizationRoleAssignment(
    manager,
    tenant.id,
    organization.id,
    membership.id,
    organizationOwnerRole.id,
  );

  const permissions = await manager.find(Permission);
  await seedRolePermissions(
    manager,
    tenantOwnerRole,
    permissions,
    definitions,
    "tenant-owner",
  );
  await seedRolePermissions(
    manager,
    organizationOwnerRole,
    permissions,
    definitions,
    "owner",
  );
  const fixtureRoles = [
    [tenantAdminRole, "tenant-admin"],
    [tenantMemberRole, "tenant-member"],
    [organizationAdminRole, "admin"],
    [organizationMemberRole, "member"],
    [organizationViewerRole, "viewer"],
  ] as const;
  for (const [role, defaultRole] of fixtureRoles) {
    await seedRolePermissions(
      manager,
      role,
      permissions,
      definitions,
      defaultRole,
    );
  }
  const fixtures = await seedDevelopmentFixtures({
    manager,
    organization,
    owner,
    ownerPassword: config.ownerPassword,
    roles: {
      organizationAdmin: organizationAdminRole,
      organizationMember: organizationMemberRole,
      organizationOwner: organizationOwnerRole,
      organizationViewer: organizationViewerRole,
      tenantAdmin: tenantAdminRole,
      tenantMember: tenantMemberRole,
      tenantOwner: tenantOwnerRole,
    },
    tenantId: tenant.id,
  });
  return { fixtures: fixtures.counts, organization, owner };
}

async function ensureRole(
  manager: EntityManager,
  input: {
    description: string;
    label: string;
    name: string;
    organizationId: string | null;
    scope: "organization" | "tenant";
    tenantId: string;
  },
) {
  let role = await manager.findOne(Role, {
    where: {
      name: input.name,
      organizationId: input.organizationId ?? IsNull(),
      scope: input.scope,
      tenantId: input.tenantId,
    },
  });
  role ??= manager.create(Role, input);
  Object.assign(role, {
    color: input.scope === "tenant" ? "#7c3aed" : "#2563eb",
    description: input.description,
    displayName: input.label,
    isSystem: true,
    label: input.label,
    organizationId: input.organizationId,
  });
  return manager.save(Role, role);
}

async function seedRolePermissions(
  manager: EntityManager,
  role: Role,
  permissions: Permission[],
  definitions: ResolvedAccessDefinition[],
  defaultRole: string,
) {
  const definitionsById = new Map(definitions.map((item) => [item.id, item]));
  const allowedScopes =
    role.scope === "tenant"
      ? new Set(["tenant", "own"])
      : new Set(["organization"]);
  await manager.delete(RolePermission, {
    roleId: role.id,
    tenantId: role.tenantId,
  });
  for (const permission of permissions) {
    const definition = permission.code
      ? definitionsById.get(permission.code)
      : undefined;
    if (
      !permission.code ||
      !allowedScopes.has(permission.scope) ||
      (defaultRole !== "tenant-owner" &&
        !definition?.defaultRoles.includes(defaultRole))
    ) {
      continue;
    }
    const row = manager.create(RolePermission, {
      permission: permission.code,
      roleId: role.id,
      tenantId: role.tenantId,
    });
    Object.assign(row, {
      enabled: true,
      permissionId: permission.id,
    });
    await manager.save(RolePermission, row);
  }
}

async function ensurePlatformUserRole(
  manager: EntityManager,
  platformUserId: string,
  platformRoleId: string,
) {
  const existing = await manager.findOne(PlatformUserRole, {
    where: { platformRoleId, platformUserId },
  });
  if (!existing) {
    await manager.save(
      PlatformUserRole,
      manager.create(PlatformUserRole, { platformRoleId, platformUserId }),
    );
  }
}

async function ensurePlatformRolePermission(
  manager: EntityManager,
  platformRoleId: string,
  permissionId: string,
) {
  let existing = await manager.findOne(PlatformRolePermission, {
    where: { permissionId, platformRoleId },
  });
  existing ??= manager.create(PlatformRolePermission, {
    permissionId,
    platformRoleId,
  });
  existing.enabled = true;
  await manager.save(PlatformRolePermission, existing);
}

async function ensureTenantRoleAssignment(
  manager: EntityManager,
  tenantId: string,
  userId: string,
  roleId: string,
) {
  await manager.delete(UserTenantRole, { tenantId, userId });
  await manager.save(
    UserTenantRole,
    manager.create(UserTenantRole, { roleId, tenantId, userId }),
  );
}

async function ensureOrganizationRoleAssignment(
  manager: EntityManager,
  tenantId: string,
  organizationId: string,
  membershipId: string,
  roleId: string,
) {
  await manager.delete(UserOrganizationRole, { membershipId, tenantId });
  await manager.save(
    UserOrganizationRole,
    manager.create(UserOrganizationRole, {
      membershipId,
      organizationId,
      roleId,
      tenantId,
    }),
  );
}

async function configureSeedTenantContext(
  manager: EntityManager,
  tenantId: string,
) {
  await manager.query(
    `SELECT
      set_config('${TENANT_DATABASE_GUCS.tenantId}', $1, true),
      set_config('${TENANT_DATABASE_GUCS.scopeLevel}', 'tenant', true),
      set_config('${TENANT_DATABASE_GUCS.organizationId}', '', true)`,
    [tenantId],
  );
}
