import { z, type ZodType } from "zod";
import {
  AnalysisViewListSchema,
  AnalysisViewParamsSchema,
  AnalysisViewSchema,
  AnalysisQuerySchema,
  CreateAnalysisViewRequestSchema,
  DatasetResultSchema,
  DatasetSchema as AnalyticsDatasetSchema,
  DeleteAnalysisViewRequestSchema,
  UpdateAnalysisViewRequestSchema,
} from "./analytics/index.js";
import {
  AgentCatalogBadRequestErrorSchema,
  AgentCatalogConflictErrorSchema,
  AgentCatalogNotFoundErrorSchema,
  AgentDraftSchema,
  AgentSchema,
  AgentVersionSchema,
  AgentVersionSummarySchema,
  BindWorkspaceToolGrantConnectionRequestSchema,
  CreateAgentRequestSchema,
  CreatePlatformToolDefinitionRequestSchema,
  CreatePlatformToolNetworkPolicyRequestSchema,
  CreatePlatformToolVersionRequestSchema,
  CreatePlatformModelDeploymentRequestSchema,
  CreatePlatformModelProviderRequestSchema,
  CreateWorkspaceToolConnectionRequestSchema,
  CreateWorkspaceToolGrantRequestSchema,
  CreateWorkspaceModelDeploymentRequestSchema,
  CreateWorkspaceModelGrantRequestSchema,
  CreateWorkspaceModelProviderRequestSchema,
  PlatformToolDefinitionSchema,
  PlatformToolNetworkPolicySchema,
  PlatformToolVersionSchema,
  PlatformModelDeploymentSchema,
  PlatformModelProviderSchema,
  ProviderSecretMutationResponseSchema,
  PublishAgentDraftRequestSchema,
  ReplaceAgentDraftRequestSchema,
  RotateProviderSecretRequestSchema,
  SemanticVersionSchema,
  SetWorkspaceDefaultModelRequestSchema,
  ToolConnectionSecretMutationResponseSchema,
  ToolConnectionSecretWriteRequestSchema,
  UpdatePlatformToolDefinitionRequestSchema,
  UpdatePlatformToolNetworkPolicyRequestSchema,
  UpdatePlatformToolVersionStatusRequestSchema,
  UpdatePlatformModelDeploymentRequestSchema,
  UpdatePlatformModelProviderRequestSchema,
  UpdateAgentRequestSchema,
  UpdateWorkspaceToolConnectionRequestSchema,
  UpdateWorkspaceToolGrantRequestSchema,
  UpdateWorkspaceModelDeploymentRequestSchema,
  UpdateWorkspaceModelGrantRequestSchema,
  UpdateWorkspaceModelProviderRequestSchema,
  WorkspaceToolConnectionSchema,
  WorkspaceToolGrantSchema,
  ToolGatewayBadRequestErrorSchema,
  ToolGatewayConflictErrorSchema,
  ToolGatewayForbiddenErrorSchema,
  ToolGatewayInternalErrorSchema,
  ToolGatewayNotFoundErrorSchema,
  ToolGatewayTooManyRequestsErrorSchema,
  ToolGatewayUnauthorizedErrorSchema,
  WorkspaceDefaultModelSchema,
  WorkspaceModelDeploymentSchema,
  WorkspaceModelGrantSchema,
  WorkspaceModelProviderSchema,
} from "./ai/index.js";
import {
  AuthenticatedLoginInternalSchema, AuthenticatedLoginResponseSchema,
  AuthLoginInternalResponseSchema, AuthLoginResponseSchema, AuthSessionDeviceSchema,
  ContextSelectionOptionSchema, LoginRequestSchema, PrincipalSessionSchema,
  RefreshSessionInternalSchema, RefreshSessionResponseSchema, SelectContextRequestSchema,
} from "./auth.js";
import {
  AcceptInviteRequestSchema, AuditLogPageSchema, AuditLogQuerySchema, CreatedIntegrationTokenSchema,
  CompleteFileObjectRequestSchema, CreateFileObjectRequestSchema, CreateTicketRequestSchema, EmailTemplateRequestSchema, IntegrationTokenCapabilitiesSchema,
  IntegrationTokenSchema, InviteRequestSchema, LoginAuditLogItemSchema, OnboardingRequestSchema,
  OperationAuditLogItemSchema, PlatformMemberInvitationSchema, PlatformMemberRequestSchema, RealtimeTicketResponseSchema,
  PublicBootstrapSchema, ResumeOnboardingRequestSchema,
  ReplaceRolePermissionsRequestSchema, RoleRequestSchema, SaveSettingsRequestSchema,
  SendTicketMessageRequestSchema, SmtpRequestSchema, UpdateRuntimePreferencesRequestSchema,
  UpdateUserRequestSchema, UserNotificationRequestSchema, ValidateInviteRequestSchema,
  WorkspaceApplicationApprovalSchema, WorkspaceApplicationRequestSchema,
  WorkspaceApplicationSubmissionSchema, WorkspaceLoginContextSchema, WorkspaceOwnerActivationSchema,
} from "./domains.js";
import {
  AllowedSchema, EffectiveWorkspaceSettingSchema, EmailLogSchema, EmailTemplateSchema, FileUploadResponseSchema,
  FileObjectSchema, FileUploadIntentSchema, IdentifierSchema, InviteSchema, OkSchema, PermissionCatalogSchema, PlatformMemberSchema, UuidSchema,
  PlatformTicketSchema, RolePermissionSchema, RoleSchema, SmtpConfigSchema, SuccessSchema, SystemSettingSchema,
  TicketMessageSchema, TicketSchema, TicketStatusSchema, UserNotificationSchema,
  UserNotificationStatusSchema, UserSchema, WorkspaceApplicationSchema, WorkspaceMemberSchema,
  WorkspaceSchema, WorkspaceStatusSchema,
} from "./models.js";

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ApiContract = {
  id: string;
  method: ApiMethod;
  path: string;
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  responses: Readonly<Record<number, ZodType | null>>;
  errorResponses?: Readonly<Record<number, ZodType>>;
  browserResponses?: Readonly<Record<number, ZodType | null>>;
  binary?: boolean;
  multipart?: boolean;
};

type SchemaInput<T> = T extends ZodType ? z.input<T> : never;
type ResponseSchemas<C extends ApiContract> = C["browserResponses"] extends Readonly<
  Record<number, ZodType | null>
>
  ? C["browserResponses"]
  : C["responses"];

