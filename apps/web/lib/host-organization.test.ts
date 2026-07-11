import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import {
  normalizeSubdomain,
  resolveHostOrganizationIdFromPrincipal,
  resolveSubdomainFromHost,
} from "./host-organization";

test("resolveSubdomainFromHost derives organization subdomain under configured root domain", () => {
  assert.equal(resolveSubdomainFromHost("acme.app.example.com", "app.example.com"), "acme");
  assert.equal(resolveSubdomainFromHost("app.example.com", "app.example.com"), null);
  assert.equal(resolveSubdomainFromHost("localhost", "localhost"), null);
  assert.equal(resolveSubdomainFromHost("127.0.0.1", "0.0.1"), null);
});

test("resolveHostOrganizationIdFromPrincipal respects tenant subdomain routing settings", () => {
  const principal = {
    memberships: [
      {
        organizationId: "org-acme",
        organization: {
          slug: "acme-labs",
          subdomain: "Acme",
        },
      },
      {
        organizationId: "org-beta",
        organization: {
          slug: "beta-labs",
          subdomain: null,
        },
      },
    ],
    principalType: "tenant",
    systemSettings: [
      {
        name: PLATFORM_SETTING_KEYS.subdomainRoutingEnabled,
        value: "true",
      },
      {
        name: PLATFORM_SETTING_KEYS.rootDomain,
        value: "app.example.com",
      },
    ],
  };

  assert.equal(
    resolveHostOrganizationIdFromPrincipal(
      principal as never,
      "acme.app.example.com",
    ),
    "org-acme",
  );
  assert.equal(
    resolveHostOrganizationIdFromPrincipal(
      principal as never,
      "beta-labs.app.example.com",
    ),
    "org-beta",
  );
});

test("resolveHostOrganizationIdFromPrincipal ignores host when routing is disabled", () => {
  const principal = {
    memberships: [
      {
        organizationId: "org-acme",
        organization: {
          slug: "acme",
          subdomain: "acme",
        },
      },
    ],
    principalType: "tenant",
    systemSettings: [
      {
        name: PLATFORM_SETTING_KEYS.subdomainRoutingEnabled,
        value: "false",
      },
      {
        name: PLATFORM_SETTING_KEYS.rootDomain,
        value: "app.example.com",
      },
    ],
  };

  assert.equal(
    resolveHostOrganizationIdFromPrincipal(
      principal as never,
      "acme.app.example.com",
    ),
    null,
  );
});

test("normalizeSubdomain matches organization slug normalization", () => {
  assert.equal(normalizeSubdomain(" Acme Labs "), "acme-labs");
  assert.equal(normalizeSubdomain("app.secret"), "app-secret");
  assert.equal(normalizeSubdomain(""), null);
});
