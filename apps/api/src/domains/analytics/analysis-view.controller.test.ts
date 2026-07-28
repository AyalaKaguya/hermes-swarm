import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import {
  ANALYSIS_VIEW_CREATE_PERMISSION,
  ANALYSIS_VIEW_DELETE_PERMISSION,
  ANALYSIS_VIEW_LIST_PERMISSION,
  ANALYSIS_VIEW_READ_PERMISSION,
  ANALYSIS_VIEW_UPDATE_PERMISSION,
} from "./analysis-view.constants.js";
import { AnalysisViewController } from "./analysis-view.controller.js";
import { SUPPORT_TICKETS_QUERY_PERMISSION } from "./support-tickets-analytics.constants.js";

describe("AnalysisViewController", () => {
  it("keeps saved-view routes free of a client-selected workspace id", () => {
    assert.equal(
      Reflect.getMetadata(PATH_METADATA, AnalysisViewController),
      "admin/analytics/views",
    );
    assertRoute("list", "/", RequestMethod.GET);
    assertRoute("get", ":viewId", RequestMethod.GET);
    assertRoute("create", "/", RequestMethod.POST);
    assertRoute("update", ":viewId", RequestMethod.PATCH);
    assertRoute("delete", ":viewId", RequestMethod.DELETE);
    assert.equal(
      JSON.stringify(Reflect.getMetadata(PATH_METADATA, AnalysisViewController)).includes(
        "workspaceId",
      ),
      false,
    );
    assert.deepEqual(
      [
        ANALYSIS_VIEW_LIST_PERMISSION,
        ANALYSIS_VIEW_READ_PERMISSION,
        ANALYSIS_VIEW_CREATE_PERMISSION,
        ANALYSIS_VIEW_UPDATE_PERMISSION,
        ANALYSIS_VIEW_DELETE_PERMISSION,
      ],
      [
        "analytics.saved_view.list:workspace",
        "analytics.saved_view.read:workspace",
        "analytics.saved_view.create:workspace",
        "analytics.saved_view.update:workspace",
        "analytics.saved_view.delete:workspace",
      ],
    );
  });

  it("authorizes saved definitions with both route and dataset permissions", async () => {
    const authorization = {
      actorId: "actor",
      locale: "en",
      permissions: new Set([SUPPORT_TICKETS_QUERY_PERMISSION]),
      principalType: "workspace",
      requestId: "request",
      timeZone: "UTC",
    } as const;
    const authorizationInputs: unknown[] = [];
    const serviceCalls: unknown[] = [];
    const controller = new AnalysisViewController(
      {
        create: async (_request: unknown, input: unknown) => {
          authorizationInputs.push(input);
          return authorization;
        },
      } as never,
      {
        create: async (payload: unknown, context: unknown) => {
          serviceCalls.push({ context, payload });
          return { ok: true };
        },
        update: async (viewId: string, payload: unknown, context: unknown) => {
          serviceCalls.push({ context, payload, viewId });
          return { ok: true };
        },
      } as never,
    );

    await controller.create({} as never, { name: "View" });
    await controller.update({} as never, "view-id", {
      expectedRevision: 1,
      name: "Renamed",
    });

    assert.deepEqual(authorizationInputs, [
      {
        operationPermission: ANALYSIS_VIEW_CREATE_PERMISSION,
        requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
      },
      {
        operationPermission: ANALYSIS_VIEW_UPDATE_PERMISSION,
        requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
      },
    ]);
    assert.equal(
      serviceCalls.every((call) =>
        (call as { context: unknown }).context === authorization
      ),
      true,
    );
  });
});

function assertRoute(
  method: keyof AnalysisViewController,
  path: string,
  requestMethod: RequestMethod,
) {
  const handler = AnalysisViewController.prototype[method] as object;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), path);
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), requestMethod);
}
