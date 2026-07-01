import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertIncludes(file, text, message) {
  assert(read(file).includes(text), `${file}: ${message}`);
}

function assertNotIncludes(file, text, message) {
  assert(!read(file).includes(text), `${file}: ${message}`);
}

function listFiles(dir, extensions = [".ts", ".tsx", ".json"]) {
  const absoluteDir = path.join(root, dir);
  if (!fs.existsSync(absoluteDir)) return [];
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(absoluteDir, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") return [];
      return listFiles(relative, extensions);
    }
    return extensions.includes(path.extname(entry.name)) ? [relative] : [];
  });
}

function assertNoPattern(files, pattern, message, allow = () => false) {
  for (const file of files) {
    if (allow(file)) continue;
    const content = read(file);
    if (pattern.test(content)) {
      failures.push(`${file}: ${message}`);
    }
  }
}

const sourceFiles = [
  ...listFiles("apps/api/src"),
  ...listFiles("apps/web/app"),
  ...listFiles("apps/web/components"),
  ...listFiles("apps/web/lib"),
  ...listFiles("packages/core/src"),
  "packages/core/package.json",
];

assert(exists("packages/core/src/identity/entities/user.entity.ts"), "identity user entity should exist");
assert(!exists("packages/core/src/tenancy"), "old core tenancy folder should be removed");
assert(!exists("apps/api/src/tenancy"), "old API tenancy folder should be removed");
assert(!exists("apps/web/app/settings/menus/page.tsx"), "old menu settings page should be removed");
assert(!exists("apps/web/app/settings/tenant/page.tsx"), "old tenant settings route should be removed");
assert(exists("apps/web/app/settings/platform/page.tsx"), "platform settings route should exist");

assertNoPattern(
  sourceFiles,
  /\btenancy\b|TENANCY|Tenancy|settings\/tenant|租户|tenant_title|legacyKeys|DEFAULT_ADMIN_MENUS|\bGroupDto\b|TagsModule|tag\.entity|menu\.entity/,
  "old tenancy/menu/tag terminology should not remain",
);
assert(!exists("packages/core/src/identity/entities/group.entity.ts"), "old generic group entity should not exist");

const userEntity = read("packages/core/src/identity/entities/user.entity.ts");
assert(userEntity.includes('@Entity({ name: "users" })'), "users table entity should be global");
assert(userEntity.includes("passwordHash"), "users table should store password hash");
assert(userEntity.includes("nickname"), "users table should store nickname");
assert(!/organizationId|roleId/.test(userEntity), "users table should not store organizationId or roleId");

assertIncludes(
  "packages/core/src/identity/entities/organization.entity.ts",
  '@Entity({ name: "organizations" })',
  "organizations table entity should exist",
);
assertIncludes(
  "packages/core/src/identity/entities/organization.entity.ts",
  "createdByUserId",
  "organizations should store creator user id",
);
assertIncludes(
  "packages/core/src/identity/entities/organization.entity.ts",
  "website",
  "organizations should store website",
);

const membershipEntity = read("packages/core/src/identity/entities/user-organization.entity.ts");
assert(membershipEntity.includes('@Entity({ name: "user_organizations" })'), "user_organizations table should exist");
assert(membershipEntity.includes('name: "role_id"'), "membership should store role id");
assert(membershipEntity.includes('name: "display_name"'), "membership should store display name");
assert(membershipEntity.includes('@Index(["userId", "organizationId"], { unique: true })'), "membership should be unique per user and organization");

const roleEntity = read("packages/core/src/identity/entities/role.entity.ts");
assert(roleEntity.includes('@Entity({ name: "roles" })'), "roles table should exist");
for (const field of ["displayName", "color", "description", "scope", "organizationId"]) {
  assert(roleEntity.includes(field), `roles should include ${field}`);
}

const permissionEntity = read("packages/core/src/identity/entities/permission.entity.ts");
assert(permissionEntity.includes('@Entity({ name: "permissions" })'), "permissions table should exist");
for (const field of ["entity", "action", "scope"]) {
  assert(permissionEntity.includes(field), `permissions should include ${field}`);
}
assert(permissionEntity.includes('"create" | "read" | "update" | "delete"'), "permissions should model CRUD actions");
assert(permissionEntity.includes('"platform" | "organization" | "own"'), "permissions should model platform/organization/own scope");