export type ContractRequest<C extends ApiContract> = {
  body?: SchemaInput<C["body"]>;
  params?: SchemaInput<C["params"]>;
  query?: SchemaInput<C["query"]>;
};

export type ContractResponse<C extends ApiContract> =
  | z.output<Extract<ResponseSchemas<C>[keyof ResponseSchemas<C>], ZodType>>
  | (null extends ResponseSchemas<C>[keyof ResponseSchemas<C>] ? void : never);

function defineContract<const T extends ApiContract>(contract: T): Readonly<T> {
  return Object.freeze(contract);
}
const idParams = (name: string) => z.strictObject({ [name]: IdentifierSchema });
const tokenBody = z.strictObject({ token: z.string().min(1) });
const emptyBody = z.strictObject({});
const previewResponse = z.strictObject({ html: z.string(), subject: z.string() });
const noContent = { 204: null } as const;
const toolGatewayAccessErrors = {
  401: ToolGatewayUnauthorizedErrorSchema,
  403: ToolGatewayForbiddenErrorSchema,
  429: ToolGatewayTooManyRequestsErrorSchema,
  500: ToolGatewayInternalErrorSchema,
} as const;
const toolGatewayLookupErrors = {
  ...toolGatewayAccessErrors,
  404: ToolGatewayNotFoundErrorSchema,
} as const;
const toolGatewayMutationErrors = {
  400: ToolGatewayBadRequestErrorSchema,
  ...toolGatewayLookupErrors,
  409: ToolGatewayConflictErrorSchema,
} as const;
const agentCatalogErrors = {
  400: AgentCatalogBadRequestErrorSchema,
  404: AgentCatalogNotFoundErrorSchema,
  409: AgentCatalogConflictErrorSchema,
} as const;

