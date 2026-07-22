import {
  Permission,
  PlatformMembership,
  Role,
  RolePermission,
  Account,
  WorkspaceMembership,
  Workspace,
} from "@hermes-swarm/core";
import type { ResolvedAccessDefinition } from "@hermes-swarm/rbac";
import { DataSource, In, IsNull, type EntityManager } from "typeorm";
import { hashPassword } from "../../security/password-hash.js";
import { buildSeedPermissionCatalog } from "./seed-permission-catalog.js";
import {
  seedDevelopmentFixtures,
  type DevelopmentFixtureCounts,
} from "./development-seed-fixtures.js";

export type DevelopmentSeedConfig = {
  adminDisplayName: string;
  adminEmail: string;
  adminPassword: string;
  workspaceName: string;
  workspaceSlug: string;
};

export type DevelopmentSeedResult = {
  administratorAccountId: string;
  fixtures: DevelopmentFixtureCounts;
  permissionCount: number;
  workspaceId: string;
};

export class DevelopmentSeedService {
  constructor(private readonly dataSource: DataSource) {}

  async run(config: DevelopmentSeedConfig): Promise<DevelopmentSeedResult> {
    const definitions = buildSeedPermissionCatalog();
    const platform = await this.dataSource.transaction((manager) =>
      seedPlatform(manager, config, definitions),
    );
    const workspace = await this.dataSource.transaction((manager) =>
      seedWorkspaceData(
        manager,
        platform.workspace,
        definitions,
        "workspaceOwner",
        platform.admin,
        config.adminPassword,
      ),
    );
    await this.dataSource.transaction((manager) =>
      seedWorkspaceData(
        manager,
        platform.secondaryWorkspace,
        definitions,
        "workspaceAdmin",
        platform.admin,
        config.adminPassword,
      ),
    );
    return {
      administratorAccountId: platform.admin.id,
      fixtures: workspace.fixtures,
      permissionCount: definitions.length,
      workspaceId: platform.workspace.id,
    };
  }
}

async function seedPlatform(
  manager: EntityManager,
  config: DevelopmentSeedConfig,
  definitions: ResolvedAccessDefinition[],
) {
  const permissions = await seedPermissions(manager, definitions);
  let role = await manager.findOne(Role, {
    where: { name: "platform-admin", scope: "platform", workspaceId: IsNull() },
  });
  role ??= manager.create(Role, {
    name: "platform-admin",
    scope: "platform",
    workspaceId: null,
  });
  Object.assign(role, {
    description: "Platform administrator with all platform permissions.",
    isSystem: true,
    label: "Platform Admin",
    displayName: "Platform Admin",
    scope: "platform",
    workspaceId: null,
  });
  role = await manager.save(Role, role);

  let admin = await manager.findOne(Account, {
    where: { email: config.adminEmail },
    withDeleted: true,
  });
  admin ??= manager.create(Account, { email: config.adminEmail });
  Object.assign(admin, {
    deletedAt: null,
    displayName: config.adminDisplayName,
    passwordHash: await hashPassword(config.adminPassword),
    emailVerified: true,
    nickname: config.adminDisplayName,
    preferredLanguage: "zh-Hans",
    status: "active",
    type: "user",
  });
  admin = await manager.save(Account, admin);
  await ensurePlatformMembership(manager, admin.id, role.id);

  await replacePlatformRolePermissions(
    manager,
    role.id,
    permissions
      .filter(
        (permission) =>
          permission.scope === "platform" &&
          permission.defaultRoles?.includes("platform-admin"),
      )
      .map((permission) => permission.id),
  );

  let workspace = await manager.findOne(Workspace, {
    where: { deletedAt: IsNull(), slug: config.workspaceSlug },
  });
  workspace ??= manager.create(Workspace, { slug: config.workspaceSlug });
  Object.assign(workspace, {
    deletedAt: null,
    name: config.workspaceName,
    status: "active",
    subdomain: config.workspaceSlug,
  });
  workspace = await manager.save(Workspace, workspace);
  const secondarySlug = `${config.workspaceSlug}-lab`;
  let secondaryWorkspace = await manager.findOne(Workspace, {
    where: { deletedAt: IsNull(), slug: secondarySlug },
  });
  secondaryWorkspace ??= manager.create(Workspace, { slug: secondarySlug });
  Object.assign(secondaryWorkspace, {
    deletedAt: null,
    name: `${config.workspaceName} Lab`,
    status: "active",
    subdomain: secondarySlug,
  });
  secondaryWorkspace = await manager.save(Workspace, secondaryWorkspace);
  return { admin, secondaryWorkspace, workspace };
}