assertIncludes(
  "packages/core/src/identity/entities/platform-member.entity.ts",
  '@Entity({ name: "platform_members" })',
  "platform_members table should exist",
);
assertIncludes(
  "packages/core/src/identity/entities/role-permission.entity.ts",
  '@Entity({ name: "role_permissions" })',
  "role_permissions table should exist",
);
assertIncludes(
  "packages/core/src/settings/entities/platform-setting.entity.ts",
  '@Entity({ name: "platform_settings" })',
  "platform_settings table should exist",
);
assertIncludes(
  "packages/core/src/identity/entities/organization-setting.entity.ts",
  '@Entity({ name: "organization_settings" })',
  "organization_settings table should exist",
);
assertIncludes(
  "packages/core/src/identity/entities/organization-group.entity.ts",
  '@Entity({ name: "organization_groups" })',
  "organization_groups table should exist",
);
assertIncludes(
  "packages/core/src/identity/entities/organization-group-member.entity.ts",
  '@Entity({ name: "organization_group_members" })',
  "organization_group_members table should exist",
);
assert(
  !exists("packages/core/src/identity/entities/organization-feature-group-access.entity.ts"),
  "organization feature group access table should not exist",
);
assertIncludes(
  "packages/core/src/identity/permissions.ts",
  '"group:create:organization"',
  "organization group create permission should exist",
);
assertIncludes(
  "packages/core/src/identity/permissions.ts",
  '"group:update:organization"',
  "organization group update permission should exist",
);

const corePackage = JSON.parse(read("packages/core/package.json"));
assert(corePackage.exports?.["./identity"], "core should export identity subpath");
assert(corePackage.exports?.["./identity/permissions"], "core should export identity permissions subpath");
assert(!corePackage.exports?.["./tenancy"], "core should not export old tenancy subpath");

const rbacService = read("apps/api/src/rbac/rbac.service.ts");
assert(rbacService.includes("@casl/ability") || read("apps/api/src/rbac/rbac-ability.ts").includes("@casl/ability"), "RBAC should use CASL");
assert(rbacService.includes("findOrganizationRoleId"), "RBAC should resolve organization membership roles");
assert(rbacService.includes("findPlatformRoleId"), "RBAC should resolve platform member roles");
assert(rbacService.includes("ensurePermissionCatalog"), "RBAC should initialize permission catalog");

