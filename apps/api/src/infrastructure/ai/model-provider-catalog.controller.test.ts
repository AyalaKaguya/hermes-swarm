import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import {
  PlatformModelProviderCatalogController,
  WorkspaceModelProviderCatalogController,
} from "./model-provider-catalog.controller.js";

describe("model provider catalog routes", () => {
  it("keeps the platform control-plane routes stable", () => {
    assert.equal(
      Reflect.getMetadata(PATH_METADATA, PlatformModelProviderCatalogController),
      "admin/platform/ai",
    );
    assertRoute(
      PlatformModelProviderCatalogController,
      "listProviders",
      "providers",
      RequestMethod.GET,
    );
    assertRoute(
      PlatformModelProviderCatalogController,
      "rotateProviderSecret",
      "providers/:providerId/secret",
      RequestMethod.POST,
    );
    assertRoute(
      PlatformModelProviderCatalogController,
      "updateDeployment",
      "deployments/:deploymentId",
      RequestMethod.PATCH,
    );
    assertRoute(
      PlatformModelProviderCatalogController,
      "createGrant",
      "workspaces/:workspaceId/grants",
      RequestMethod.POST,
    );
  });

  it("keeps Workspace routing free of a client-selected workspace id", () => {
    assert.equal(
      Reflect.getMetadata(PATH_METADATA, WorkspaceModelProviderCatalogController),
      "admin/workspace/ai",
    );
    assertRoute(
      WorkspaceModelProviderCatalogController,
      "createProvider",
      "providers",
      RequestMethod.POST,
    );
    assertRoute(
      WorkspaceModelProviderCatalogController,
      "updateDeployment",
      "deployments/:deploymentId",
      RequestMethod.PATCH,
    );
    assertRoute(
      WorkspaceModelProviderCatalogController,
      "listGrants",
      "grants",
      RequestMethod.GET,
    );
    assertRoute(
      WorkspaceModelProviderCatalogController,
      "setDefault",
      "defaults",
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