export const adminContracts = {
  bootstrap: defineContract({ id: "bootstrap.get", method: "GET", path: "/bootstrap", responses: { 200: PublicBootstrapSchema } }),
  onboarding: defineContract({ id: "onboarding.create", method: "POST", path: "/onboarding", body: OnboardingRequestSchema, responses: { 201: AuthenticatedLoginInternalSchema }, browserResponses: { 201: AuthenticatedLoginResponseSchema } }),
  onboardingResume: defineContract({ id: "onboarding.resume", method: "POST", path: "/onboarding/resume", body: ResumeOnboardingRequestSchema, responses: { 201: AuthenticatedLoginInternalSchema }, browserResponses: { 201: AuthenticatedLoginResponseSchema } }),
  authWorkspaceContext: defineContract({ id: "auth.workspaceContext", method: "POST", path: "/auth/workspace-context", body: z.strictObject({ workspace: z.string().optional() }).nullable(), responses: { 201: WorkspaceLoginContextSchema } }),
  authLogin: defineContract({ id: "auth.login", method: "POST", path: "/auth/login", body: LoginRequestSchema, responses: { 201: AuthLoginInternalResponseSchema }, browserResponses: { 201: AuthLoginResponseSchema } }),
  authSelectContext: defineContract({ id: "auth.selectContext", method: "POST", path: "/auth/select-context", body: SelectContextRequestSchema, responses: { 201: AuthenticatedLoginInternalSchema }, browserResponses: { 201: AuthenticatedLoginResponseSchema } }),
  authContexts: defineContract({ id: "auth.contexts", method: "GET", path: "/auth/contexts", responses: { 200: z.array(ContextSelectionOptionSchema) } }),
  authSwitchContext: defineContract({ id: "auth.switchContext", method: "POST", path: "/auth/switch-context", body: SelectContextRequestSchema.pick({ contextType: true, membershipId: true }), responses: { 201: AuthenticatedLoginInternalSchema }, browserResponses: { 201: AuthenticatedLoginResponseSchema } }),
  authRefresh: defineContract({ id: "auth.refresh", method: "POST", path: "/auth/refresh", responses: { 201: RefreshSessionInternalSchema }, browserResponses: { 200: RefreshSessionResponseSchema, 201: RefreshSessionResponseSchema } }),
  authLogout: defineContract({ id: "auth.logout", method: "POST", path: "/auth/logout", responses: noContent }),
  authSessions: defineContract({ id: "auth.sessions.list", method: "GET", path: "/auth/sessions", responses: { 200: z.array(AuthSessionDeviceSchema) } }),
  authRevokeSession: defineContract({ id: "auth.sessions.revoke", method: "DELETE", path: "/auth/sessions/:sessionId", params: idParams("sessionId"), responses: noContent }),
  authDeleteSession: defineContract({ id: "auth.sessions.delete", method: "DELETE", path: "/auth/sessions/:sessionId/record", params: idParams("sessionId"), responses: noContent }),
  authRevokeOthers: defineContract({ id: "auth.sessions.revokeOthers", method: "DELETE", path: "/auth/sessions", responses: noContent }),
  authRealtimeTicket: defineContract({ id: "auth.realtimeTicket", method: "POST", path: "/auth/realtime-ticket", responses: { 201: RealtimeTicketResponseSchema } }),
  authAuthenticated: defineContract({ id: "auth.authenticated", method: "GET", path: "/auth/authenticated", responses: { 200: z.boolean() } }),
  authMe: defineContract({ id: "auth.me", method: "GET", path: "/auth/me", responses: { 200: PrincipalSessionSchema } }),
  requestPassword: defineContract({ id: "auth.requestPassword", method: "POST", path: "/auth/request-password", body: z.strictObject({ email: z.email(), workspaceSlug: z.string().optional() }), responses: { 201: SuccessSchema } }),
  resetPassword: defineContract({ id: "auth.resetPassword", method: "POST", path: "/auth/reset-password", body: z.strictObject({ confirmPassword: z.string().optional(), email: z.email().optional(), password: z.string().min(1), token: z.string().min(1), workspaceSlug: z.string().optional() }), responses: { 201: SuccessSchema } }),

  workspaceApplicationCreate: defineContract({ id: "workspaceApplications.create", method: "POST", path: "/workspace-applications", body: WorkspaceApplicationRequestSchema, responses: { 201: WorkspaceApplicationSubmissionSchema } }),
  workspaceApplicationVerify: defineContract({ id: "workspaceApplications.verify", method: "POST", path: "/workspace-applications/:applicationId/verify", params: idParams("applicationId"), body: tokenBody, responses: { 201: WorkspaceApplicationSchema } }),
  workspaceApplicationCancel: defineContract({ id: "workspaceApplications.cancel", method: "POST", path: "/workspace-applications/:applicationId/cancel", params: idParams("applicationId"), body: tokenBody, responses: { 201: WorkspaceApplicationSchema } }),
  workspaceOwnerActivate: defineContract({ id: "workspaceApplications.activateOwner", method: "POST", path: "/workspace-applications/activate-owner", body: z.strictObject({ displayName: z.string().min(1), password: z.string().min(1), token: z.string().min(1) }), responses: { 201: WorkspaceOwnerActivationSchema } }),
  platformWorkspaceApplications: defineContract({ id: "platform.workspaceApplications.list", method: "GET", path: "/platform/workspace-applications", responses: { 200: z.array(WorkspaceApplicationSchema) } }),
  platformWorkspaces: defineContract({ id: "platform.workspaces.list", method: "GET", path: "/platform/workspaces", responses: { 200: z.array(WorkspaceSchema) } }),
  platformWorkspaceStatus: defineContract({ id: "platform.workspaces.status", method: "PATCH", path: "/platform/workspaces/:workspaceId/status", params: idParams("workspaceId"), body: z.strictObject({ status: WorkspaceStatusSchema.exclude(["provisioning"]) }), responses: { 200: WorkspaceSchema } }),
  platformWorkspaceApprove: defineContract({ id: "platform.workspaceApplications.approve", method: "POST", path: "/platform/workspace-applications/:applicationId/approve", params: idParams("applicationId"), body: z.strictObject({ note: z.string().nullable().optional() }), responses: { 201: WorkspaceApplicationApprovalSchema } }),
  platformWorkspaceReject: defineContract({ id: "platform.workspaceApplications.reject", method: "POST", path: "/platform/workspace-applications/:applicationId/reject", params: idParams("applicationId"), body: z.strictObject({ note: z.string().nullable().optional() }), responses: { 201: WorkspaceApplicationSchema } }),
  platformTickets: defineContract({ id: "platform.tickets.list", method: "GET", path: "/platform/tickets", query: z.strictObject({ status: TicketStatusSchema.optional() }), responses: { 200: z.array(PlatformTicketSchema) } }),
  platformTicketGet: defineContract({ id: "platform.tickets.get", method: "GET", path: "/platform/tickets/:ticketId", params: idParams("ticketId"), responses: { 200: PlatformTicketSchema } }),
  platformTicketMessages: defineContract({ id: "platform.tickets.messages.list", method: "GET", path: "/platform/tickets/:ticketId/messages", params: idParams("ticketId"), responses: { 200: z.array(TicketMessageSchema) } }),
  platformTicketMessageSend: defineContract({ id: "platform.tickets.messages.send", method: "POST", path: "/platform/tickets/:ticketId/messages", params: idParams("ticketId"), body: SendTicketMessageRequestSchema, responses: { 201: TicketMessageSchema } }),
  platformTicketClose: defineContract({ id: "platform.tickets.close", method: "PATCH", path: "/platform/tickets/:ticketId/close", params: idParams("ticketId"), responses: { 200: PlatformTicketSchema } }),
  platformTicketRead: defineContract({ id: "platform.tickets.read", method: "PATCH", path: "/platform/tickets/:ticketId/read", params: idParams("ticketId"), responses: { 200: OkSchema } }),
  analyticsSupportTicketsSchema: defineContract({ id: "analytics.supportTickets.schema", method: "GET", path: "/analytics/sources/support.tickets/schema", responses: { 200: AnalyticsDatasetSchema } }),
  analyticsQuery: defineContract({ id: "analytics.query", method: "POST", path: "/analytics/query", body: AnalysisQuerySchema, responses: { 200: DatasetResultSchema } }),
  analyticsViews: defineContract({ id: "analytics.views.list", method: "GET", path: "/analytics/views", responses: { 200: AnalysisViewListSchema } }),
  analyticsViewGet: defineContract({ id: "analytics.views.get", method: "GET", path: "/analytics/views/:viewId", params: AnalysisViewParamsSchema, responses: { 200: AnalysisViewSchema } }),
  analyticsViewCreate: defineContract({ id: "analytics.views.create", method: "POST", path: "/analytics/views", body: CreateAnalysisViewRequestSchema, responses: { 201: AnalysisViewSchema } }),
  analyticsViewUpdate: defineContract({ id: "analytics.views.update", method: "PATCH", path: "/analytics/views/:viewId", params: AnalysisViewParamsSchema, body: UpdateAnalysisViewRequestSchema, responses: { 200: AnalysisViewSchema } }),
  analyticsViewDelete: defineContract({ id: "analytics.views.delete", method: "DELETE", path: "/analytics/views/:viewId", params: AnalysisViewParamsSchema, body: DeleteAnalysisViewRequestSchema, responses: noContent }),
  agents: defineContract({ id: "agents.list", method: "GET", path: "/agents", responses: { 200: z.array(AgentSchema) }, errorResponses: agentCatalogErrors }),
  agentCreate: defineContract({ id: "agents.create", method: "POST", path: "/agents", body: CreateAgentRequestSchema, responses: { 201: AgentSchema }, errorResponses: agentCatalogErrors }),
  agentGet: defineContract({ id: "agents.get", method: "GET", path: "/agents/:agentId", params: z.strictObject({ agentId: UuidSchema }), responses: { 200: AgentSchema }, errorResponses: agentCatalogErrors }),
  agentUpdate: defineContract({ id: "agents.update", method: "PATCH", path: "/agents/:agentId", params: z.strictObject({ agentId: UuidSchema }), body: UpdateAgentRequestSchema, responses: { 200: AgentSchema }, errorResponses: agentCatalogErrors }),
  agentDraftGet: defineContract({ id: "agents.draft.get", method: "GET", path: "/agents/:agentId/draft", params: z.strictObject({ agentId: UuidSchema }), responses: { 200: AgentDraftSchema }, errorResponses: agentCatalogErrors }),
  agentDraftReplace: defineContract({ id: "agents.draft.replace", method: "PUT", path: "/agents/:agentId/draft", params: z.strictObject({ agentId: UuidSchema }), body: ReplaceAgentDraftRequestSchema, responses: { 200: AgentDraftSchema }, errorResponses: agentCatalogErrors }),
  agentVersions: defineContract({ id: "agents.versions.list", method: "GET", path: "/agents/:agentId/versions", params: z.strictObject({ agentId: UuidSchema }), responses: { 200: z.array(AgentVersionSummarySchema) }, errorResponses: agentCatalogErrors }),
  agentVersionPublish: defineContract({ id: "agents.versions.publish", method: "POST", path: "/agents/:agentId/versions", params: z.strictObject({ agentId: UuidSchema }), body: PublishAgentDraftRequestSchema, responses: { 201: AgentVersionSchema }, errorResponses: agentCatalogErrors }),
  agentVersionGet: defineContract({ id: "agents.versions.get", method: "GET", path: "/agents/:agentId/versions/:version", params: z.strictObject({ agentId: UuidSchema, version: z.coerce.number().int().min(1) }), responses: { 200: AgentVersionSchema }, errorResponses: agentCatalogErrors }),
  platformAiProviders: defineContract({ id: "platform.ai.providers.list", method: "GET", path: "/platform/ai/providers", responses: { 200: z.array(PlatformModelProviderSchema) } }),
  platformAiProviderCreate: defineContract({ id: "platform.ai.providers.create", method: "POST", path: "/platform/ai/providers", body: CreatePlatformModelProviderRequestSchema, responses: { 201: PlatformModelProviderSchema } }),
  platformAiProviderUpdate: defineContract({ id: "platform.ai.providers.update", method: "PATCH", path: "/platform/ai/providers/:providerId", params: z.strictObject({ providerId: UuidSchema }), body: UpdatePlatformModelProviderRequestSchema, responses: { 200: PlatformModelProviderSchema } }),
  platformAiProviderSecret: defineContract({ id: "platform.ai.providers.secret.rotate", method: "POST", path: "/platform/ai/providers/:providerId/secret", params: z.strictObject({ providerId: UuidSchema }), body: RotateProviderSecretRequestSchema, responses: { 200: ProviderSecretMutationResponseSchema } }),
  platformAiDeployments: defineContract({ id: "platform.ai.deployments.list", method: "GET", path: "/platform/ai/providers/:providerId/deployments", params: z.strictObject({ providerId: UuidSchema }), responses: { 200: z.array(PlatformModelDeploymentSchema) } }),
  platformAiDeploymentCreate: defineContract({ id: "platform.ai.deployments.create", method: "POST", path: "/platform/ai/providers/:providerId/deployments", params: z.strictObject({ providerId: UuidSchema }), body: CreatePlatformModelDeploymentRequestSchema, responses: { 201: PlatformModelDeploymentSchema } }),
  platformAiDeploymentUpdate: defineContract({ id: "platform.ai.deployments.update", method: "PATCH", path: "/platform/ai/deployments/:deploymentId", params: z.strictObject({ deploymentId: UuidSchema }), body: UpdatePlatformModelDeploymentRequestSchema, responses: { 200: PlatformModelDeploymentSchema } }),
  platformAiWorkspaceGrants: defineContract({ id: "platform.ai.workspaceGrants.list", method: "GET", path: "/platform/ai/workspaces/:workspaceId/grants", params: z.strictObject({ workspaceId: UuidSchema }), responses: { 200: z.array(WorkspaceModelGrantSchema) } }),
  platformAiWorkspaceGrantCreate: defineContract({ id: "platform.ai.workspaceGrants.create", method: "POST", path: "/platform/ai/workspaces/:workspaceId/grants", params: z.strictObject({ workspaceId: UuidSchema }), body: CreateWorkspaceModelGrantRequestSchema, responses: { 201: WorkspaceModelGrantSchema } }),
  platformAiWorkspaceGrantUpdate: defineContract({ id: "platform.ai.workspaceGrants.update", method: "PATCH", path: "/platform/ai/workspaces/:workspaceId/grants/:grantId", params: z.strictObject({ workspaceId: UuidSchema, grantId: UuidSchema }), body: UpdateWorkspaceModelGrantRequestSchema, responses: { 200: WorkspaceModelGrantSchema } }),
  workspaceAiProviders: defineContract({ id: "workspace.ai.providers.list", method: "GET", path: "/workspace/ai/providers", responses: { 200: z.array(WorkspaceModelProviderSchema) } }),
  workspaceAiProviderCreate: defineContract({ id: "workspace.ai.providers.create", method: "POST", path: "/workspace/ai/providers", body: CreateWorkspaceModelProviderRequestSchema, responses: { 201: WorkspaceModelProviderSchema } }),
  workspaceAiProviderUpdate: defineContract({ id: "workspace.ai.providers.update", method: "PATCH", path: "/workspace/ai/providers/:providerId", params: z.strictObject({ providerId: UuidSchema }), body: UpdateWorkspaceModelProviderRequestSchema, responses: { 200: WorkspaceModelProviderSchema } }),
  workspaceAiProviderSecret: defineContract({ id: "workspace.ai.providers.secret.rotate", method: "POST", path: "/workspace/ai/providers/:providerId/secret", params: z.strictObject({ providerId: UuidSchema }), body: RotateProviderSecretRequestSchema, responses: { 200: ProviderSecretMutationResponseSchema } }),
  workspaceAiDeployments: defineContract({ id: "workspace.ai.deployments.list", method: "GET", path: "/workspace/ai/providers/:providerId/deployments", params: z.strictObject({ providerId: UuidSchema }), responses: { 200: z.array(WorkspaceModelDeploymentSchema) } }),
  workspaceAiDeploymentCreate: defineContract({ id: "workspace.ai.deployments.create", method: "POST", path: "/workspace/ai/providers/:providerId/deployments", params: z.strictObject({ providerId: UuidSchema }), body: CreateWorkspaceModelDeploymentRequestSchema, responses: { 201: WorkspaceModelDeploymentSchema } }),
  workspaceAiDeploymentUpdate: defineContract({ id: "workspace.ai.deployments.update", method: "PATCH", path: "/workspace/ai/deployments/:deploymentId", params: z.strictObject({ deploymentId: UuidSchema }), body: UpdateWorkspaceModelDeploymentRequestSchema, responses: { 200: WorkspaceModelDeploymentSchema } }),
  workspaceAiGrants: defineContract({ id: "workspace.ai.grants.list", method: "GET", path: "/workspace/ai/grants", responses: { 200: z.array(WorkspaceModelGrantSchema) } }),
  workspaceAiDefaults: defineContract({ id: "workspace.ai.defaults.list", method: "GET", path: "/workspace/ai/defaults", responses: { 200: z.array(WorkspaceDefaultModelSchema) } }),
  workspaceAiDefaultSet: defineContract({ id: "workspace.ai.defaults.set", method: "PUT", path: "/workspace/ai/defaults", body: SetWorkspaceDefaultModelRequestSchema, responses: { 200: WorkspaceDefaultModelSchema } }),
  platformAiToolDefinitions: defineContract({ id: "platform.ai.tools.list", method: "GET", path: "/platform/ai/tools", responses: { 200: z.array(PlatformToolDefinitionSchema) }, errorResponses: toolGatewayAccessErrors }),
  platformAiToolDefinitionCreate: defineContract({ id: "platform.ai.tools.create", method: "POST", path: "/platform/ai/tools", body: CreatePlatformToolDefinitionRequestSchema, responses: { 201: PlatformToolDefinitionSchema }, errorResponses: toolGatewayMutationErrors }),
  platformAiToolDefinitionUpdate: defineContract({ id: "platform.ai.tools.update", method: "PATCH", path: "/platform/ai/tools/:toolDefinitionId", params: z.strictObject({ toolDefinitionId: UuidSchema }), body: UpdatePlatformToolDefinitionRequestSchema, responses: { 200: PlatformToolDefinitionSchema }, errorResponses: toolGatewayMutationErrors }),
  platformAiToolVersions: defineContract({ id: "platform.ai.toolVersions.list", method: "GET", path: "/platform/ai/tools/:toolDefinitionId/versions", params: z.strictObject({ toolDefinitionId: UuidSchema }), responses: { 200: z.array(PlatformToolVersionSchema) }, errorResponses: toolGatewayLookupErrors }),
  platformAiToolVersionCreate: defineContract({ id: "platform.ai.toolVersions.create", method: "POST", path: "/platform/ai/tools/:toolDefinitionId/versions", params: z.strictObject({ toolDefinitionId: UuidSchema }), body: CreatePlatformToolVersionRequestSchema, responses: { 201: PlatformToolVersionSchema }, errorResponses: toolGatewayMutationErrors }),
  platformAiToolVersionStatusUpdate: defineContract({ id: "platform.ai.toolVersions.status.update", method: "PATCH", path: "/platform/ai/tools/:toolDefinitionId/versions/:version", params: z.strictObject({ toolDefinitionId: UuidSchema, version: SemanticVersionSchema }), body: UpdatePlatformToolVersionStatusRequestSchema, responses: { 200: PlatformToolVersionSchema }, errorResponses: toolGatewayMutationErrors }),
  platformAiToolNetworkPolicies: defineContract({ id: "platform.ai.toolNetworkPolicies.list", method: "GET", path: "/platform/ai/tools/network-policies", responses: { 200: z.array(PlatformToolNetworkPolicySchema) }, errorResponses: toolGatewayAccessErrors }),
  platformAiToolNetworkPolicyCreate: defineContract({ id: "platform.ai.toolNetworkPolicies.create", method: "POST", path: "/platform/ai/tools/network-policies", body: CreatePlatformToolNetworkPolicyRequestSchema, responses: { 201: PlatformToolNetworkPolicySchema }, errorResponses: toolGatewayMutationErrors }),
  platformAiToolNetworkPolicyUpdate: defineContract({ id: "platform.ai.toolNetworkPolicies.update", method: "PATCH", path: "/platform/ai/tools/network-policies/:networkPolicyId", params: z.strictObject({ networkPolicyId: UuidSchema }), body: UpdatePlatformToolNetworkPolicyRequestSchema, responses: { 200: PlatformToolNetworkPolicySchema }, errorResponses: toolGatewayMutationErrors }),
  workspaceAiToolConnections: defineContract({ id: "workspace.ai.toolConnections.list", method: "GET", path: "/workspace/ai/tools/connections", responses: { 200: z.array(WorkspaceToolConnectionSchema) }, errorResponses: toolGatewayAccessErrors }),
  workspaceAiToolConnectionCreate: defineContract({ id: "workspace.ai.toolConnections.create", method: "POST", path: "/workspace/ai/tools/connections", body: CreateWorkspaceToolConnectionRequestSchema, responses: { 201: WorkspaceToolConnectionSchema }, errorResponses: toolGatewayMutationErrors }),
  workspaceAiToolConnectionUpdate: defineContract({ id: "workspace.ai.toolConnections.update", method: "PATCH", path: "/workspace/ai/tools/connections/:connectionId", params: z.strictObject({ connectionId: UuidSchema }), body: UpdateWorkspaceToolConnectionRequestSchema, responses: { 200: WorkspaceToolConnectionSchema }, errorResponses: toolGatewayMutationErrors }),
  workspaceAiToolConnectionSecret: defineContract({ id: "workspace.ai.toolConnections.secret.rotate", method: "POST", path: "/workspace/ai/tools/connections/:connectionId/secret", params: z.strictObject({ connectionId: UuidSchema }), body: ToolConnectionSecretWriteRequestSchema, responses: { 200: ToolConnectionSecretMutationResponseSchema }, errorResponses: toolGatewayMutationErrors }),
  workspaceAiToolGrants: defineContract({ id: "workspace.ai.toolGrants.list", method: "GET", path: "/workspace/ai/tools/grants", responses: { 200: z.array(WorkspaceToolGrantSchema) }, errorResponses: toolGatewayAccessErrors }),
  workspaceAiToolGrantCreate: defineContract({ id: "workspace.ai.toolGrants.create", method: "POST", path: "/workspace/ai/tools/grants", body: CreateWorkspaceToolGrantRequestSchema, responses: { 201: WorkspaceToolGrantSchema }, errorResponses: toolGatewayMutationErrors }),
  workspaceAiToolGrantUpdate: defineContract({ id: "workspace.ai.toolGrants.update", method: "PATCH", path: "/workspace/ai/tools/grants/:grantId", params: z.strictObject({ grantId: UuidSchema }), body: UpdateWorkspaceToolGrantRequestSchema, responses: { 200: WorkspaceToolGrantSchema }, errorResponses: toolGatewayMutationErrors }),
  workspaceAiToolGrantConnectionBind: defineContract({ id: "workspace.ai.toolGrants.connection.bind", method: "PUT", path: "/workspace/ai/tools/grants/:grantId/connection", params: z.strictObject({ grantId: UuidSchema }), body: BindWorkspaceToolGrantConnectionRequestSchema, responses: { 200: WorkspaceToolGrantSchema }, errorResponses: toolGatewayMutationErrors }),
  workspaceGet: defineContract({ id: "workspace.get", method: "GET", path: "/workspace", responses: { 200: WorkspaceSchema } }),
  workspaceConsole: defineContract({ id: "workspace.console", method: "GET", path: "/workspace/console-capability", responses: { 200: AllowedSchema } }),
  workspaceUpdate: defineContract({ id: "workspace.update", method: "PATCH", path: "/workspace", body: z.strictObject({ name: z.string().min(1).optional() }), responses: { 200: WorkspaceSchema } }),

  workspaceMembers: defineContract({ id: "workspace.members.list", method: "GET", path: "/workspace/members", responses: { 200: z.array(WorkspaceMemberSchema) } }),
  workspaceMemberSearch: defineContract({ id: "workspace.members.search", method: "GET", path: "/workspace/members/search", query: z.strictObject({ search: z.string().optional() }), responses: { 200: z.array(WorkspaceMemberSchema) } }),
  workspaceMemberRole: defineContract({ id: "workspace.members.role", method: "PUT", path: "/workspace/members/:membershipId/role", params: idParams("membershipId"), body: z.strictObject({ roleId: IdentifierSchema }), responses: { 200: WorkspaceMemberSchema } }),
  workspaceMemberStatus: defineContract({ id: "workspace.members.status", method: "PATCH", path: "/workspace/members/:membershipId/status", params: idParams("membershipId"), body: z.strictObject({ roleId: IdentifierSchema.optional(), status: z.enum(["active", "disabled", "removed"]) }), responses: { 200: WorkspaceMemberSchema } }),
  workspaceMemberRemove: defineContract({ id: "workspace.members.remove", method: "DELETE", path: "/workspace/members/:membershipId", params: idParams("membershipId"), responses: noContent }),
  accountGet: defineContract({ id: "account.get", method: "GET", path: "/account", responses: { 200: UserSchema } }),
  accountUpdate: defineContract({ id: "account.update", method: "PATCH", path: "/account", body: UpdateUserRequestSchema, responses: { 200: UserSchema } }),
  accountPreferences: defineContract({ id: "account.preferences", method: "PATCH", path: "/account/preferences", body: UpdateRuntimePreferencesRequestSchema, responses: { 200: UserSchema } }),
  accountPassword: defineContract({ id: "account.password", method: "PATCH", path: "/account/password", body: z.strictObject({ currentPassword: z.string().min(1), password: z.string().min(1) }), responses: { 200: z.strictObject({ reauthenticationRequired: z.literal(true), success: z.literal(true) }) } }),

  workspaceRoles: defineContract({ id: "workspace.roles.list", method: "GET", path: "/workspace/roles", responses: { 200: z.array(RoleSchema) } }),
  workspaceRoleCreate: defineContract({ id: "workspace.roles.create", method: "POST", path: "/workspace/roles", body: RoleRequestSchema, responses: { 201: RoleSchema } }),
  workspaceRoleUpdate: defineContract({ id: "workspace.roles.update", method: "PATCH", path: "/workspace/roles/:roleId", params: idParams("roleId"), body: RoleRequestSchema, responses: { 200: RoleSchema } }),
  workspaceRolePermissions: defineContract({ id: "workspace.roles.permissions", method: "PUT", path: "/workspace/roles/:roleId/permissions", params: idParams("roleId"), body: ReplaceRolePermissionsRequestSchema, responses: { 200: RoleSchema } }),
  workspaceRoleDelete: defineContract({ id: "workspace.roles.delete", method: "DELETE", path: "/workspace/roles/:roleId", params: idParams("roleId"), responses: { 200: SuccessSchema, 204: null } }),
  workspacePermissionCatalog: defineContract({ id: "workspace.permissions.catalog", method: "GET", path: "/workspace/permissions/catalog", responses: { 200: PermissionCatalogSchema } }),
  platformPermissionCatalog: defineContract({ id: "platform.permissions.catalog", method: "GET", path: "/platform/permissions/catalog", responses: { 200: PermissionCatalogSchema } }),

  platformMembers: defineContract({ id: "platform.members.list", method: "GET", path: "/platform/members", responses: { 200: z.array(PlatformMemberSchema) } }),
  platformMemberCreate: defineContract({ id: "platform.members.create", method: "POST", path: "/platform/members", body: PlatformMemberRequestSchema, responses: { 201: z.union([PlatformMemberSchema, PlatformMemberInvitationSchema]) } }),
  platformMemberUpdate: defineContract({ id: "platform.members.update", method: "PATCH", path: "/platform/members/:memberId", params: idParams("memberId"), body: PlatformMemberRequestSchema, responses: { 200: PlatformMemberSchema } }),
  platformMemberDelete: defineContract({ id: "platform.members.delete", method: "DELETE", path: "/platform/members/:memberId", params: idParams("memberId"), responses: noContent }),
  platformRoles: defineContract({ id: "platform.roles.list", method: "GET", path: "/platform/roles", responses: { 200: z.array(RoleSchema) } }),
  platformRoleCreate: defineContract({ id: "platform.roles.create", method: "POST", path: "/platform/roles", body: RoleRequestSchema, responses: { 201: RoleSchema } }),
  platformRoleUpdate: defineContract({ id: "platform.roles.update", method: "PATCH", path: "/platform/roles/:roleId", params: idParams("roleId"), body: RoleRequestSchema, responses: { 200: RoleSchema } }),
  platformRolePermissions: defineContract({ id: "platform.roles.permissions", method: "PUT", path: "/platform/roles/:roleId/permissions", params: idParams("roleId"), body: ReplaceRolePermissionsRequestSchema, responses: { 200: z.array(RolePermissionSchema) } }),
  platformRoleDelete: defineContract({ id: "platform.roles.delete", method: "DELETE", path: "/platform/roles/:roleId", params: idParams("roleId"), responses: { 200: null, 204: null } }),

  invites: defineContract({ id: "invites.list", method: "GET", path: "/invites", responses: { 200: z.array(InviteSchema) } }),
  inviteCreate: defineContract({ id: "invites.create", method: "POST", path: "/invites", body: InviteRequestSchema, responses: { 201: InviteSchema } }),
  inviteResend: defineContract({ id: "invites.resend", method: "POST", path: "/invites/:inviteId/resend", params: idParams("inviteId"), responses: { 201: InviteSchema } }),
  inviteRevoke: defineContract({ id: "invites.revoke", method: "DELETE", path: "/invites/:inviteId", params: idParams("inviteId"), responses: noContent }),
  inviteValidate: defineContract({ id: "invites.validate", method: "POST", path: "/invites/validate", body: ValidateInviteRequestSchema, responses: { 201: InviteSchema } }),
  inviteAccept: defineContract({ id: "invites.accept", method: "POST", path: "/invites/accept", body: AcceptInviteRequestSchema, responses: { 201: InviteSchema } }),

  platformSettings: defineContract({ id: "platform.settings.list", method: "GET", path: "/platform/settings", responses: { 200: z.array(SystemSettingSchema) } }),
  platformSettingsSave: defineContract({ id: "platform.settings.save", method: "PUT", path: "/platform/settings", body: SaveSettingsRequestSchema, responses: { 200: z.array(SystemSettingSchema) } }),
  workspaceSettings: defineContract({ id: "workspace.settings.list", method: "GET", path: "/workspace/settings", responses: { 200: z.array(EffectiveWorkspaceSettingSchema) } }),
  workspaceSettingsSave: defineContract({ id: "workspace.settings.save", method: "PUT", path: "/workspace/settings", body: SaveSettingsRequestSchema, responses: { 200: z.array(EffectiveWorkspaceSettingSchema) } }),

  integrationCapabilities: defineContract({ id: "integrations.capabilities", method: "GET", path: "/account/integration-tokens/capabilities", responses: { 200: IntegrationTokenCapabilitiesSchema } }),
  integrationTokens: defineContract({ id: "integrations.list", method: "GET", path: "/account/integration-tokens", responses: { 200: z.array(IntegrationTokenSchema) } }),
  integrationTokenCreate: defineContract({ id: "integrations.create", method: "POST", path: "/account/integration-tokens", body: z.strictObject({ expiresAt: z.iso.datetime({ offset: true }).optional(), note: z.string().nullable().optional(), permissions: z.array(z.string()) }), responses: { 201: CreatedIntegrationTokenSchema } }),
  integrationTokenRevoke: defineContract({ id: "integrations.revoke", method: "DELETE", path: "/account/integration-tokens/:tokenId", params: idParams("tokenId"), responses: noContent }),

  workspaceLoginAudit: defineContract({ id: "workspace.audit.login", method: "GET", path: "/workspace/audit/login-logs", query: AuditLogQuerySchema, responses: { 200: AuditLogPageSchema(LoginAuditLogItemSchema) } }),
  workspaceOperationAudit: defineContract({ id: "workspace.audit.operation", method: "GET", path: "/workspace/audit/operation-logs", query: AuditLogQuerySchema, responses: { 200: AuditLogPageSchema(OperationAuditLogItemSchema) } }),
  platformLoginAudit: defineContract({ id: "platform.audit.login", method: "GET", path: "/platform/audit/login-logs", query: AuditLogQuerySchema, responses: { 200: AuditLogPageSchema(LoginAuditLogItemSchema) } }),
  platformOperationAudit: defineContract({ id: "platform.audit.operation", method: "GET", path: "/platform/audit/operation-logs", query: AuditLogQuerySchema, responses: { 200: AuditLogPageSchema(OperationAuditLogItemSchema) } }),

  notifications: defineContract({ id: "notifications.list", method: "GET", path: "/notifications", query: z.strictObject({ status: UserNotificationStatusSchema.optional(), take: z.coerce.number().int().min(1).max(200).optional() }), responses: { 200: z.array(UserNotificationSchema) } }),
  notificationUnreadCount: defineContract({ id: "notifications.unreadCount", method: "GET", path: "/notifications/unread-count", responses: { 200: z.strictObject({ count: z.number().int().nonnegative() }) } }),
  notificationSend: defineContract({ id: "notifications.send", method: "POST", path: "/notifications", body: UserNotificationRequestSchema, responses: { 201: z.array(UserNotificationSchema) } }),
  notificationRead: defineContract({ id: "notifications.read", method: "PATCH", path: "/notifications/:notificationId/read", params: idParams("notificationId"), responses: { 200: UserNotificationSchema } }),
  notificationsReadAll: defineContract({ id: "notifications.readAll", method: "PATCH", path: "/notifications/read", responses: { 200: OkSchema } }),
  notificationsDismissRead: defineContract({ id: "notifications.dismissRead", method: "DELETE", path: "/notifications/read", responses: { 200: OkSchema } }),
  notificationDismiss: defineContract({ id: "notifications.dismiss", method: "DELETE", path: "/notifications/:notificationId", params: idParams("notificationId"), responses: { 200: null, 204: null } }),

  tickets: defineContract({ id: "tickets.list", method: "GET", path: "/tickets", query: z.strictObject({ status: TicketStatusSchema.optional() }), responses: { 200: z.array(TicketSchema) } }),
  ticketCreate: defineContract({ id: "tickets.create", method: "POST", path: "/tickets", body: CreateTicketRequestSchema, responses: { 201: TicketSchema.extend({ firstMessage: TicketMessageSchema }) } }),
  ticketHandling: defineContract({ id: "tickets.handling", method: "GET", path: "/tickets/handling-capability", responses: { 200: z.strictObject({ canHandle: z.boolean() }) } }),
  ticketGet: defineContract({ id: "tickets.get", method: "GET", path: "/tickets/:ticketId", params: idParams("ticketId"), responses: { 200: TicketSchema } }),
  ticketMessages: defineContract({ id: "tickets.messages.list", method: "GET", path: "/tickets/:ticketId/messages", params: idParams("ticketId"), responses: { 200: z.array(TicketMessageSchema) } }),
  ticketMessageSend: defineContract({ id: "tickets.messages.send", method: "POST", path: "/tickets/:ticketId/messages", params: idParams("ticketId"), body: SendTicketMessageRequestSchema, responses: { 201: TicketMessageSchema } }),
  ticketClose: defineContract({ id: "tickets.close", method: "PATCH", path: "/tickets/:ticketId/close", params: idParams("ticketId"), responses: { 200: TicketSchema } }),
  ticketRead: defineContract({ id: "tickets.read", method: "PATCH", path: "/tickets/:ticketId/read", params: idParams("ticketId"), responses: { 200: OkSchema } }),

  workspaceSmtp: defineContract({ id: "workspace.mail.smtp", method: "GET", path: "/workspace/mail/smtp", responses: { 200: SmtpConfigSchema.nullable() } }),
  workspaceSmtpSave: defineContract({ id: "workspace.mail.smtp.save", method: "PUT", path: "/workspace/mail/smtp", body: SmtpRequestSchema, responses: { 200: SmtpConfigSchema } }),
  workspaceSmtpValidate: defineContract({ id: "workspace.mail.smtp.validate", method: "POST", path: "/workspace/mail/smtp/validate", body: SmtpRequestSchema, responses: { 201: OkSchema } }),
  platformSmtp: defineContract({ id: "platform.mail.smtp", method: "GET", path: "/platform/mail/smtp", responses: { 200: SmtpConfigSchema.nullable() } }),
  platformSmtpSave: defineContract({ id: "platform.mail.smtp.save", method: "PATCH", path: "/platform/mail/smtp", body: SmtpRequestSchema, responses: { 200: SmtpConfigSchema } }),
  platformSmtpValidate: defineContract({ id: "platform.mail.smtp.validate", method: "POST", path: "/platform/mail/smtp/validate", body: SmtpRequestSchema, responses: { 201: OkSchema } }),
  workspaceTemplates: defineContract({ id: "workspace.mail.templates", method: "GET", path: "/workspace/mail/templates", responses: { 200: z.array(EmailTemplateSchema) } }),
  workspaceTemplateCreate: defineContract({ id: "workspace.mail.templates.create", method: "POST", path: "/workspace/mail/templates", body: EmailTemplateRequestSchema.required({ hbs: true, languageCode: true, name: true }), responses: { 201: EmailTemplateSchema } }),
  workspaceTemplatePreview: defineContract({ id: "workspace.mail.templates.preview", method: "POST", path: "/workspace/mail/templates/preview", body: z.strictObject({ hbs: z.string(), subject: z.string().nullable().optional() }), responses: { 201: previewResponse } }),
  workspaceTemplateUpdate: defineContract({ id: "workspace.mail.templates.update", method: "PATCH", path: "/workspace/mail/templates/:templateId", params: idParams("templateId"), body: EmailTemplateRequestSchema, responses: { 200: EmailTemplateSchema } }),
  workspaceTemplateDelete: defineContract({ id: "workspace.mail.templates.delete", method: "DELETE", path: "/workspace/mail/templates/:templateId", params: idParams("templateId"), responses: noContent }),
  workspaceMailLogs: defineContract({ id: "workspace.mail.logs", method: "GET", path: "/workspace/mail/logs", responses: { 200: z.array(EmailLogSchema) } }),
  platformTemplates: defineContract({ id: "platform.mail.templates", method: "GET", path: "/platform/mail/templates", responses: { 200: z.array(EmailTemplateSchema) } }),
  platformTemplateCreate: defineContract({ id: "platform.mail.templates.create", method: "POST", path: "/platform/mail/templates", body: EmailTemplateRequestSchema, responses: { 201: EmailTemplateSchema } }),
  platformTemplatePreview: defineContract({ id: "platform.mail.templates.preview", method: "POST", path: "/platform/mail/templates/preview", body: z.strictObject({ hbs: z.string(), subject: z.string().nullable().optional() }), responses: { 201: previewResponse } }),
  platformTemplateUpdate: defineContract({ id: "platform.mail.templates.update", method: "PATCH", path: "/platform/mail/templates/:templateId", params: idParams("templateId"), body: EmailTemplateRequestSchema, responses: { 200: EmailTemplateSchema } }),
  platformTemplateDelete: defineContract({ id: "platform.mail.templates.delete", method: "DELETE", path: "/platform/mail/templates/:templateId", params: idParams("templateId"), responses: noContent }),

  fileUpload: defineContract({ id: "files.upload", method: "POST", path: "/files/upload", multipart: true, responses: { 201: FileUploadResponseSchema } }),
  platformFileUpload: defineContract({ id: "platform.files.upload", method: "POST", path: "/files/platform/upload", multipart: true, responses: { 201: FileUploadResponseSchema } }),
  fileObjectCreate: defineContract({ id: "files.objects.create", method: "POST", path: "/files/objects", body: CreateFileObjectRequestSchema, responses: { 201: FileUploadIntentSchema } }),
  fileObjectComplete: defineContract({ id: "files.objects.complete", method: "POST", path: "/files/objects/:fileId/complete", params: z.strictObject({ fileId: UuidSchema }), body: CompleteFileObjectRequestSchema, responses: { 201: FileObjectSchema } }),
  fileObjectGet: defineContract({ id: "files.objects.get", method: "GET", path: "/files/objects/:fileId", params: z.strictObject({ fileId: UuidSchema }), responses: { 200: FileObjectSchema } }),
  fileObjectContent: defineContract({ id: "files.objects.content", method: "GET", path: "/files/objects/:fileId/content", params: z.strictObject({ fileId: UuidSchema }), binary: true, responses: { 302: null } }),
  fileObjectDelete: defineContract({ id: "files.objects.delete", method: "DELETE", path: "/files/objects/:fileId", params: z.strictObject({ fileId: UuidSchema }), responses: noContent }),
  fileDownload: defineContract({ id: "files.download", method: "GET", path: "/files/:filename", params: z.strictObject({ filename: z.string().min(1).max(260) }), binary: true, responses: { 200: null } }),
} as const;

