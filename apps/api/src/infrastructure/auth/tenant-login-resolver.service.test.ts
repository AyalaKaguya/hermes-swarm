import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { TenantLoginResolverService } from "./tenant-login-resolver.service.js";

describe("TenantLoginResolverService", () => {
  it("resolves an active tenant from the trusted forwarded host", async () => {
    const service = createResolver();
    const result = await service.resolve({
      headers: { "x-forwarded-host": "acme.example.com:3100" },
    });
    assert.equal(result?.source, "host");
    assert.equal(result?.tenant.slug, "acme-workspace");
  });

  it("uses an explicit workspace on localhost without a default tenant fallback", async () => {
    const service = createResolver();
    assert.equal(
      (await service.resolve({ headers: { host: "localhost:3100" } }, "beta"))
        ?.tenant.slug,
      "beta",
    );
    assert.equal(
      await service.resolve({ headers: { host: "localhost:3100" } }),
      null,
    );
  });

  it("rejects a workspace that conflicts with the tenant subdomain", async () => {
    const service = createResolver();
    await assert.rejects(
      service.resolve(
        { headers: { "x-forwarded-host": "acme.example.com" } },
        "beta",
      ),
      BadRequestException,
    );
  });

  it("does not resolve suspended tenants", async () => {
    const service = createResolver();
    assert.equal(
      await service.resolve({ headers: { host: "localhost" } }, "suspended"),
      null,
    );
  });
});

function createResolver() {
  const tenants = [
    { id: "tenant-acme", name: "Acme", slug: "acme-workspace", status: "active", subdomain: "acme" },
    { id: "tenant-beta", name: "Beta", slug: "beta", status: "active", subdomain: "beta" },
    { id: "tenant-suspended", name: "Suspended", slug: "suspended", status: "suspended", subdomain: "suspended" },
  ];
  return new TenantLoginResolverService(
    {
      findOne: async ({ where }: any) => {
        const candidates = Array.isArray(where) ? where : [where];
        return tenants.find((tenant) =>
          candidates.some(
            (candidate) =>
              ((candidate.status as any)?.value ?? candidate.status)?.includes?.(tenant.status) !== false &&
              ((!candidate.slug || tenant.slug === candidate.slug) &&
                (!candidate.subdomain || tenant.subdomain === candidate.subdomain)),
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
