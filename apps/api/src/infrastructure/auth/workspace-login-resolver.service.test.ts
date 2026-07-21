import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { WorkspaceLoginResolverService } from "./workspace-login-resolver.service.js";

describe("WorkspaceLoginResolverService", () => {
  it("resolves an active workspace from the trusted forwarded host", async () => {
    const service = createResolver();
    const result = await service.resolve({
      headers: { "x-forwarded-host": "acme.example.com:3100" },
    });
    assert.equal(result?.source, "host");
    assert.equal(result?.workspace.slug, "acme-workspace");
  });

  it("uses an explicit workspace on localhost without a default workspace fallback", async () => {
    const service = createResolver();
    assert.equal(
      (await service.resolve({ headers: { host: "localhost:3100" } }, "beta"))
        ?.workspace.slug,
      "beta",
    );
    assert.equal(
      await service.resolve({ headers: { host: "localhost:3100" } }),
      null,
    );
  });

  it("rejects a workspace that conflicts with the workspace subdomain", async () => {
    const service = createResolver();
    await assert.rejects(
      service.resolve(
        { headers: { "x-forwarded-host": "acme.example.com" } },
        "beta",
      ),
      BadRequestException,
    );
  });

  it("does not resolve suspended workspaces", async () => {
    const service = createResolver();
    assert.equal(
      await service.resolve({ headers: { host: "localhost" } }, "suspended"),
      null,
    );
  });
});

function createResolver() {
  const workspaces = [
    { id: "workspace-acme", name: "Acme", slug: "acme-workspace", status: "active", subdomain: "acme" },
    { id: "workspace-beta", name: "Beta", slug: "beta", status: "active", subdomain: "beta" },
    { id: "workspace-suspended", name: "Suspended", slug: "suspended", status: "suspended", subdomain: "suspended" },
  ];
  return new WorkspaceLoginResolverService(
    {
      findOne: async ({ where }: any) => {
        const candidates = Array.isArray(where) ? where : [where];
        return workspaces.find((workspace) =>
          candidates.some(
            (candidate) =>
              ((candidate.status as any)?.value ?? candidate.status)?.includes?.(workspace.status) !== false &&
              ((!candidate.slug || workspace.slug === candidate.slug) &&
                (!candidate.subdomain || workspace.subdomain === candidate.subdomain)),
          ),
        ) ?? null;
      },
    } as any,
    {
      getPlatformValue: async (key: string, fallback: string) => {
        if (key === "platform.subdomainRoutingEnabled") return "true";
        if (key === "platform.rootDomain") return "example.com";
        return fallback;
      },
    } as any,
  );
}
