import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  type ArgumentsHost,
} from "@nestjs/common";
import { ToolGatewayErrorSchema } from "@hermes-swarm/api-contracts/ai";
import { ToolGatewayExceptionFilter } from "./tool-gateway-exception.filter.js";

describe("ToolGatewayExceptionFilter", () => {
  it("preserves an approved domain code and emits the strict public shape", () => {
    const result = invoke(
      new BadRequestException({
        code: "TOOL_HEADER_FORBIDDEN",
        message: "Reserved headers cannot be configured",
      }),
    );
    assert.equal(result.statusCode, 400);
    assert.deepEqual(result.body, {
      code: "TOOL_HEADER_FORBIDDEN",
      message: "Reserved headers cannot be configured",
      statusCode: 400,
    });
    assert.equal(ToolGatewayErrorSchema.safeParse(result.body).success, true);
  });

  it("normalizes unknown and internal errors without exposing private details", () => {
    const conflict = invoke(
      new ConflictException({ code: "DATABASE_CONSTRAINT", message: ["A", "B"] }),
    );
    assert.deepEqual(conflict.body, {
      code: "AI_TOOL_CONFLICT",
      message: "A, B",
      statusCode: 409,
    });

    const internal = invoke(new Error("database password leaked"));
    assert.deepEqual(internal.body, {
      code: "AI_TOOL_INTERNAL_ERROR",
      message: "Tool Gateway request failed",
      statusCode: 500,
    });
    assert.equal(JSON.stringify(internal.body).includes("password"), false);
  });
});

function invoke(exception: unknown) {
  const result: { body?: unknown; statusCode?: number } = {};
  const response = {
    json(body: unknown) {
      result.body = body;
      return body;
    },
    status(statusCode: number) {
      result.statusCode = statusCode;
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as ArgumentsHost;
  new ToolGatewayExceptionFilter().catch(exception, host);
  return result as { body: unknown; statusCode: number };
}
