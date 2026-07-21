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
    }

    assert.ok(Object.keys(document.components?.schemas ?? {}).length > 0);
    const login = document.paths["/api/admin/auth/login"]?.post;
    assert.ok(login?.requestBody);
    assert.ok(login?.responses[201]);
  });
});
