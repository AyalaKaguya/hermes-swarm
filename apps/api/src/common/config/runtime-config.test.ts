import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  databaseRuntimeConfig,
  validateRuntimeConfig,
} from "./runtime-config.js";

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  POSTGRES_TEST_URL: process.env.POSTGRES_TEST_URL,
  POSTGRES_TENANT_URL: process.env.POSTGRES_TENANT_URL,
  POSTGRES_PLATFORM_URL: process.env.POSTGRES_PLATFORM_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
  DATABASE_SYNCHRONIZE: process.env.DATABASE_SYNCHRONIZE,
  DATABASE_STRICT_RLS: process.env.DATABASE_STRICT_RLS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("database runtime configuration", () => {
  it("requires an explicit opt-in to synchronize during development", () => {
    process.env.NODE_ENV = "development";
    delete process.env.DATABASE_SYNCHRONIZE;

    assert.equal(databaseRuntimeConfig().synchronize, false);

    process.env.DATABASE_SYNCHRONIZE = "true";
    assert.equal(databaseRuntimeConfig().synchronize, true);
  });

  it("uses only POSTGRES_TEST_URL for test runtime", () => {
    process.env.NODE_ENV = "test";
    process.env.POSTGRES_URL = "postgresql://regular.example/hermes";
    process.env.POSTGRES_TEST_URL = "postgresql://test.example/hermes-test";

    assert.equal(
      databaseRuntimeConfig().url,
      "postgresql://test.example/hermes-test",
    );
    assert.equal(
      databaseRuntimeConfig().tenantUrl,
      "postgresql://test.example/hermes-test",
    );
    assert.equal(
      databaseRuntimeConfig().platformUrl,
      "postgresql://test.example/hermes-test",
    );
  });

  it("enables strict RLS automatically in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_STRICT_RLS;
    assert.equal(databaseRuntimeConfig().strictRls, true);
  });

  it("enables strict RLS in development and disables role probing only for tests", () => {
    process.env.NODE_ENV = "development";
    delete process.env.DATABASE_STRICT_RLS;
    assert.equal(databaseRuntimeConfig().strictRls, true);

    process.env.NODE_ENV = "test";
    assert.equal(databaseRuntimeConfig().strictRls, false);
  });

  it("rejects test startup without an isolated database URL", () => {
    assert.throws(
      () => validateRuntimeConfig({ NODE_ENV: "test" }),
      /POSTGRES_TEST_URL is required/,
    );
  });

  it("rejects synchronize in production", () => {
    assert.throws(
      () =>
        validateRuntimeConfig({
          DATABASE_SYNCHRONIZE: "true",
          NODE_ENV: "production",
        }),
      /DATABASE_SYNCHRONIZE must be false/,
    );
  });

  it("requires distinct tenant and platform database credentials in production", () => {
    assert.throws(
      () => validateRuntimeConfig({ NODE_ENV: "production" }),
      /POSTGRES_TENANT_URL and POSTGRES_PLATFORM_URL are required/,
    );
    assert.throws(
      () =>
        validateRuntimeConfig({
          NODE_ENV: "production",
          POSTGRES_PLATFORM_URL: "postgresql://app.example/hermes",
          POSTGRES_TENANT_URL: "postgresql://app.example/hermes",
        }),
      /must use separate database credentials/,
    );
    assert.doesNotThrow(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        POSTGRES_PLATFORM_URL: "postgresql://platform@app.example/hermes",
        POSTGRES_TENANT_URL:
          "postgresql://hermes_tenant_app@app.example/hermes",
      }),
    );
    assert.throws(
      () =>
        validateRuntimeConfig({
          NODE_ENV: "production",
          POSTGRES_PLATFORM_URL: "postgresql://platform@app.example/hermes",
          POSTGRES_TENANT_URL: "postgresql://tenant@app.example/hermes",
        }),
      /must authenticate as hermes_tenant_app/,
    );
  });

  it("requires the isolated RLS credentials during development", () => {
    assert.throws(
      () => validateRuntimeConfig({ NODE_ENV: "development" }),
      /POSTGRES_TENANT_URL and POSTGRES_PLATFORM_URL are required outside tests/,
    );
    assert.throws(
      () =>
        validateRuntimeConfig({
          DATABASE_STRICT_RLS: "false",
          NODE_ENV: "development",
        }),
      /DATABASE_STRICT_RLS must remain enabled/,
    );
    assert.doesNotThrow(() =>
      validateRuntimeConfig({
        NODE_ENV: "development",
        POSTGRES_PLATFORM_URL: "postgresql://hermes@app.example/hermes",
        POSTGRES_TENANT_URL:
          "postgresql://hermes_tenant_app@app.example/hermes",
      }),
    );
  });
});
