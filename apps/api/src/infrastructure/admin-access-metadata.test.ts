import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import {
  ACCESS_OPERATION_METADATA,
  ACCESS_RESOURCE_METADATA,
  PERMISSION_RESOURCE_METADATA,
  PUBLIC_ACCESS_METADATA,
  REQUIRE_PERMISSION_METADATA,
  resolveAccessDefinition,
} from "@hermes-swarm/rbac";
import { PermissionsController } from "@hermes-swarm/rbac";
import { InfrastructureBootstrapController } from "./infrastructure-bootstrap.controller.js";
import { AccountController } from "./users/users.controller.js";

describe("admin route access metadata", () => {
  it("requires every admin handler to explicitly declare access or public behavior", async () => {
    process.env.NODE_ENV = "test";
    process.env.POSTGRES_TEST_URL ??=
      "postgresql://hermes:hermes_dev_pwd@localhost:5432/hermes-test";
    const { AppModule } = await import("../app.module.js");
    const missing: string[] = [];
    const invalid: string[] = [];

    const controllers = collectControllers(AppModule).filter((controller) =>
      String(Reflect.getMetadata(PATH_METADATA, controller) ?? "").startsWith(
        "admin",
      ),
    );
    assert.ok(controllers.length > 0);

    for (const controller of controllers) {
      for (const methodName of Object.getOwnPropertyNames(controller.prototype)) {
        if (methodName === "constructor") continue;
        const handler = controller.prototype[methodName];
        if (
          typeof handler !== "function" ||
          Reflect.getMetadata(METHOD_METADATA, handler) === undefined
        ) {
          continue;
        }

        const operation =
          Reflect.getMetadata(ACCESS_OPERATION_METADATA, handler) ??
          Reflect.getMetadata(ACCESS_OPERATION_METADATA, controller) ??
          Reflect.getMetadata(REQUIRE_PERMISSION_METADATA, handler) ??
          Reflect.getMetadata(REQUIRE_PERMISSION_METADATA, controller);
        const publicAccess =
          Reflect.getMetadata(PUBLIC_ACCESS_METADATA, handler) ??
          Reflect.getMetadata(PUBLIC_ACCESS_METADATA, controller);
        if (!operation && !publicAccess?.reason?.trim()) {
          missing.push(`${controller.name}.${methodName}`);
          continue;
        }
        if (operation) {
          const resource =
            Reflect.getMetadata(ACCESS_RESOURCE_METADATA, handler) ??
            Reflect.getMetadata(ACCESS_RESOURCE_METADATA, controller) ??
            Reflect.getMetadata(PERMISSION_RESOURCE_METADATA, handler) ??
            Reflect.getMetadata(PERMISSION_RESOURCE_METADATA, controller);
          if (!resolveAccessDefinition(resource, operation)) {
            invalid.push(`${controller.name}.${methodName}`);
          }
        }
      }
    }

    assert.deepEqual(missing, []);
    assert.deepEqual(invalid, []);
  });

  it("allows workspace governors to read the role permission catalog", () => {
    const operation = Reflect.getMetadata(
      ACCESS_OPERATION_METADATA,
      PermissionsController.prototype.catalog,
    );

    assert.deepEqual(operation?.defaultRoles, ["workspace-owner", "workspace-admin"]);
  });

  it("guards account reads through the authenticated own-resource scope", () => {
    const operation = Reflect.getMetadata(
      ACCESS_OPERATION_METADATA,
      AccountController.prototype.get,
    );
    const resource = Reflect.getMetadata(
      ACCESS_RESOURCE_METADATA,
      AccountController,
    );
    const definition = resolveAccessDefinition(resource, operation);

    assert.equal(definition?.id, "account.self_profile.get:own");
    assert.deepEqual(definition?.defaultRoles, [
      "workspace-owner",
      "workspace-admin",
      "workspace-member",
    ]);
    assert.equal(
      Reflect.getMetadata(PUBLIC_ACCESS_METADATA, AccountController.prototype.get),
      undefined,
    );
  });

  it("restricts onboarding resume to the platform administrator role", () => {
    const operation = Reflect.getMetadata(
      ACCESS_OPERATION_METADATA,
      InfrastructureBootstrapController.prototype.resume,
    );
    assert.deepEqual(operation?.defaultRoles, ["platform-admin"]);
    assert.equal(operation?.scope, undefined);
  });
});

type NestModuleEntry =
  | Function
  | {
      controllers?: Function[];
      forwardRef?: () => NestModuleEntry;
      imports?: NestModuleEntry[];
      module?: Function;
    };

function collectControllers(root: NestModuleEntry) {
  const controllers = new Set<Function>();
  const visited = new Set<Function>();

  function visit(entry: NestModuleEntry | null | undefined) {
    if (!entry) return;
    if (
      typeof entry === "object" &&
      typeof entry.forwardRef === "function"
    ) {
      visit(entry.forwardRef());
      return;
    }
    const dynamic = typeof entry === "object" ? entry : undefined;
    const moduleType = (dynamic?.module ?? entry) as Function;
    if (typeof moduleType !== "function") return;

    for (const controller of [
      ...((Reflect.getMetadata(
        MODULE_METADATA.CONTROLLERS,
        moduleType,
      ) as Function[] | undefined) ?? []),
      ...(dynamic?.controllers ?? []),
    ]) {
      controllers.add(controller);
    }
    if (visited.has(moduleType) && !dynamic) return;
    visited.add(moduleType);
    const imports = [
      ...((Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        moduleType,
      ) as NestModuleEntry[] | undefined) ?? []),
      ...(dynamic?.imports ?? []),
    ];
    for (const imported of imports) visit(imported);
  }

  visit(root);
  return [...controllers];
}
