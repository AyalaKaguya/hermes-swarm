import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  appRuntimeConfig,
  databaseRuntimeConfig,
  settingsRuntimeConfig,
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
  TRUSTED_PROXY_CIDRS: process.env.TRUSTED_PROXY_CIDRS,
  SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("database runtime configuration", () => {
  it("uses a dedicated settings encryption key when configured", () => {
    process.env.SETTINGS_ENCRYPTION_KEY = "dedicated-settings-key";
    assert.equal(
      settingsRuntimeConfig().encryptionKey,
      "dedicated-settings-key",
    );
  });

  it("normalizes trusted proxy CIDRs and rejects invalid ranges", () => {
    process.env.TRUSTED_PROXY_CIDRS = " 127.0.0.1/32, ::1/128 ";
    assert.deepEqual(appRuntimeConfig().trustedProxyCidrs, [
      "127.0.0.1/32",
      "::1/128",
    ]);
    assert.doesNotThrow(() =>
      validateRuntimeConfig({
        NODE_ENV: "test",
        POSTGRES_TEST_URL: "postgresql://test.example/hermes-test",
        TRUSTED_PROXY_CIDRS: process.env.TRUSTED_PROXY_CIDRS,
      }),
    );
    assert.throws(
      () =>
        validateRuntimeConfig({
          NODE_ENV: "test",
          POSTGRES_TEST_URL: "postgresql://test.example/hermes-test",
          TRUSTED_PROXY_CIDRS: "10.0.0.0/99",
        }),
      /Invalid trusted proxy CIDR/,
    );
  });

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
        AUTH_SESSION_SECRET: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        INVITE_TOKEN_SECRET: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        NODE_ENV: "production",
        PASSWORD_RESET_TOKEN_SECRET:
          "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        POSTGRES_PLATFORM_URL: "postgresql://platform@app.example/hermes",
        POSTGRES_TENANT_URL:
          "postgresql://hermes_tenant_app@app.example/hermes",
        SETTINGS_ENCRYPTION_KEY:
          "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
        WEB_SESSION_SECRET: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
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

  it("requires independent production secrets with at least 32 bytes", () => {
    const base = {
      AUTH_SESSION_SECRET: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      INVITE_TOKEN_SECRET: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      NODE_ENV: "production",
      PASSWORD_RESET_TOKEN_SECRET:
        "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      POSTGRES_PLATFORM_URL: "postgresql://platform@app.example/hermes",
      POSTGRES_TENANT_URL:
        "postgresql://hermes_tenant_app@app.example/hermes",
      SETTINGS_ENCRYPTION_KEY:
        "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
      WEB_SESSION_SECRET: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
    };
    assert.throws(
      () =>
        validateRuntimeConfig({
          ...base,
          PASSWORD_RESET_TOKEN_SECRET: undefined,
        }),
      /PASSWORD_RESET_TOKEN_SECRET is required/,
    );
    assert.throws(
      () =>
        validateRuntimeConfig({
          ...base,
          WEB_SESSION_SECRET: "too-short",
        }),
      /at least 32 bytes/,
    );
    assert.throws(
      () =>
        validateRuntimeConfig({
          ...base,
          WEB_SESSION_SECRET: base.AUTH_SESSION_SECRET,
        }),
      /must be independent/,
    );
  });
});