const controllers = listFiles("apps/api/src").filter((file) => file.endsWith("controller.ts"));
for (const file of controllers) {
  const content = read(file);
  if (
    !content.includes('@Controller("admin') ||
    file.includes("auth") ||
    file.includes("admin.controller.ts") ||
    file.includes("files.controller.ts") ||
    file.includes("password-reset.controller.ts")
  ) {
    continue;
  }
  const handlerCount = (content.match(/@(Get|Post|Patch|Put|Delete)\(/g) ?? []).length;
  const publicInviteHandlerCount = file.includes("invite.controller.ts") ? 2 : 0;
  const permissionCount = (content.match(/@RequirePermission\(/g) ?? []).length;
  assert(
    permissionCount >= handlerCount - publicInviteHandlerCount,
    `${file}: admin business handlers should have @RequirePermission decorators`,
  );
}

assertIncludes(
  "apps/api/src/settings/settings.service.ts",
  "getPlatformValue",
  "settings service should expose platform reads",
);
assertIncludes(
  "apps/api/src/settings/settings.service.ts",
  "getOrganizationValue",
  "settings service should expose organization reads",
);
assertIncludes(
  "apps/api/src/settings/settings.service.ts",
  "settings:invalidate",
  "settings service should publish Redis invalidation events",
);
assertIncludes(
  "apps/api/src/settings/settings.service.ts",
  "this.redisClientPromise = null",
  "settings service should retry Redis after failed connection",
);
assertIncludes(
  "apps/api/src/organizations/organizations.service.ts",
  "PLATFORM_SETTING_KEYS.allowOrganizationCreation",
  "organization creation should honor platform setting",
);
assertIncludes(
  "apps/api/src/groups/groups.controller.ts",
  '@Get("groups")',
  "groups controller should expose organization group list",
);
assertNotIncludes(
  "apps/api/src/groups/groups.controller.ts",
  '@Put("feature-access")',
  "groups controller should not expose feature access replacement",
);
assertIncludes(
  "apps/api/src/feature-access/feature-access.guard.ts",
  "isFeatureEnabled",
  "feature access guard should enforce organization feature switches",
);
assertNotIncludes(
  "apps/api/src/feature-access/feature-access.guard.ts",
  "isFeatureEnabledForUser",
  "feature access guard should not enforce feature group access",
);
assertIncludes(
  "apps/api/src/invite/invite.controller.ts",
  '@RequireFeature("feature:invite:enabled")',
  "invite endpoints should require invite feature switch",
);
assertIncludes(
  "apps/api/src/mail/mail.controller.ts",
  '@RequireFeature("feature:email:enabled")',
  "mail endpoints should require email feature switch",
);

assertIncludes(
  "apps/api/src/invite/invite.service.ts",
  "UserOrganization",
  "invite acceptance should create organization membership",
);

const permissionsModule = await import("../packages/core/dist/identity/permissions.js");
const defaultPermissionKeySet = new Set(permissionsModule.DEFAULT_PERMISSION_KEYS);
const decoratorPattern =
  /@RequirePermission\(\{\s*action:\s*"([^"]+)",\s*entity:\s*"([^"]+)",\s*scope:\s*"([^"]+)"\s*\}\)/gs;
for (const file of controllers) {
  const content = read(file);
  for (const [, action, entity, scope] of content.matchAll(decoratorPattern)) {
    const key = `${entity}:${action}:${scope}`;
    assert(
      defaultPermissionKeySet.has(key),
      `${file}: permission ${key} should exist in DEFAULT_PERMISSION_KEYS`,
    );
  }
}

assertIncludes(
  "apps/api/src/mail/mail.module.ts",
  "CustomSmtp",
  "mail SMTP module should be retained",
);
assertIncludes(
  "apps/api/src/mail/mail.module.ts",
  "EmailTemplate",
  "mail templates should be retained",
);
assertIncludes(
  "apps/api/src/notifications/notifications.module.ts",
  "NotificationDestination",
  "notification destinations should be retained",
);

assertIncludes(
  "apps/web/lib/session.ts",
  "platformMembership",
  "frontend session should expose platform membership",
);
assertIncludes(
  "apps/web/components/admin-shell.tsx",
  "memberships",
  "frontend session should expose memberships",
);
assertIncludes(
  "apps/web/app/settings/roles/page.tsx",
  "createOrganizationRole",
  "role UI should create roles",
);
assertIncludes(
  "apps/web/app/settings/roles/page.tsx",
  "replaceOrganizationRolePermissions",
  "role UI should save CRUD matrix",
);
assertIncludes(
  "apps/web/app/settings/organizations/[orgId]/page.tsx",
  "listOrganizationMembers",
  "organization UI should list memberships",
);
assertIncludes(
  "apps/web/app/settings/groups/page.tsx",
  "replaceOrganizationGroupMembers",
  "group UI should manage organization group members",
);
assertIncludes(
  "apps/web/app/settings/features/page.tsx",
  "saveOrganizationSettings",
  "feature UI should save organization feature switches",
);
assertNotIncludes(
  "apps/web/app/settings/features/page.tsx",
  "replaceOrganizationFeatureAccess",
  "feature UI should not manage group access allow-list",
);
assertIncludes(
  "apps/web/components/settings-navigation.ts",
  'key: "groups"',
  "settings navigation should include organization groups",
);
assertIncludes(
  "apps/web/lib/session.ts",
  'groups: { entity: "group", scope: "organization" }',
  "frontend menu access should map groups to group organization permissions",
);

const { buildRbacAbility, toRbacSubject } = await import("../apps/api/dist/rbac/rbac-ability.js");
const ability = buildRbacAbility([
  { action: "read", entity: "user", scope: "organization" },
]);
assert(ability.can("read", toRbacSubject("user", "organization")), "CASL ability should allow granted CRUD permission");
assert(!ability.can("update", toRbacSubject("user", "organization")), "CASL ability should reject missing CRUD action");
assert(!ability.can("read", toRbacSubject("user", "platform")), "CASL ability should reject wrong scope");

const { RbacService } = await import("../apps/api/dist/rbac/rbac.service.js");
const rolePermissionsByRole = new Map([
  ["platform-admin-role", [
    { enabled: true, permission: "organization:create:platform", roleId: "platform-admin-role" },
    { enabled: true, permission: "user:update:organization", roleId: "platform-admin-role" },
  ]],
  ["org-reader-role", [
    { enabled: true, permission: "user:read:organization", roleId: "org-reader-role" },
  ]],
]);
const rbac = new RbacService(
  {
    findOne: async ({ where }) =>
      where.userId === "platform-admin"
        ? { roleId: "platform-admin-role", status: "active", userId: where.userId }
        : null,
  },
  {
    findOne: async ({ where }) =>
      where.userId === "org-reader" && where.organizationId === "org-a"
        ? {
            organizationId: "org-a",
            roleId: "org-reader-role",
            status: "active",
            userId: "org-reader",
          }
        : null,
  },
  {
    find: async ({ where }) => rolePermissionsByRole.get(where.roleId) ?? [],
  },
  {
    findOne: async () => null,
    create: (value) => value,
    save: async (value) => value,
  },
);
assert(
  !(await rbac.can("ordinary-user", {
    action: "create",
    entity: "organization",
    scope: "platform",
  })),
  "ordinary users without platform membership should not create organizations",
);
assert(
  await rbac.can("platform-admin", {
    action: "create",
    entity: "organization",
    scope: "platform",
  }),
  "platform members with organization:create:platform should create organizations",
);
assert(
  await rbac.can(
    "org-reader",
    { action: "read", entity: "user", scope: "organization" },
    "org-a",
  ),
  "organization members should use their organization-scoped role",
);
assert(
  !(await rbac.can(
    "org-reader",
    { action: "read", entity: "user", scope: "organization" },
    "org-b",
  )),
  "organization members should not access another organization scope",
);
assert(
  !(await rbac.can(
    "org-reader",
    { action: "update", entity: "user", scope: "organization" },
    "org-a",
  )),
  "CRUD actions should be enforced independently",
);
assert(
  await rbac.can(
    "platform-admin",
    { action: "update", entity: "user", scope: "organization" },
    "org-b",
  ),
  "platform role should be able to authorize organization-scoped administration",
);

const settingsDefinitions = await import("../packages/core/dist/settings/definitions.js");
assert(
  settingsDefinitions.resolveSettingValueType("api.secret.key", "string") === "secret",
  "setting definitions should infer secret value type from key",
);
assert(
  settingsDefinitions.resolveSettingValueType("feature:org-management:enabled", "string") === "boolean",
  "feature definitions should resolve boolean value type",
);

const { normalizeSettingEntry } = await import("../apps/api/dist/settings/settings-value-normalizer.js");
assert(
  normalizeSettingEntry({
    name: "feature:invite:enabled",
    value: true,
    valueType: "boolean",
  }).value === "true",
  "boolean setting values should serialize to true/false strings",
);
assert(
  normalizeSettingEntry({
    name: "custom.number",
    value: "42.5",
    valueType: "number",
  }).value === "42.5",
  "number setting values should serialize as normalized numeric strings",
);
assert(
  normalizeSettingEntry({
    name: "custom.json",
    value: { enabled: true },
    valueType: "json",
  }).value === "{\"enabled\":true}",
  "json setting values should serialize as canonical JSON strings",
);
assert(
  normalizeSettingEntry({
    name: "custom.enum",
    value: "a",
    valueOptions: [{ label: "A", value: "a" }],
    valueType: "enum",
  }).value === "a",
  "enum setting values should be constrained to declared options",
);
assert(
  normalizeSettingEntry(
    {
      name: "custom.secret",
      value: "********",
      valueType: "secret",
    },
    [{ value: "existing-secret", valueType: "secret" }],
  ).value === "existing-secret",
  "secret setting mask should preserve existing secret values",
);

if (failures.length) {
  console.error("Refactor verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Refactor verification passed.");
