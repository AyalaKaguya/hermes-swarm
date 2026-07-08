import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchMe } from "./admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "./authenticated-admin";
import { clearStoredSession, getStoredSession } from "./session";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
  (globalThis as { window?: Window }).window = originalWindow;
});

describe("admin API browser auth client", () => {
  it("returns only a non-secret web session marker", async () => {
    assert.equal(await getAuthenticatedAdminSessionMarker(), "web-session");
    assert.equal(await requireAuthenticatedAdminSessionMarker(), "web-session");
  });

  it("removes legacy localStorage access tokens", () => {
    const storage = createLocalStorage();
    installWindow(storage);
    storage.setItem(
      "hermes-swarm.admin-session",
      JSON.stringify({
        accessToken: "legacy-token",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        sessionId: "session-1",
      }),
    );

    assert.equal(getStoredSession(), null);
    assert.equal(storage.getItem("hermes-swarm.admin-session"), null);
  });

  it("does not send browser Authorization headers", async () => {
    installWindow(createLocalStorage());
    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.has("Authorization"), false);
      return Response.json({ memberships: [], permissions: [], user: {} });
    };

    await fetchMe();
  });

  it("clears legacy session storage explicitly", () => {
    const storage = createLocalStorage();
    installWindow(storage);
    storage.setItem("hermes-swarm.admin-session", "{}");
    clearStoredSession();
    assert.equal(storage.getItem("hermes-swarm.admin-session"), null);
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
