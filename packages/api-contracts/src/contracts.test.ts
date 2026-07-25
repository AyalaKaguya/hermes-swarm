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
  CreateFileObjectRequestSchema,
  CreateTicketRequestSchema,
  OnboardingRequestSchema,
  PlatformMemberInvitationSchema,
  PublicBootstrapSchema,
  ResumeOnboardingRequestSchema,
  SaveSettingsRequestSchema,
  UpdateUserRequestSchema,
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

  it("accepts only server-owned file references in avatar and ticket writes", () => {
    const fileId = "11111111-1111-4111-8111-111111111111";
    assert.equal(
      CreateTicketRequestSchema.safeParse({
        attachments: [{ fileId }],
        body: "Please review the attachment",
        subject: "Attachment",
      }).success,
      true,
    );
    assert.equal(
      CreateTicketRequestSchema.safeParse({
        attachments: [{ name: "remote.png", type: "image", url: "https://example.com/file" }],
        body: "Please review the attachment",
        subject: "Attachment",
      }).success,
      false,
    );
    assert.equal(UpdateUserRequestSchema.safeParse({ imageFileId: fileId }).success, true);
    assert.equal(
      UpdateUserRequestSchema.safeParse({ imageUrl: "https://example.com/avatar.png" }).success,
      false,
    );
    assert.equal(
      CreateFileObjectRequestSchema.safeParse({
        byteSize: 5,
        mimeType: "text/plain",
        originalName: "note.txt",
        purpose: "document",
        workspaceId: fileId,
      }).success,
      false,
    );
  });

  it("requires exact API status codes while allowing browser 2xx normalization", () => {
    assert.equal(responseSchemaFor(adminContracts.authLogin, 200), undefined);
    assert.ok(responseSchemaFor(adminContracts.authLogin, 200, true));
    assert.ok(responseSchemaFor(adminContracts.authLogin, 201));
  });

  it("registers scope-specific provider catalog routes with write-only secrets", () => {
    const platformCreate = findAdminContract(
      "POST",
      "/api/admin/platform/ai/providers",
    )?.contract;
    const workspaceCreate = findAdminContract(
      "POST",
      "/api/admin/workspace/ai/providers",
    )?.contract;
    const grant = findAdminContract(
      "PATCH",
      "/api/admin/platform/ai/workspaces/11111111-1111-4111-8111-111111111111/grants/22222222-2222-4222-8222-222222222222",
    );

    assert.equal(platformCreate?.id, "platform.ai.providers.create");
    assert.equal(workspaceCreate?.id, "workspace.ai.providers.create");
    assert.equal(grant?.contract.id, "platform.ai.workspaceGrants.update");
    assert.deepEqual(grant?.params, {
      grantId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(
      workspaceCreate?.body?.safeParse({
        baseUrl: "https://models.example.com/v1",
        driver: "openai-compatible",
        name: "Workspace model",
        secret: { apiKey: "write-only" },
        workspaceId: "11111111-1111-4111-8111-111111111111",
      }).success,
      false,
    );
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
