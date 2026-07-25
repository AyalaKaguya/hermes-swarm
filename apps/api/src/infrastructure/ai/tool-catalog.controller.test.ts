import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import {
  PlatformToolCatalogController,
  WorkspaceToolCatalogController,
} from "./tool-catalog.controller.js";

describe("controlled tool gateway routes", () => {
  it("keeps the Platform control-plane routes stable", () => {
    assert.equal(
      Reflect.getMetadata(PATH_METADATA, PlatformToolCatalogController),
      "admin/platform/ai/tools",
    );
    assertRoute(
      PlatformToolCatalogController,
      "listToolDefinitions",
      "/",
      RequestMethod.GET,
    );
    assertRoute(
      PlatformToolCatalogController,
      "createToolVersion",
      ":toolDefinitionId/versions",
      RequestMethod.POST,
    );
    assertRoute(
      PlatformToolCatalogController,
      "updateToolVersionStatus",
      ":toolDefinitionId/versions/:version",
      RequestMethod.PATCH,
    );
    assertRoute(
      PlatformToolCatalogController,
      "updateNetworkPolicy",
      "network-policies/:networkPolicyId",
      RequestMethod.PATCH,
    );
  });

  it("keeps Workspace routing free of a client-selected workspace id", () => {
    assert.equal(
      Reflect.getMetadata(PATH_METADATA, WorkspaceToolCatalogController),
      "admin/workspace/ai/tools",
    );
    assertRoute(
      WorkspaceToolCatalogController,
      "createConnection",
      "connections",
      RequestMethod.POST,
    );
    assertRoute(
      WorkspaceToolCatalogController,
      "rotateConnectionSecret",
      "connections/:connectionId/secret",
      RequestMethod.POST,
    );
    assertRoute(
      WorkspaceToolCatalogController,
      "updateGrant",
      "grants/:grantId",
      RequestMethod.PATCH,
    );
    assertRoute(
      WorkspaceToolCatalogController,
      "bindGrantConnection",
      "grants/:grantId/connection",
      RequestMethod.PUT,
    );
  });
});

function assertRoute(
  controller: Function,
  method: string,
  path: string,
  requestMethod: RequestMethod,
) {
  const handler = (
    controller as unknown as { prototype: Record<string, object> }
  ).prototype[method]!;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), path);
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), requestMethod);
}
