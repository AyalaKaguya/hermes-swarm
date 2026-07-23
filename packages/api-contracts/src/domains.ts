import { z } from "zod";
import {
  IdentifierSchema, InviteSchema, IsoDateTimeSchema, JsonValueSchema, RoleSchema, UserReferenceSchema,
  SystemSettingSchema, UserSchema, WorkspaceApplicationSchema, WorkspaceSchema,
} from "./models.js";

export const AuditActorSchema = z.strictObject({ displayName: z.string(), email: z.email(), id: IdentifierSchema });
export const AuditNamedReferenceSchema = z.strictObject({ id: IdentifierSchema, name: z.string() });
export type AuditActor = z.infer<typeof AuditActorSchema>;
export type AuditNamedReference = z.infer<typeof AuditNamedReferenceSchema>;
export const AuditLogQuerySchema = z.strictObject({
  actorId: z.string().optional(), from: IsoDateTimeSchema.optional(), httpMethod: z.string().optional(),
  keyword: z.string().optional(), page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(), permission: z.string().optional(),
  result: z.string().optional(), to: IsoDateTimeSchema.optional(),
});
export type AuditLogQuery = z.input<typeof AuditLogQuerySchema>;
export const LoginAuditLogItemSchema = z.strictObject({
  actor: AuditActorSchema.nullable(), actorId: IdentifierSchema.nullable(), attemptedEmail: z.string(),
  createdAt: IsoDateTimeSchema, deviceLabel: z.string().nullable(), failureCode: z.string().nullable(),
  id: IdentifierSchema, ipAddress: z.string().nullable(), result: z.enum(["failed", "success"]),
  scopeType: z.enum(["platform", "workspace"]), sessionId: IdentifierSchema.nullable(),
  workspaceId: IdentifierSchema.nullable(), userAgent: z.string().nullable(),
});
export type LoginAuditLogItem = z.infer<typeof LoginAuditLogItemSchema>;
export const OperationAuditLogItemSchema = z.strictObject({
  actor: AuditActorSchema.nullable(), actorId: IdentifierSchema.nullable(), createdAt: IsoDateTimeSchema,
  errorCode: z.string().nullable(), httpMethod: z.string().nullable(), httpPath: z.string().nullable(),
  id: IdentifierSchema, ipAddress: z.string().nullable(), operationLabel: z.string(), permission: z.string(),
  principalType: z.enum(["anonymous", "integration", "platform", "workspace"]),
  result: z.enum(["allowed", "denied", "error"]), scopeType: z.enum(["own", "platform", "workspace"]),
  sessionId: IdentifierSchema.nullable(), statusCode: z.number().int().nullable(),
  targetWorkspace: AuditNamedReferenceSchema.nullable(), targetWorkspaceId: IdentifierSchema.nullable(),
  workspaceId: IdentifierSchema.nullable(), userAgent: z.string().nullable(),
});
export type OperationAuditLogItem = z.infer<typeof OperationAuditLogItemSchema>;
export function AuditLogPageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), page: z.number().int(), pageSize: z.number().int(), total: z.number().int() });
}
export type AuditLogPage<T> = { items: T[]; page: number; pageSize: number; total: number };

export const WorkspaceApplicationRequestSchema = z.strictObject({
  ownerDisplayName: z.string().min(1), ownerEmail: z.email(), preferredLanguage: z.string().optional(),
  requestedName: z.string().min(1), requestedSlug: z.string().min(1), requestedSubdomain: z.string().nullable().optional(),
});
export type WorkspaceApplicationPayload = z.input<typeof WorkspaceApplicationRequestSchema>;
export const WorkspaceApplicationSubmissionSchema = z.strictObject({
  applicationId: IdentifierSchema, cancellationToken: z.string().optional(), verificationEmailSent: z.boolean(), verificationToken: z.string().optional(),
});
export type WorkspaceApplicationSubmission = z.infer<typeof WorkspaceApplicationSubmissionSchema>;
export const WorkspaceApplicationApprovalSchema = z.strictObject({
  application: WorkspaceApplicationSchema, ownerActivationEmailSent: z.boolean(), ownerActivationToken: z.string().optional(), workspace: WorkspaceSchema,
});
export type WorkspaceApplicationApproval = z.infer<typeof WorkspaceApplicationApprovalSchema>;
export const WorkspaceOwnerActivationSchema = z.strictObject({
  account: z.strictObject({ displayName: z.string(), email: z.email(), id: IdentifierSchema }),
  existingAccount: z.boolean(),
  membershipId: IdentifierSchema,
  workspace: WorkspaceSchema,
});
export type WorkspaceOwnerActivation = z.infer<typeof WorkspaceOwnerActivationSchema>;

