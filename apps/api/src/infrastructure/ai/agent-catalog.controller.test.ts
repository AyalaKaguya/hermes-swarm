import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { AgentCatalogController } from "./agent-catalog.controller.js";

describe("Agent catalog routes", () => {
  it("keeps all Workspace-scoped paths under /api/admin/agents", () => {
    assert.equal(
      Reflect.getMetadata(PATH_METADATA, AgentCatalogController),
      "admin/agents",
    );
    assertRoute("listAgents", "/", RequestMethod.GET);
    assertRoute("createAgent", "/", RequestMethod.POST);
    assertRoute("getAgent", ":agentId", RequestMethod.GET);
    assertRoute("updateAgent", ":agentId", RequestMethod.PATCH);
    assertRoute("getDraft", ":agentId/draft", RequestMethod.GET);
    assertRoute("replaceDraft", ":agentId/draft", RequestMethod.PUT);
    assertRoute("listVersions", ":agentId/versions", RequestMethod.GET);
    assertRoute("publishDraft", ":agentId/versions", RequestMethod.POST);
    assertRoute(
      "getVersion",
      ":agentId/versions/:version",
      RequestMethod.GET,
    );
  });

  it("never accepts a client-selected workspace id in a route", () => {
    const controllerPath = String(
      Reflect.getMetadata(PATH_METADATA, AgentCatalogController),
    );
    const prototype = AgentCatalogController.prototype as unknown as Record<
      string,
      object
    >;
    const routePaths = Object.getOwnPropertyNames(prototype)
      .map((method) => Reflect.getMetadata(PATH_METADATA, prototype[method]!))
      .filter((path): path is string => typeof path === "string");

    assert.doesNotMatch([controllerPath, ...routePaths].join("/"), /workspaceId/);
  });
});

function assertRoute(
  method: string,
  path: string | undefined,
  requestMethod: RequestMethod,
) {
  const handler = (
    AgentCatalogController as unknown as {
      prototype: Record<string, object>;
    }
  ).prototype[method]!;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), path);
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), requestMethod);
}
