import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { BadRequestException, InternalServerErrorException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { firstValueFrom, of } from "rxjs";
import { AdminContractInterceptor } from "./contract-validation.js";

describe("AdminContractInterceptor", () => {
  it("rejects invalid request bodies before invoking the handler", () => {
    let invoked = false;
    const interceptor = new AdminContractInterceptor(new Reflector());
    const context = httpContext({
      body: { email: "owner@example.com", password: "secret", unexpected: true },
      method: "POST",
      originalUrl: "/api/admin/auth/login",
      params: {},
      query: {},
      url: "/api/admin/auth/login",
    }, 201);

    assert.throws(
      () => interceptor.intercept(context, {
        handle: () => {
          invoked = true;
          return of(null);
        },
      }),
      (error: unknown) => {
        assert.equal(error instanceof BadRequestException, true);
        assert.deepEqual((error as BadRequestException).getResponse(), {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          issues: [{
            code: "unrecognized_keys",
            message: "Unrecognized key: \"unexpected\"",
            path: "body",
          }],
          contract: "auth.login",
        });
        return true;
      },
    );
    assert.equal(invoked, false);
  });

  it("converts Date values to ISO strings at the response boundary", async () => {
    const interceptor = new AdminContractInterceptor(new Reflector());
    const context = httpContext({
      method: "POST",
      originalUrl: "/api/admin/auth/realtime-ticket",
      params: {},
      query: {},
      url: "/api/admin/auth/realtime-ticket",
    }, 201);
    const expiresAt = new Date("2026-07-21T00:00:00.000Z");

    const value = await firstValueFrom(interceptor.intercept(context, {
      handle: () => of({ expiresAt, ticket: "one-time-ticket" }),
    }));

    assert.deepEqual(value, {
      expiresAt: "2026-07-21T00:00:00.000Z",
      ticket: "one-time-ticket",
    });
  });

  it("shadows Express 5's getter-only query with the validated value", async () => {
    const interceptor = new AdminContractInterceptor(new Reflector());
    const request: Record<string, unknown> = {
      method: "GET",
      originalUrl: "/api/admin/notifications?take=20",
      params: {},
      url: "/api/admin/notifications?take=20",
    };
    Object.defineProperty(request, "query", {
      configurable: true,
      enumerable: true,
      get: () => ({ take: "20" }),
    });
    const context = httpContext(request, 200);

    const value = await firstValueFrom(interceptor.intercept(context, {
      handle: () => {
        assert.deepEqual(request.query, { take: 20 });
        return of([]);
      },
    }));

    assert.deepEqual(value, []);
  });

  it("returns a sanitized error when a handler violates its response contract", async () => {
    const interceptor = new AdminContractInterceptor(new Reflector());
    const context = httpContext({
      method: "POST",
      originalUrl: "/api/admin/auth/realtime-ticket",
      params: {},
      query: {},
      url: "/api/admin/auth/realtime-ticket",
    }, 201);

    await assert.rejects(
      firstValueFrom(interceptor.intercept(context, {
        handle: () => of({ accessToken: "must-not-leak" }),
      })),
      (error: unknown) => {
        assert.equal(error instanceof InternalServerErrorException, true);
        const response = (error as InternalServerErrorException).getResponse();
        assert.deepEqual(response, {
          code: "RESPONSE_CONTRACT_MISMATCH",
          message: "API response did not match its public contract",
        });
        assert.equal(JSON.stringify(response).includes("must-not-leak"), false);
        return true;
      },
    );
  });
});

function httpContext(request: Record<string, unknown>, statusCode: number) {
  const handler = () => undefined;
  class TestController {}
  return {
    getClass: () => TestController,
    getHandler: () => handler,
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}
