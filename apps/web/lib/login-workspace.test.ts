import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  forgetRecentWorkspace,
  normalizeWorkspace,
  readRecentWorkspace,
  rememberWorkspace,
  safeReturnUrl,
  withWorkspace,
} from "./login-workspace";

describe("login workspace state", () => {
  it("normalizes safe workspace slugs and rejects technical garbage", () => {
    assert.equal(normalizeWorkspace(" Acme-Cloud "), "acme-cloud");
    assert.equal(normalizeWorkspace("https://acme.example.com"), "");
    assert.equal(normalizeWorkspace("acme_cloud"), "");
  });

  it("remembers and clears only the recent workspace", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };
    rememberWorkspace(storage, "Acme");
    assert.equal(readRecentWorkspace(storage), "acme");
    forgetRecentWorkspace(storage);
    assert.equal(readRecentWorkspace(storage), "");
  });

  it("preserves safe internal return URLs and workspace links", () => {
    assert.equal(safeReturnUrl("/tickets?status=open"), "/tickets?status=open");
    assert.equal(safeReturnUrl("//evil.example"), "/home");
    assert.equal(withWorkspace("/forgot-password", "acme"), "/forgot-password?workspace=acme");
  });
});
