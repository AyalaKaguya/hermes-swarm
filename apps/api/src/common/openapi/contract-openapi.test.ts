import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpenAPIObject } from "@nestjs/swagger";
import "./zod-openapi-setup.js";

describe("admin contract OpenAPI generation", () => {
  it("generates a documented operation and response schema for every contract", async () => {
    const [{ adminContractList }, { mergeAdminContractOpenApi }] = await Promise.all([
      import("@hermes-swarm/api-contracts/contracts"),
      import("./contract-openapi.js"),
    ]);
    const document = mergeAdminContractOpenApi({
      components: {},
      info: { title: "test", version: "1" },
      openapi: "3.0.0",
      paths: {},
    } as OpenAPIObject);

    for (const contract of adminContractList) {
      const path = `/api/admin${contract.path.replace(/:([^/]+)/g, "{$1}")}`;
      const operation = document.paths[path]?.[contract.method.toLowerCase() as "get"];
      assert.ok(operation, `${contract.method} ${path} is missing`);
      assert.ok(operation.responses, `${contract.id} has no responses`);
      for (const status of Object.keys(contract.responses)) {
        assert.ok(operation.responses[status], `${contract.id} is missing response ${status}`);
      }
      for (const status of Object.keys(contract.errorResponses ?? {})) {
        assert.ok(
          operation.responses[status],
          `${contract.id} is missing error response ${status}`,
        );
      }
    }

    assert.ok(Object.keys(document.components?.schemas ?? {}).length > 0);
    const login = document.paths["/api/admin/auth/login"]?.post;
    assert.ok(login?.requestBody);
    assert.ok(login?.responses[201]);

    const toolCreate = document.paths["/api/admin/platform/ai/tools"]?.post;
    assert.ok(toolCreate?.responses[400]);
    assert.ok(toolCreate?.responses[401]);
    assert.ok(toolCreate?.responses[403]);
    assert.ok(toolCreate?.responses[404]);
    assert.ok(toolCreate?.responses[409]);
    assert.ok(toolCreate?.responses[500]);

    const stream = document.paths["/api/admin/ai/runs/{runId}/events/stream"]?.get;
    assert.ok(stream);
    const streamSuccessContent = responseContent(stream.responses[200]);
    assert.ok(streamSuccessContent["text/event-stream"]);
    assert.equal(streamSuccessContent["application/json"], undefined);
    assert.ok(document.components?.schemas?.ai_runs_events_stream_Response200);
    const lastEventId = stream.parameters?.find(
      (parameter) =>
        !("$ref" in parameter) &&
        parameter.in === "header" &&
        parameter.name === "Last-Event-ID",
    );
    assert.ok(lastEventId && !("$ref" in lastEventId));
    assert.equal(lastEventId.required, false);
    assert.equal((lastEventId.schema as { type?: string } | undefined)?.type, "string");
    assert.ok(responseContent(stream.responses[400])["application/json"]);
    assert.ok(responseContent(stream.responses[404])["application/json"]);

    const history = document.paths["/api/admin/ai/runs/{runId}/events"]?.get;
    assert.ok(history);
    const historySuccessContent = responseContent(history.responses[200]);
    assert.ok(historySuccessContent["application/json"]);
    assert.equal(historySuccessContent["text/event-stream"], undefined);
  });
});

function responseContent(response: unknown): Record<string, unknown> {
  assert.ok(response && typeof response === "object" && !("$ref" in response));
  return (response as { content?: Record<string, unknown> }).content ?? {};
}
