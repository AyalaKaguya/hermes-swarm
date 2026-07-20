import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import {
  ACCESS_OPERATION_METADATA,
  PUBLIC_ACCESS_METADATA,
} from "@hermes-swarm/rbac";
import { PermissionsController } from "@hermes-swarm/rbac";
import { AppModule } from "../app.module.js";

describe("admin route access metadata", () => {
  it("requires every admin handler to explicitly declare access or public behavior", () => {
    const missing: string[] = [];

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
          Reflect.getMetadata(ACCESS_OPERATION_METADATA, controller);
        const publicAccess =
          Reflect.getMetadata(PUBLIC_ACCESS_METADATA, handler) ??
          Reflect.getMetadata(PUBLIC_ACCESS_METADATA, controller);
        if (!operation && !publicAccess?.reason?.trim()) {
          missing.push(`${controller.name}.${methodName}`);
        }
      }
    }

    assert.deepEqual(missing, []);
  });

  it("allows tenant governors to read the role permission catalog", () => {
    const operation = Reflect.getMetadata(
      ACCESS_OPERATION_METADATA,
      PermissionsController.prototype.catalog,
    );

    assert.deepEqual(operation?.defaultRoles, ["tenant-owner", "tenant-admin"]);
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
