import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function toPosix(value) {
  return value.replaceAll(path.sep, "/");
}

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(absolute(relativePath));
}

function read(relativePath) {
  return fs.readFileSync(absolute(relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertIncludes(file, text, message) {
  assert(read(file).includes(text), `${file}: ${message}`);
}

function listFiles(dir, extensions = [".ts", ".tsx", ".json", ".mjs"]) {
  const base = absolute(dir);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(base, entry.name);
    const relative = toPosix(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      if (["dist", "node_modules"].includes(entry.name)) return [];
      return listFiles(relative, extensions);
    }
    return extensions.includes(path.extname(entry.name)) ? [relative] : [];
  });
}

function assertNoPattern(files, pattern, message) {
  for (const file of files) {
    if (pattern.test(read(file))) {
      failures.push(`${file}: ${message}`);
    }
  }
}

const scannedFiles = [
  ...listFiles("apps/api/src"),
  ...listFiles("apps/web/app"),
  ...listFiles("apps/web/components"),
  ...listFiles("apps/web/hooks"),
  ...listFiles("apps/web/lib"),
  ...listFiles("packages/rbac/src"),
  ...listFiles("packages/rbac-api/src"),
  "apps/api/package.json",
  "apps/web/package.json",
  "packages/rbac/package.json",
  "packages/rbac-api/package.json",
  "pnpm-lock.yaml",
];

assert(exists("packages/rbac-api/package.json"), "shared RBAC API package should exist");
assert(exists("packages/rbac/package.json"), "Nest RBAC package should exist");
assert(!exists("packages/access"), "old packages/access directory should be removed");
assert(!exists("packages/nest-access"), "old packages/nest-access directory should be removed");
assert(!exists("apps/api/src/rbac"), "old apps/api/src/rbac directory should be removed");
assert(!exists("apps/api/src/admin"), "infrastructure aggregate should not live in apps/api/src/admin");
assert(
  exists("apps/api/src/infrastructure/infrastructure.module.ts"),
  "API infrastructure aggregate module should exist",
);
assert(
  exists("apps/api/src/domains/domains.module.ts"),
  "API business domain aggregate module should exist",
);
assert(
  exists("apps/web/components/infrastructure-navigation.ts"),
  "web infrastructure navigation should exist",
);
assert(
  exists("apps/web/app/(domains)/README.md"),
  "web business domain route group should exist",
);

const infrastructureRootDirs = [
  "auth",
  "feature-access",
  "files",
  "groups",
  "invite",
  "mail",
  "memberships",
  "notifications",
  "organizations",
  "password-reset",
  "platform-members",
  "platform-roles",
  "settings",
  "users",
];
const allowedApiRootDirs = new Set([
  "common",
  "domains",
  "e2e",
  "infrastructure",
]);
for (const entry of fs.readdirSync(absolute("apps/api/src"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  assert(
    allowedApiRootDirs.has(entry.name),
    `apps/api/src/${entry.name} should be placed under infrastructure or domains instead of the API root`,
  );
}
for (const dir of infrastructureRootDirs) {
  assert(
    !exists(`apps/api/src/${dir}`),
    `infrastructure module ${dir} should live under apps/api/src/infrastructure/${dir}`,
  );
  assert(
    exists(`apps/api/src/infrastructure/${dir}`),
    `infrastructure module apps/api/src/infrastructure/${dir} should exist`,
  );
}
assertNoPattern(
  listFiles("apps/api/src/infrastructure"),
  /from\s+["'][.\/]+domains\//,
  "infrastructure modules must not import business domain modules",
);
assertNoPattern(
  listFiles("apps/api/src/domains"),
  /from\s+["'][.\/]+infrastructure\//,
  "business domain modules should depend on explicit public infrastructure services, not deep infrastructure internals",
);

const rbacApiPackage = readJson("packages/rbac-api/package.json");
assert(rbacApiPackage.name === "@hermes-swarm/rbac-api", "rbac-api package should use the requested name");
assert(!rbacApiPackage.dependencies, "rbac-api should stay framework agnostic");

const rbacPackage = readJson("packages/rbac/package.json");
assert(rbacPackage.name === "@hermes-swarm/rbac", "rbac package should use the requested name");
assert(
  rbacPackage.dependencies?.["@hermes-swarm/rbac-api"] === "workspace:*",
  "rbac should depend on the shared rbac-api package",
);
assert(rbacPackage.dependencies?.["@nestjs/common"], "rbac should own Nest runtime dependencies");
assert(rbacPackage.dependencies?.["@nestjs/core"], "rbac should own Nest core dependencies");

const apiPackage = readJson("apps/api/package.json");
assert(apiPackage.dependencies?.["@hermes-swarm/rbac"] === "workspace:*", "api should depend on @hermes-swarm/rbac");
assert(
  apiPackage.dependencies?.["@hermes-swarm/rbac-api"] === "workspace:*",
  "api should depend on @hermes-swarm/rbac-api for shared types",
);
assert(!apiPackage.dependencies?.["@casl/ability"], "api should not keep the removed CASL dependency");

const webPackage = readJson("apps/web/package.json");
assert(
  webPackage.dependencies?.["@hermes-swarm/rbac-api"] === "workspace:*",
  "web should depend on @hermes-swarm/rbac-api",
);
assert(!webPackage.dependencies?.["@hermes-swarm/rbac"], "web should not depend on the Nest RBAC package");

assertNoPattern(
  scannedFiles,
  /@hermes-swarm\/access|@hermes-swarm\/nest-access|packages\/access|packages\/nest-access|apps\/api\/src\/rbac|@casl\/ability/,
  "old RBAC/access package or CASL reference should not remain",
);

assertNoPattern(
  listFiles("packages/rbac-api/src"),
  /@nestjs\/|typeorm|react|next\//,
  "rbac-api should not import framework-specific runtime dependencies",
);

assertIncludes(
  "packages/rbac-api/src/index.ts",
  './lib/page-access.js',
  "rbac-api should export page access definitions",
);
assertIncludes(
  "packages/rbac-api/src/index.ts",
  './lib/permission-key.js',
  "rbac-api should export permission id helpers",
);
assertIncludes(
  "packages/rbac/src/index.ts",
  './lib/rbac.module.js',
  "rbac should export RbacModule",
);
assertIncludes(
  "packages/rbac/src/index.ts",
  './lib/access.decorators.js',
  "rbac should export access decorators",
);
assertIncludes(
  "packages/rbac/src/lib/rbac.module.ts",
  "APP_GUARD",
  "RbacModule should register the access guard",
);
assertIncludes(
  "packages/rbac/src/lib/access-catalog.service.ts",
  "@hermes-swarm/rbac-api",
  "RBAC catalog should consume shared RBAC API definitions",
);
assertIncludes(
  "packages/rbac/src/lib/access-catalog.service.ts",
  "PAGE_ACCESS_DEFINITIONS",
  "RBAC catalog should sync shared page access definitions",
);
assertIncludes(
  "apps/api/src/app.module.ts",
  'from "@hermes-swarm/rbac"',
  "API app module should import RBAC from the package",
);
assertIncludes(
  "apps/api/src/app.module.ts",
  "RbacModule.register",
  "API app module should register the RBAC package module",
);
assertIncludes(
  "apps/api/src/app.module.ts",
  "./infrastructure/infrastructure.module.js",
  "API app module should import infrastructure aggregate explicitly",
);
assertIncludes(
  "apps/api/src/app.module.ts",
  "./domains/domains.module.js",
  "API app module should import the business domain aggregate explicitly",
);
assertNoPattern(
  ["apps/api/src/app.module.ts"],
  /AdminModule|\.\/admin\//,
  "API app module should not use an admin aggregate module",
);
assertIncludes(
  "apps/web/components/settings-navigation.ts",
  "./infrastructure-navigation",
  "settings navigation should only be a compatibility export over infrastructure navigation",
);

const webFiles = [
  ...listFiles("apps/web/app", [".tsx", ".ts"]),
  ...listFiles("apps/web/components", [".tsx", ".ts"]),
  ...listFiles("apps/web/hooks", [".tsx", ".ts"]),
  ...listFiles("apps/web/lib", [".tsx", ".ts"]),
];
assertNoPattern(
  webFiles,
  /@hermes-swarm\/rbac(?!-api)/,
  "frontend code should only import shared rbac-api, not Nest rbac",
);

const apiControllers = listFiles("apps/api/src", [".ts"]).filter((file) =>
  file.endsWith("controller.ts"),
);
for (const file of apiControllers) {
  const content = read(file);
  assert(
    !content.includes("PermissionOperation") &&
      !content.includes("PermissionResource"),
    `${file}: use AccessOperation/AccessResource instead of legacy permission decorator aliases`,
  );
  if (!content.includes("AccessOperation")) {
    continue;
  }
  assert(
    content.includes('from "@hermes-swarm/rbac"'),
    `${file}: access decorators should come from @hermes-swarm/rbac`,
  );
}

if (failures.length) {
  console.error("Architecture refactor verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Architecture refactor verification passed.");
