import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthenticatedLoginInternalSchema,
  AuthenticatedLoginResponseSchema,
  LoginRequestSchema,
} from "./auth.js";
import {
  adminContractList,
  adminContracts,
  assertUniqueAdminContracts,
  findAdminContract,
  responseSchemaFor,
} from "./contracts.js";
import {
  AuditLogQuerySchema,
  OnboardingRequestSchema,
  PlatformMemberInvitationSchema,
  PublicBootstrapSchema,
  ResumeOnboardingRequestSchema,
  SaveSettingsRequestSchema,
} from "./domains.js";
import { IsoDateTimeSchema } from "./models.js";

describe("admin API contracts", () => {
  it("registers unique method and path pairs with responses", () => {
    assert.doesNotThrow(() => assertUniqueAdminContracts());
    assert.ok(adminContractList.length >= 80);
  });

  it("matches concrete paths and extracts decoded params", () => {
    const match = findAdminContract("DELETE", "/api/admin/auth/sessions/session%201");
    assert.equal(match?.contract.id, "auth.sessions.revoke");
    assert.deepEqual(match?.params, { sessionId: "session 1" });
  });

  it("rejects unknown request keys", () => {
    const result = LoginRequestSchema.safeParse({
      email: "admin@example.com",
      password: "secret",
      ignored: true,
    });
    assert.equal(result.success, false);
  });

  it("coerces query pagination without weakening object strictness", () => {
    assert.deepEqual(
      AuditLogQuerySchema.parse({ page: "2", pageSize: "25" }),
      { page: 2, pageSize: 25 },
    );
    assert.throws(() => AuditLogQuerySchema.parse({ page: "2", extra: "x" }));
  });

  it("accepts JSON setting maps and rejects undefined values", () => {
    assert.deepEqual(SaveSettingsRequestSchema.parse({ feature: true }), { feature: true });
    assert.throws(() => SaveSettingsRequestSchema.parse({ feature: undefined }));
  });

  it("models fresh and resumed onboarding without dual account fields", () => {
    const workspace = {
      defaultLanguage: "zh-Hans",
      defaultTimeZone: "Asia/Shanghai",
      platformTitle: "Hermes",
      workspaceApplicationsEnabled: true,
      workspaceName: "Acme",
      workspaceSlug: "acme",
    } as const;
    assert.equal(
      OnboardingRequestSchema.safeParse({
        ...workspace,
        adminEmail: "admin@example.com",
        adminName: "Admin",
        adminPassword: "strong-password",
      }).success,
      true,
    );
    assert.equal(ResumeOnboardingRequestSchema.safeParse(workspace).success, true);
    assert.equal(
      ResumeOnboardingRequestSchema.safeParse({
        ...workspace,
        adminEmail: "admin@example.com",
      }).success,
      false,
    );
  });

  it("publishes the four onboarding states with the compatibility flag", () => {
    for (const onboardingState of [
      "admin_required",
      "workspace_required",
      "complete",
      "recovery_required",
    ] as const) {
      assert.equal(
        PublicBootstrapSchema.safeParse({
          onboardingRequired: onboardingState === "admin_required",
          onboardingState,
        }).success,
        true,
      );
    }
  });

  it("requires timezone-aware ISO timestamps", () => {
    assert.equal(IsoDateTimeSchema.safeParse("2026-07-21T10:00:00.000Z").success, true);
    assert.equal(IsoDateTimeSchema.safeParse("2026-07-21 10:00:00").success, false);
  });

  it("requires exact API status codes while allowing browser 2xx normalization", () => {
    assert.equal(responseSchemaFor(adminContracts.authLogin, 200), undefined);
    assert.ok(responseSchemaFor(adminContracts.authLogin, 200, true));
    assert.ok(responseSchemaFor(adminContracts.authLogin, 201));
  });

  it("documents the invitation result when adding a new platform member", () => {
    const response = {
      invite: {
        acceptedCount: 0,
        acceptedUserId: null,
        actionDate: null,
        closedAt: null,
        contextType: "platform",
        createdAt: "2026-07-22T00:00:00.000Z",
        email: "operator@example.com",
        expireDate: null,
        id: "invite-1",
        invitedById: null,
        roleId: "role-1",
        status: "invited",
        workspaceRoleId: "role-1",
      },
      status: "invited",
    } as const;
    assert.deepEqual(PlatformMemberInvitationSchema.parse(response), response);
    const schema = responseSchemaFor(adminContracts.platformMemberCreate, 201);
    assert.equal(schema?.safeParse(response).success, true);
  });

  it("keeps access tokens out of browser responses", () => {
    assert.equal("accessToken" in AuthenticatedLoginInternalSchema.shape, true);
    assert.equal("accessToken" in AuthenticatedLoginResponseSchema.shape, false);
    assert.equal(
      AuthenticatedLoginResponseSchema.safeParse({
        accessToken: "secret",
        expiresAt: "2026-07-21T10:00:00.000Z",
        sessionId: "session-1",
        snapshot: {},
        status: "authenticated",
      }).success,
      false,
    );
  });
});
