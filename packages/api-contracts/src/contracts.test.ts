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

  it("registers analytics queries without a client-controlled workspace", () => {
    const contract = findAdminContract("POST", "/api/admin/analytics/query")?.contract;
    assert.equal(contract?.id, "analytics.query");
    assert.equal(
      contract?.body?.safeParse({
        schemaVersion: "hermes.analytics.query/v1",
        select: ["status"],
        sourceKey: "support.tickets",
        sourceRevision: "support.tickets/v1",
        workspaceId: "workspace-a",
      }).success,
      false,
    );
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

  it("registers controlled Tool Gateway routes without client-selected Workspace scope", () => {
    const platformVersion = findAdminContract(
      "PATCH",
      "/api/admin/platform/ai/tools/11111111-1111-4111-8111-111111111111/versions/1.2.3",
    );
    const connectionCreate = findAdminContract(
      "POST",
      "/api/admin/workspace/ai/tools/connections",
    )?.contract;
    const grantBind = findAdminContract(
      "PUT",
      "/api/admin/workspace/ai/tools/grants/22222222-2222-4222-8222-222222222222/connection",
    );

    assert.equal(
      platformVersion?.contract.id,
      "platform.ai.toolVersions.status.update",
    );
    assert.deepEqual(platformVersion?.params, {
      toolDefinitionId: "11111111-1111-4111-8111-111111111111",
      version: "1.2.3",
    });
    assert.equal(
      connectionCreate?.id,
      "workspace.ai.toolConnections.create",
    );
    assert.equal(
      connectionCreate?.body?.safeParse({
        authType: "none",
        baseUrl: "https://tools.example.com/hermes",
        driverType: "http",
        name: "Support tools",
        networkPolicyId: "33333333-3333-4333-8333-333333333333",
        workspaceId: "44444444-4444-4444-8444-444444444444",
      }).success,
      false,
    );
    assert.equal(
      grantBind?.contract.id,
      "workspace.ai.toolGrants.connection.bind",
    );
    assert.deepEqual(grantBind?.params, {
      grantId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("registers Agent Draft and immutable Version routes", () => {
    const agentId = "11111111-1111-4111-8111-111111111111";
    const draft = findAdminContract(
      "PUT",
      `/api/admin/agents/${agentId}/draft`,
    );
    const version = findAdminContract(
      "GET",
      `/api/admin/agents/${agentId}/versions/7`,
    );

    assert.equal(draft?.contract.id, "agents.draft.replace");
    assert.deepEqual(draft?.params, { agentId });
    assert.equal(version?.contract.id, "agents.versions.get");
    assert.deepEqual(version?.params, { agentId, version: "7" });
    assert.equal(
      version?.contract.params?.safeParse(version.params).success,
      true,
    );
  });

  it("registers strict Run event history and SSE routes", () => {
    const runId = "11111111-1111-4111-8111-111111111111";
    const history = findAdminContract(
      "GET",
      `/api/admin/ai/runs/${runId}/events`,
    );
    const stream = findAdminContract(
      "GET",
      `/api/admin/ai/runs/${runId}/events/stream`,
    );

    assert.equal(history?.contract.id, "ai.runs.events.history");
    assert.deepEqual(history?.params, { runId });
    assert.equal(history?.contract.params?.safeParse(history.params).success, true);
    assert.equal(
      history?.contract.params?.safeParse({ runId: "not-a-uuid" }).success,
      false,
    );
    assert.deepEqual(history?.contract.query?.parse({}), {
      afterSequence: 0,
      limit: 50,
    });
    assert.deepEqual(
      history?.contract.query?.parse({ afterSequence: "9", limit: "200" }),
      { afterSequence: 9, limit: 200 },
    );
    assert.equal(
      history?.contract.query?.safeParse({ afterSequence: 0, limit: 201 }).success,
      false,
    );
    assert.equal(
      history?.contract.query?.safeParse({
        afterSequence: 2_147_483_648,
        limit: 50,
      }).success,
      false,
    );

    assert.equal(stream?.contract.id, "ai.runs.events.stream");
    assert.deepEqual(stream?.params, { runId });
    assert.equal(stream?.contract.params?.safeParse(stream.params).success, true);
    assert.deepEqual(stream?.contract.query?.parse({}), {});
    assert.deepEqual(
      stream?.contract.query?.parse({ afterSequence: "9" }),
      { afterSequence: 9 },
    );
    assert.deepEqual(
      stream?.contract.headers?.parse({ "Last-Event-ID": "9" }),
      { "Last-Event-ID": "9" },
    );
    assert.equal(stream?.contract.eventStream, true);

    for (const contract of [history?.contract, stream?.contract]) {
      assert.ok(contract);
      assert.equal(
        contract.errorResponses?.[400]?.safeParse({
          code: "AI_RUN_EVENT_CURSOR_INVALID",
          message: "The run event cursor is invalid.",
          statusCode: 400,
        }).success,
        true,
      );
      assert.equal(
        contract.errorResponses?.[404]?.safeParse({
          code: "AI_RUN_UNAVAILABLE",
          message: "The run is unavailable.",
          statusCode: 404,
        }).success,
        true,
      );
    }
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
