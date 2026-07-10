import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  databaseRuntimeConfig,
  validateRuntimeConfig,
} from "./runtime-config.js";

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  POSTGRES_TEST_URL: process.env.POSTGRES_TEST_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
  DATABASE_SYNCHRONIZE: process.env.DATABASE_SYNCHRONIZE,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("database runtime configuration", () => {
  it("synchronizes by default during development", () => {
    process.env.NODE_ENV = "development";
    delete process.env.DATABASE_SYNCHRONIZE;

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
});