export const adminContractList = Object.freeze(Object.values(adminContracts));

const compiled = adminContractList.map((contract) => ({
  contract,
  pattern: new RegExp(`^${contract.path.replace(/:[^/]+/g, "([^/]+)")}$`),
  names: [...contract.path.matchAll(/:([^/]+)/g)].map((match) => match[1]!),
}));

export function findAdminContract(
  method: string,
  inputPath: string,
): { contract: ApiContract; params: Record<string, string> } | null {
  const path = normalizeAdminPath(inputPath);
  const upperMethod = method.toUpperCase();
  for (const entry of compiled) {
    if (entry.contract.method !== upperMethod) continue;
    const match = entry.pattern.exec(path);
    if (!match) continue;
    return {
      contract: entry.contract,
      params: Object.fromEntries(entry.names.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? "")])),
    };
  }
  return null;
}

export function normalizeAdminPath(input: string) {
  const pathname = input.split("?", 1)[0] || "/";
  const withoutPrefix = pathname.replace(/^\/api\/admin(?=\/|$)/, "");
  return withoutPrefix.startsWith("/") ? withoutPrefix : `/${withoutPrefix}`;
}

export function responseSchemaFor(contract: ApiContract, status: number, browser = false) {
  const responses = browser && contract.browserResponses ? contract.browserResponses : contract.responses;
  if (Object.prototype.hasOwnProperty.call(responses, status)) return responses[status] ?? null;
  if (browser && status >= 200 && status < 300) {
    const fallback = Object.entries(responses).find(([code]) => Number(code) >= 200 && Number(code) < 300);
    return fallback?.[1] ?? null;
  }
  return undefined;
}

export function assertUniqueAdminContracts() {
  const seen = new Set<string>();
  for (const contract of adminContractList) {
    const key = `${contract.method} ${contract.path}`;
    if (seen.has(key)) throw new Error(`Duplicate admin API contract: ${key}`);
    seen.add(key);
    if (Object.keys(contract.responses).length === 0) throw new Error(`Contract has no response: ${key}`);
  }
}