export const IntegrationTokenPermissionOptionSchema = z.strictObject({
  description: z.string().nullable(), entity: z.string(), entityLabel: z.string(), entityOrder: z.number().nullable(),
  isDangerous: z.boolean(), label: z.string(), operation: z.string(), operationOrder: z.number().nullable(),
  permission: z.string(), purpose: z.string(), purposeLabel: z.string(), purposeOrder: z.number().nullable(),
  scope: z.enum(["workspace", "own"]),
});
export const IntegrationTokenScopeCapabilitySchema = z.strictObject({
  permissions: z.array(IntegrationTokenPermissionOptionSchema), scope: z.literal("workspace"),
});
export type IntegrationTokenPermissionOption = z.infer<typeof IntegrationTokenPermissionOptionSchema>;
export type IntegrationTokenScopeCapability = z.infer<typeof IntegrationTokenScopeCapabilitySchema>;
export const IntegrationTokenCapabilitiesSchema = z.strictObject({ scopes: z.array(IntegrationTokenScopeCapabilitySchema) });
export type IntegrationTokenCapabilities = z.infer<typeof IntegrationTokenCapabilitiesSchema>;
export const IntegrationTokenSchema = z.strictObject({
  createdAt: IsoDateTimeSchema, expiresAt: IsoDateTimeSchema, id: IdentifierSchema, isExpired: z.boolean(),
  lastUsedAt: IsoDateTimeSchema.nullable(), note: z.string().nullable(), owner: UserReferenceSchema.nullable().optional(),
  ownerUserId: IdentifierSchema.optional(), permissions: z.array(z.string()), revokedAt: IsoDateTimeSchema.nullable(),
  scope: z.literal("workspace"), workspaceId: IdentifierSchema, tokenPrefix: z.string(), updatedAt: IsoDateTimeSchema,
});
export type IntegrationToken = z.infer<typeof IntegrationTokenSchema>;
export const CreatedIntegrationTokenSchema = IntegrationTokenSchema.extend({ token: z.string().min(1) });
export type CreatedIntegrationToken = z.infer<typeof CreatedIntegrationTokenSchema>;
export type CreateIntegrationTokenPayload = {
  expiresAt?: string;
  note?: string | null;
  permissions: string[];
};

export const WorkspaceLoginContextSchema = z.strictObject({
  source: z.enum(["host", "workspace"]).nullable(),
  workspace: z.strictObject({ name: z.string(), slug: z.string() }).nullable(),
});
export type WorkspaceLoginContext = z.infer<typeof WorkspaceLoginContextSchema>;

export const PublicBootstrapSchema = z.strictObject({
  onboardingRequired: z.boolean(),
  onboardingState: z.enum([
    "admin_required",
    "workspace_required",
    "complete",
    "recovery_required",
  ]),
  systemSettings: z.array(SystemSettingSchema).optional(),
});
export type PublicBootstrap = z.infer<typeof PublicBootstrapSchema>;
export type OnboardingState = PublicBootstrap["onboardingState"];

export const RealtimeTicketResponseSchema = z.strictObject({ expiresAt: IsoDateTimeSchema, ticket: z.string().min(1) });
export type RealtimeTicketResponse = z.infer<typeof RealtimeTicketResponseSchema>;

export const PlatformMemberRequestSchema = z.strictObject({
  email: z.email().optional(), expiresIn: z.enum(["3d", "7d", "never"]).optional(),
  roleId: IdentifierSchema.nullable().optional(), status: z.enum(["active", "disabled"]).optional(),
});
export type PlatformMemberPayload = z.input<typeof PlatformMemberRequestSchema>;
export const PlatformMemberInvitationSchema = z.strictObject({
  invite: InviteSchema,
  status: z.literal("invited"),
});
export type PlatformMemberInvitation = z.infer<typeof PlatformMemberInvitationSchema>;
export const RoleRequestSchema = z.strictObject({
  color: z.string().nullable().optional(), description: z.string().nullable().optional(),
  displayName: z.string().optional(), name: z.string().optional(),
});
export type RolePayload = z.input<typeof RoleRequestSchema>;
export const ReplaceRolePermissionsRequestSchema = z.strictObject({
  permissions: z.array(z.strictObject({ enabled: z.boolean().optional(), permission: z.string().min(1) })).default([]),
});
export type RolePermissionPayload = NonNullable<
  z.input<typeof ReplaceRolePermissionsRequestSchema>["permissions"]
>[number];
export type ReplaceRolePermissionsPayload = z.input<typeof ReplaceRolePermissionsRequestSchema>;

export const SettingPayloadEntrySchema = z.strictObject({
  name: z.string().min(1), scope: z.enum(["platform", "workspace"]).optional(), value: JsonValueSchema,
  valueOptions: z.array(z.strictObject({ label: z.string(), value: z.string() })).nullable().optional(),
  valueType: z.enum(["string", "boolean", "number", "json", "enum", "secret"]).optional(),
});
export type SettingPayloadEntry = z.input<typeof SettingPayloadEntrySchema>;
export const SaveSettingsRequestSchema = z.union([
  z.record(z.string(), JsonValueSchema),
  z.strictObject({ settings: z.array(SettingPayloadEntrySchema) }),
]);
export type SaveSettingsPayload = z.input<typeof SaveSettingsRequestSchema>;

