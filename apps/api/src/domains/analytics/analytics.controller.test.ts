import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpStatus, RequestMethod } from "@nestjs/common";
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { AnalyticsController } from "./analytics.controller.js";
import { SUPPORT_TICKETS_QUERY_PERMISSION } from "./support-tickets-analytics.constants.js";

const ACCESS_OPERATION_METADATA = "hermes:access-operation";

describe("AnalyticsController", () => {
  it("registers distinct Workspace-scoped query-run routes", () => {
    assert.equal(
      Reflect.getMetadata(PATH_METADATA, AnalyticsController),
      "admin/analytics",
    );
    assertRoute("describe", "sources/support.tickets/schema", RequestMethod.GET);
    assertRoute("query", "query", RequestMethod.POST, HttpStatus.OK);
    assertRoute(
      "submitQueryRun",
      "query-runs",
      RequestMethod.POST,
      HttpStatus.ACCEPTED,
    );
    assertRoute("getQueryRun", "query-runs/:runId", RequestMethod.GET);
    assertRoute(
      "cancelQueryRun",
      "query-runs/:runId/cancel",
      RequestMethod.POST,
      HttpStatus.OK,
    );
    assertRoute(
      "getQueryRunResult",
      "query-runs/:runId/result",
      RequestMethod.GET,
    );
    assertRoute(
      "downloadArtifact",
      "artifacts/:artifactId/content",
      RequestMethod.GET,
    );

    const operations = [
      "submitQueryRun",
      "getQueryRun",
      "cancelQueryRun",
      "getQueryRunResult",
      "downloadArtifact",
    ].map((method) =>
      Reflect.getMetadata(
        ACCESS_OPERATION_METADATA,
        AnalyticsController.prototype[
          method as keyof AnalyticsController
        ] as object,
      )?.operation
    );
    assert.deepEqual(operations, [
      "query_run_submit",
      "query_run_read",
      "query_run_cancel",
      "query_run_result",
      "artifact_download",
    ]);
    assert.equal(new Set(operations).size, operations.length);
    assert.equal(JSON.stringify(operations).includes("workspaceId"), false);
  });

  it("passes only trusted authorization and opaque ids into the run service", async () => {
    const authorization = {
      actorId: "11111111-1111-4111-8111-111111111111",
      integrationTokenId: null,
      locale: "en",
      permissions: new Set([SUPPORT_TICKETS_QUERY_PERMISSION]),
      principalType: "workspace",
      requestId: "request-1",
      timeZone: "UTC",
    } as const;
    const authorizationInputs: unknown[] = [];
    const serviceCalls: unknown[] = [];
    const controller = new AnalyticsController(
      {} as never,
      {
        create: async (_request: unknown, input: unknown) => {
          authorizationInputs.push(input);
          return authorization;
        },
      } as never,
      {
        cancel: async (runId: string) => {
          serviceCalls.push({ method: "cancel", runId });
          return { id: runId };
        },
        get: async (runId: string) => {
          serviceCalls.push({ method: "get", runId });
          return { id: runId };
        },
        getArtifactContentUrl: async (artifactId: string) => {
          serviceCalls.push({ artifactId, method: "content" });
          return "https://storage.invalid/signed";
        },
        getResult: async (runId: string) => {
          serviceCalls.push({ method: "result", runId });
          return { kind: "inline" };
        },
        submit: async (payload: unknown, context: unknown) => {
          serviceCalls.push({ context, method: "submit", payload });
          return { status: "queued" };
        },
      } as never,
    );

    const payload = { idempotencyKey: "query-1", query: { select: ["status"] } };
    await controller.submitQueryRun({} as never, payload);
    await controller.getQueryRun("run-a");
    await controller.cancelQueryRun("run-a");
    await controller.getQueryRunResult("run-a");
    let redirect: unknown;
    await controller.downloadArtifact("artifact-a", {
      redirect(status, url) {
        redirect = { status, url };
      },
    });

    assert.deepEqual(authorizationInputs, [
      {
        operationPermission:
          "analytics.ticket_dataset.query_run_submit:workspace",
        requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
      },
    ]);
    assert.strictEqual(
      (serviceCalls[0] as { context: unknown }).context,
      authorization,
    );
    assert.deepEqual(serviceCalls, [
      { context: authorization, method: "submit", payload },
      { method: "get", runId: "run-a" },
      { method: "cancel", runId: "run-a" },
      { method: "result", runId: "run-a" },
      { artifactId: "artifact-a", method: "content" },
    ]);
    assert.deepEqual(redirect, {
      status: HttpStatus.FOUND,
      url: "https://storage.invalid/signed",
    });
    assert.equal(JSON.stringify(serviceCalls).includes("workspaceId"), false);
  });
});

function assertRoute(
  method: keyof AnalyticsController,
  path: string,
  requestMethod: RequestMethod,
  status?: HttpStatus,
) {
  const handler = AnalyticsController.prototype[method] as object;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), path);
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), requestMethod);
  if (status !== undefined) {
    assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, handler), status);
  }
}
