import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ModelProviderConfigurationError,
  ModelProviderDriverRegistryError,
  type ModelProviderDriver,
} from "./model-provider-driver.js";
import { ModelProviderDriverRegistry } from "./model-provider-driver.registry.js";
import {
  OpenAiCompatibleProviderDriver,
  normalizeOpenAiCompatibleConfiguration,
} from "./openai-compatible-provider.driver.js";

const productionPolicy = {
  allowedHosts: ["models.example.com", "gateway.example.com:8443"],
  requireHttps: true,
} as const;

describe("OpenAiCompatibleProviderDriver", () => {
  it("normalizes an allowlisted endpoint without performing a request", () => {
    const result = normalizeOpenAiCompatibleConfiguration({
      baseUrl: "https://MODELS.example.com:443/v1///",
    }, productionPolicy);
    assert.deepEqual(result, { baseUrl: "https://models.example.com/v1" });
    assert.equal(Object.isFrozen(result), true);

    const driver = new OpenAiCompatibleProviderDriver(config({
      "ai.allowedProviderHosts": ["models.example.com"],
      "ai.requireHttps": true,
    }) as never);
    assert.deepEqual(driver.normalizeConfiguration({
      baseUrl: "https://models.example.com/v1/",
    }), { baseUrl: "https://models.example.com/v1" });
  });

  it("requires an exact host and rejects suffix and port bypasses", () => {
    rejects("https://models.example.com.attacker.test/v1", productionPolicy);
    rejects("https://gateway.example.com/v1", productionPolicy);
    assert.deepEqual(normalizeOpenAiCompatibleConfiguration({
      baseUrl: "https://gateway.example.com:8443/v1",
    }, productionPolicy), {
      baseUrl: "https://gateway.example.com:8443/v1",
    });
  });

  it("rejects credentials, queries, fragments, and non-HTTPS production URLs", () => {
    rejects("https://user:secret@models.example.com/v1", productionPolicy);
    rejects("https://models.example.com/v1?api-version=1", productionPolicy);
    rejects("https://models.example.com/v1#fragment", productionPolicy);
    rejects("http://models.example.com/v1", productionPolicy);
    assert.deepEqual(normalizeOpenAiCompatibleConfiguration({
      baseUrl: "http://models.example.com/v1",
    }, { ...productionPolicy, requireHttps: false }), {
      baseUrl: "http://models.example.com/v1",
    });
  });

  it("rejects IP literals and hostnames with local or private semantics", () => {
    for (const url of [
      "https://127.0.0.1/v1",
      "https://[::1]/v1",
      "https://localhost/v1",
      "https://model.internal/v1",
      "https://model.home/v1",
      "https://model.local/v1",
      "https://model.lan/v1",
      "https://metadata.google.internal/v1",
      "https://single-label/v1",
    ]) {
      assert.throws(
        () => normalizeOpenAiCompatibleConfiguration(
          { baseUrl: url },
          { allowedHosts: [new URL(url).host], requireHttps: true },
        ),
        ModelProviderConfigurationError,
      );
    }
  });

  it("rejects unknown configuration fields and unsafe allowlist syntax", () => {
    assert.throws(
      () => normalizeOpenAiCompatibleConfiguration({
        apiKey: "private",
        baseUrl: "https://models.example.com/v1",
      }, productionPolicy),
      ModelProviderConfigurationError,
    );
    assert.throws(
      () => normalizeOpenAiCompatibleConfiguration({
        baseUrl: "https://models.example.com/v1",
      }, { allowedHosts: ["*.example.com"], requireHttps: true }),
      ModelProviderConfigurationError,
    );
    assert.throws(
      () => normalizeOpenAiCompatibleConfiguration({
        baseUrl: "https://models.example.com/v1",
      }, { allowedHosts: [], requireHttps: true }),
      ModelProviderConfigurationError,
    );
  });
});

describe("ModelProviderDriverRegistry", () => {
  const fakeDriver: ModelProviderDriver<{ baseUrl: string }> = {
    descriptor: {
      capabilities: ["chat"],
      displayName: "Fake",
      driver: "fake",
    },
    normalizeConfiguration(input) {
      return input as { baseUrl: string };
    },
  };

  it("resolves registered drivers and returns immutable public metadata", () => {
    const registry = new ModelProviderDriverRegistry([fakeDriver]);
    assert.equal(registry.has("fake"), true);
    assert.equal(registry.resolve("fake"), fakeDriver);
    const listed = registry.list();
    assert.deepEqual(listed, [{
      capabilities: ["chat"],
      displayName: "Fake",
      driver: "fake",
    }]);
    assert.equal(Object.isFrozen(listed[0]), true);
    assert.equal(Object.isFrozen(listed[0].capabilities), true);
  });

  it("fails closed for duplicate, invalid, and unknown driver IDs", () => {
    const registry = new ModelProviderDriverRegistry([fakeDriver]);
    assert.throws(
      () => registry.register(fakeDriver),
      (error: unknown) => error instanceof ModelProviderDriverRegistryError &&
        error.code === "AI_PROVIDER_DRIVER_DUPLICATE",
    );
    assert.throws(
      () => registry.resolve("missing"),
      (error: unknown) => error instanceof ModelProviderDriverRegistryError &&
        error.code === "AI_PROVIDER_DRIVER_UNKNOWN",
    );
    assert.throws(
      () => registry.register({
        ...fakeDriver,
        descriptor: { ...fakeDriver.descriptor, driver: "INVALID DRIVER" },
      }),
      (error: unknown) => error instanceof ModelProviderDriverRegistryError &&
        error.code === "AI_PROVIDER_DRIVER_INVALID",
    );
  });
});

function rejects(
  baseUrl: string,
  policy: { allowedHosts: readonly string[]; requireHttps: boolean },
) {
  assert.throws(
    () => normalizeOpenAiCompatibleConfiguration({ baseUrl }, policy),
    ModelProviderConfigurationError,
  );
}

function config(values: Record<string, unknown>) {
  return {
    get(name: string, fallback?: unknown) {
      return values[name] ?? fallback;
    },
  };
}
