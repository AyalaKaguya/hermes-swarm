import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  appRuntimeConfig,
  databaseRuntimeConfig,
  settingsRuntimeConfig,
  validateRuntimeConfig,
} from "./runtime-config.js";

const originalEnvironment = {
  DATABASE_SYNCHRONIZE: process.env.DATABASE_SYNCHRONIZE,
  DATABASE_STRICT_RLS: process.env.DATABASE_STRICT_RLS,
  NODE_ENV: process.env.NODE_ENV,
  POSTGRES_PLATFORM_URL: process.env.POSTGRES_PLATFORM_URL,
  POSTGRES_TEST_URL: process.env.POSTGRES_TEST_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
  POSTGRES_WORKSPACE_URL: process.env.POSTGRES_WORKSPACE_URL,
  SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY,
  TRUSTED_PROXY_CIDRS: process.env.TRUSTED_PROXY_CIDRS,
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
    process.env.POSTGRES_URL = "postgresql://app.example/hermes";
    delete process.env.DATABASE_SYNCHRONIZE;

    assert.equal(databaseRuntimeConfig().synchronize, false);

    process.env.DATABASE_SYNCHRONIZE = "true";
    assert.equal(databaseRuntimeConfig().synchronize, true);
  });

  it("uses POSTGRES_TEST_URL as the only test database connection", () => {
    process.env.NODE_ENV = "test";
    process.env.POSTGRES_URL = "postgresql://regular.example/hermes";
    process.env.POSTGRES_TEST_URL = "postgresql://test.example/hermes-test";

    const database = databaseRuntimeConfig();
    assert.equal(database.url, "postgresql://test.example/hermes-test");
    assert.equal("workspaceUrl" in database, false);
    assert.equal("platformUrl" in database, false);
  });

  it("uses POSTGRES_URL for every non-test runtime", () => {
    process.env.NODE_ENV = "development";
    process.env.POSTGRES_URL = "postgresql://app.example/hermes";
    process.env.POSTGRES_TEST_URL = "postgresql://test.example/hermes-test";

    assert.equal(
      databaseRuntimeConfig().url,
      "postgresql://app.example/hermes",
    );
  });

  it("rejects legacy RLS variables before a direct runtime consumer opens a connection", () => {
    process.env.NODE_ENV = "development";
    process.env.POSTGRES_URL = "postgresql://app.example/hermes";
    process.env.DATABASE_STRICT_RLS = "false";

    assert.throws(
      () => databaseRuntimeConfig(),
      /no longer supported.*DATABASE_STRICT_RLS/,
    );
  });

  it("requires POSTGRES_TEST_URL for test startup", () => {
    assert.throws(
      () => validateRuntimeConfig({ NODE_ENV: "test" }),
      /POSTGRES_TEST_URL is required/,
    );
  });

  it("does not validate or use POSTGRES_URL during test startup", () => {
    assert.doesNotThrow(() =>
      validateRuntimeConfig({
        NODE_ENV: "test",
        POSTGRES_TEST_URL: "postgresql://test.example/hermes-test",
        POSTGRES_URL: "not-a-postgres-url",
      }),
    );
  });

  it("requires POSTGRES_URL outside test runtime", () => {
    assert.throws(
      () =>
        validateRuntimeConfig({
          NODE_ENV: "development",
          POSTGRES_HOST: "db.example",
        }),
      /POSTGRES_URL is required/,
    );
    assert.doesNotThrow(() =>
      validateRuntimeConfig({
        NODE_ENV: "development",
        POSTGRES_URL: "postgresql://app.example/hermes",
      }),
    );

    process.env.NODE_ENV = "development";
    delete process.env.POSTGRES_URL;
    assert.throws(
      () => databaseRuntimeConfig(),
      /POSTGRES_URL is required/,
    );
  });

  it("rejects all retired RLS connection settings with a migration message", () => {
    const base = {
      NODE_ENV: "development",
      POSTGRES_URL: "postgresql://app.example/hermes",
    };
    const legacySettings = {
      DATABASE_STRICT_RLS: "false",
      POSTGRES_PLATFORM_URL: "postgresql://platform.example/hermes",
      POSTGRES_WORKSPACE_URL: "postgresql://workspace.example/hermes",
    };

    for (const [name, value] of Object.entries(legacySettings)) {
      assert.throws(
        () => validateRuntimeConfig({ ...base, [name]: value }),
        new RegExp(`no longer supported.*${name}`),
      );
    }
  });

  it("rejects synchronize in production", () => {
    assert.throws(
      () =>
        validateRuntimeConfig({
          DATABASE_SYNCHRONIZE: "true",
          NODE_ENV: "production",
          POSTGRES_URL: "postgresql://app.example/hermes",
        }),
      /DATABASE_SYNCHRONIZE must be false/,
    );
  });

  it("requires independent production secrets with at least 32 bytes", () => {
    const base = {
      AUTH_SESSION_SECRET: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      INVITE_TOKEN_SECRET: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      NODE_ENV: "production",
      PASSWORD_RESET_TOKEN_SECRET:
        "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      POSTGRES_URL: "postgresql://app.example/hermes",
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