export const SmtpRequestSchema = z.strictObject({
  fromAddress: z.string().nullable().optional(), host: z.string().optional(), isValidated: z.boolean().optional(),
  password: z.string().nullable().optional(), port: z.number().int().optional(), secure: z.boolean().optional(),
  username: z.string().nullable().optional(),
});
export const EmailTemplateRequestSchema = z.strictObject({
  description: z.string().nullable().optional(), hbs: z.string().optional(), languageCode: z.string().optional(),
  mjml: z.string().nullable().optional(), name: z.string().optional(), subject: z.string().nullable().optional(),
});

export const UserNotificationRequestSchema = z.strictObject({
  body: z.string().nullable().optional(), kind: z.enum(["error", "info", "success", "warning"]).optional(),
  payload: z.record(z.string(), JsonValueSchema).nullable().optional(), recipientUserIds: z.array(IdentifierSchema).min(1),
  title: z.string().min(1),
});

export const TicketAttachmentRequestSchema = z.strictObject({
  mimeType: z.string().optional(), name: z.string(), size: z.number().nonnegative().optional(), type: z.literal("image"), url: z.string(),
});
export const CreateTicketRequestSchema = z.strictObject({
  attachments: z.array(TicketAttachmentRequestSchema).nullable().optional(), body: z.string().min(1), subject: z.string().min(1),
});
export const SendTicketMessageRequestSchema = z.strictObject({
  attachments: z.array(TicketAttachmentRequestSchema).nullable().optional(), body: z.string().min(1),
});

const WorkspaceOnboardingRequestSchema = z.strictObject({
  defaultLanguage: z.enum(["en", "zh-Hans", "zh-Hant"]),
  defaultTimeZone: z.string().trim().min(1).max(80),
  platformTitle: z.string().trim().min(1).max(120),
  workspaceApplicationsEnabled: z.boolean(),
  workspaceName: z.string().trim().min(1).max(120),
  workspaceSlug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
export const OnboardingRequestSchema = WorkspaceOnboardingRequestSchema.extend({
  adminEmail: z.email(),
  adminName: z.string().trim().min(1).max(120),
  adminPassword: z.string().min(8).max(240),
});
export type OnboardingPayload = z.input<typeof OnboardingRequestSchema>;
export const ResumeOnboardingRequestSchema = WorkspaceOnboardingRequestSchema;
export type ResumeOnboardingPayload = z.input<typeof ResumeOnboardingRequestSchema>;

export const InviteRequestSchema = z.strictObject({
  email: z.email(), expiresIn: z.enum(["3d", "7d", "never"]).optional(), workspaceRoleId: IdentifierSchema,
});
export type CreateInvitePayload = z.input<typeof InviteRequestSchema>;
export const AcceptInviteRequestSchema = z.strictObject({
  action: z.enum(["accept", "decline"]).optional(), displayName: z.string().optional(), email: z.email().optional(),
  password: z.string().optional(), token: z.string().min(1),
});
export type AcceptInvitePayload = z.input<typeof AcceptInviteRequestSchema>;
export const ValidateInviteRequestSchema = z.strictObject({ email: z.email().nullable().optional(), token: z.string().min(1) });

export const UpdateUserRequestSchema = z.strictObject({
  displayName: z.string().optional(), email: z.email().optional(), firstName: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(), lastName: z.string().nullable().optional(), mobile: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
});
export type UpdateSelfProfilePayload = z.input<typeof UpdateUserRequestSchema>;
export const UpdateRuntimePreferencesRequestSchema = z.strictObject({
  preferredLanguage: z.string().nullable().optional(), timeZone: z.string().nullable().optional(),
});
export type UpdateRuntimePreferencesPayload = z.input<typeof UpdateRuntimePreferencesRequestSchema>;

export const SearchUsersQuerySchema = z.strictObject({ search: z.string().optional() });
export type SearchUsersQuery = z.input<typeof SearchUsersQuerySchema>;
export type UpdateAccountPasswordPayload = { currentPassword: string; password: string };
export type RequestPasswordResetPayload = { email: string; workspaceSlug?: string };
export type ResetPasswordPayload = {
  confirmPassword?: string;
  email?: string;
  password: string;
  token: string;
  workspaceSlug?: string;
};

export const LegacyWorkspaceSelectionOptionSchema = z.strictObject({
  membershipId: IdentifierSchema, role: RoleSchema.pick({ displayName: true, id: true, name: true }), workspace: WorkspaceSchema,
});

export type WorkspaceApplicationStatus = z.infer<typeof WorkspaceApplicationSchema.shape.status>;
export type IntegrationTokenScope = "workspace";
export type PermissionScope = "platform" | "workspace" | "own";
export type UserNotificationStatus = "read" | "unread";
export type UserNotificationKind = "error" | "info" | "success" | "warning";