async function seedPermissions(
  manager: EntityManager,
  definitions: ResolvedAccessDefinition[],
) {
  await manager.upsert(
    Permission,
    definitions.map((definition) =>
      manager.create(Permission, {
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
      }),
    ),
    ["code"],
  );
  return manager.find(Permission, {
    where: { code: In(definitions.map((definition) => definition.id)) },
  });
}

async function seedWorkspaceData(
  manager: EntityManager,
  workspace: Workspace,
  definitions: ResolvedAccessDefinition[],
  ownerRole: "workspaceAdmin" | "workspaceOwner",
  owner: Account,
  fixturePassword: string,
) {
  const visibleWorkspace = await manager.findOne(Workspace, {
    where: { id: workspace.id },
  });
  if (!visibleWorkspace) {
    throw new Error("Seed workspace is not visible in workspace context");
  }

  const roles = {
    workspaceAdmin: await ensureRole(manager, workspace.id, {
      description: "Workspace administrator with governance access.",
      label: "Workspace Admin",
      name: "workspace-admin",
    }),
    workspaceMember: await ensureRole(manager, workspace.id, {
      description: "Workspace member with standard access.",
      label: "Workspace Member",
      name: "workspace-member",
    }),
    workspaceOwner: await ensureRole(manager, workspace.id, {
      description: "Workspace owner with full governance access.",
      label: "Workspace Owner",
      name: "workspace-owner",
    }),
  };

  const permissions = await manager.find(Permission);
  for (const [roleName, role] of Object.entries(roles)) {
    await seedRolePermissions(manager, role, permissions, definitions, roleName);
  }
  await ensureWorkspaceRoleAssignment(
    manager,
    workspace.id,
    owner.id,
    roles[ownerRole].id,
  );

  const fixtures = await seedDevelopmentFixtures({
    manager,
    owner,
    ownerPassword: fixturePassword,
    roles,
    workspaceId: workspace.id,
  });
  return { fixtures: fixtures.counts, owner };
}

async function ensureRole(
  manager: EntityManager,
  workspaceId: string,
  input: { description: string; label: string; name: string },
) {
  let role = await manager.findOne(Role, {
    where: { name: input.name, workspaceId },
  });
  role ??= manager.create(Role, {
    name: input.name,
    scope: "workspace",
    workspaceId,
  });
  Object.assign(role, {
    color: "#7c3aed",
    description: input.description,
    displayName: input.label,
    isSystem: true,
    label: input.label,
    scope: "workspace",
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
  await manager.delete(RolePermission, {
    roleId: role.id,
  });
  const grants = permissions.flatMap((permission) => {
    if (!permission.code) return [];
    const definition = definitionsById.get(permission.code);
    if (
      !["workspace", "own"].includes(permission.scope) ||
      (defaultRole !== "workspaceOwner" &&
        !definition?.defaultRoles.includes(kebabRoleName(defaultRole)))
    ) {
      return [];
    }
    return [
      manager.create(RolePermission, {
        enabled: true,
        permissionId: permission.id,
        roleId: role.id,
      }),
    ];
  });
  if (grants.length > 0) {
    await manager.insert(RolePermission, grants);
  }
}

function kebabRoleName(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

async function ensurePlatformMembership(
  manager: EntityManager,
  accountId: string,
  roleId: string,
) {
  await manager.upsert(
    PlatformMembership,
    manager.create(PlatformMembership, {
      accountId,
      removedAt: null,
      roleId,
      status: "active",
    }),
    ["accountId"],
  );
}

async function replacePlatformRolePermissions(
  manager: EntityManager,
  roleId: string,
  permissionIds: string[],
) {
  await manager.delete(RolePermission, { roleId });
  if (permissionIds.length === 0) return;
  await manager.insert(
    RolePermission,
    permissionIds.map((permissionId) =>
      manager.create(RolePermission, {
        enabled: true,
        permissionId,
        roleId,
      }),
    ),
  );
}

async function ensureWorkspaceRoleAssignment(
  manager: EntityManager,
  workspaceId: string,
  userId: string,
  roleId: string,
) {
  await manager.upsert(
    WorkspaceMembership,
    {
      accountId: userId,
      removedAt: null,
      roleId,
      status: "active",
      workspaceId,
    },
    ["workspaceId", "accountId"],
  );
}
