/**
 * Stable public entry point for the browser-facing administration API.
 *
 * Keep feature imports pointed here while implementation modules stay grouped
 * by domain under `admin-api/`.
 */
export type {
  LoginRequest as LoginPayload,
  AccountStatus,
  AuditActor,
  AuditLogPage,
  AuditLogQuery,
  AuditNamedReference,
  AuthenticatedLoginResponse,
  AuthLoginResponse,
  AuthRefreshResponse,
  AuthSessionDevice,
  ContextSelectionOption,
  ContextSelectionRequiredResponse,
  CreatedIntegrationToken,
  CurrentUser,
  EffectiveWorkspaceSetting,
  EmailTemplateDto,
  FileUploadResponse,
  IntegrationToken,
  IntegrationTokenCapabilities,
  IntegrationTokenPermissionOption,
  IntegrationTokenScope,
  IntegrationTokenScopeCapability,
  Invite,
  InviteStatus,
  LoginAuditLogItem,
  OnboardingPayload,
  ResumeOnboardingPayload,
  OperationAuditLogItem,
  PermissionCatalog,
  PermissionCatalogEntity,
  PermissionCatalogOperation,
  PermissionCatalogPurpose,
  PermissionCatalogScope,
  PermissionScope,
  PlatformMember,
  PlatformMemberInvitation,
  PlatformMemberPayload,
  PlatformTicket,
  PlatformPrincipalSession,
  PrincipalSession,
  PublicBootstrap,
  RealtimeTicketResponse,
  Role,
  RolePayload,
  RolePermission,
  RuntimePreferences,
  SaveSettingsPayload,
  SettingPayloadEntry,
  SettingPayloadValue,
  Snapshot,
  SmtpConfig,
  SystemSettingDto,
  Ticket,
  TicketMessage,
  TicketMessageAttachment,
  TicketStatus,
  User,
  UserNotification,
  UserNotificationKind,
  UserNotificationStatus,
  Workspace,
  WorkspaceApplication,
  WorkspaceApplicationApproval,
  WorkspaceApplicationPayload,
  WorkspaceApplicationStatus,
  WorkspaceApplicationSubmission,
  WorkspaceLoginContext,
  WorkspaceMember,
  WorkspacePrincipalSession,
} from "@hermes-swarm/api-contracts";

export * from "./admin-api/client";
export * from "./admin-api/auth";
export * from "./admin-api/workspaces";
export * from "./admin-api/account";
export * from "./admin-api/memberships";
export * from "./admin-api/mail";
export * from "./admin-api/settings";
export * from "./admin-api/platform";
export * from "./admin-api/notifications";
export * from "./admin-api/tickets";
