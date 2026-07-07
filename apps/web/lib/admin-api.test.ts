import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AdminApiError } from "./admin-api";
import {
  getAuthenticatedAdminToken,
  requireAuthenticatedAdminToken,
} from "./authenticated-admin";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
  (globalThis as { window?: Window }).window = originalWindow;
});

describe("admin API authenticated token helper", () => {
  it("returns a usable stored access token without refreshing", async () => {
    const storage = createLocalStorage();
    installWindow(storage);
    storage.setItem(
      "hermes-swarm.admin-session",
      JSON.stringify({
        accessToken: "current-token",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        sessionId: "session-1",
      }),
    );

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response(null, { status: 500 });
    };

    assert.equal(await getAuthenticatedAdminToken(), "current-token");
    assert.equal(fetchCalled, false);
  });

  it("refreshes an expired stored access token and persists the new session", async () => {
    const storage = createLocalStorage();
    installWindow(storage);
    storage.setItem(
      "hermes-swarm.admin-session",
      JSON.stringify({
        accessToken: "expired-token",
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        sessionId: "session-1",
      }),
    );

    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "/api/admin/auth/refresh");
      assert.equal(init?.method, "POST");
      return Response.json({
        accessToken: "refreshed-token",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        sessionId: "session-2",
      });
    };

    assert.equal(await getAuthenticatedAdminToken(), "refreshed-token");
    assert.equal(
      JSON.parse(storage.getItem("hermes-swarm.admin-session") ?? "{}")
        .accessToken,
      "refreshed-token",
    );
  });

  it("throws a consistent authentication error when no usable token exists", async () => {
    installWindow(createLocalStorage());
    globalThis.fetch = async () =>
      Response.json({ message: "Unauthorized" }, { status: 401 });

    await assert.rejects(
      () => requireAuthenticatedAdminToken(),
      (error) =>
        error instanceof AdminApiError &&
        error.status === 401 &&
        error.code === "AUTHENTICATION_REQUIRED",
    );
  });
});

function installWindow(localStorage: Storage) {
  (globalThis as { window?: Partial<Window> }).window = {
    clearTimeout: globalThis.clearTimeout,
    localStorage,
    setTimeout: globalThis.setTimeout,
  };
}

function createLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}
