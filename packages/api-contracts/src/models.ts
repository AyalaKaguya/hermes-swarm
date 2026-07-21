import { z } from "zod";

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const IdentifierSchema = z.string().trim().min(1);
// Kept non-recursive so the OpenAPI 3.0 generator can materialize the schema.
// Nested array/object values remain JSON-serializable at the HTTP boundary.
export const JsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);
const nullableString = z.string().nullable();

export const AccountStatusSchema = z.enum(["active", "disabled"]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const WorkspaceStatusSchema = z.enum(["provisioning", "active", "suspended", "archived"]);
export const WorkspaceSchema = z.strictObject({
  id: IdentifierSchema,
  name: z.string(),
  slug: z.string(),
  status: WorkspaceStatusSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const RolePermissionSchema = z.strictObject({
  id: IdentifierSchema,
  enabled: z.boolean(),
  permission: z.string(),
  permissionId: IdentifierSchema.optional(),
  roleId: IdentifierSchema,
});
export type RolePermission = z.infer<typeof RolePermissionSchema>;

export const RoleSchema = z.strictObject({
  color: nullableString.optional(),
  description: nullableString.optional(),
  displayName: nullableString.optional(),
  id: IdentifierSchema,
  isSystem: z.boolean(),
  label: z.string(),
  name: z.string(),
  permissions: z.array(RolePermissionSchema).optional(),
  scope: z.enum(["platform", "workspace"]).optional(),
  workspaceId: IdentifierSchema.nullable().optional(),
});
export type Role = z.infer<typeof RoleSchema>;

export const UserReferenceSchema = z.strictObject({
  avatarUrl: nullableString.optional(),
  displayName: z.string(),
  email: z.email(),
  id: IdentifierSchema,
  imageUrl: nullableString.optional(),
  username: nullableString.optional(),
});

export const UserSchema = z.strictObject({
  id: IdentifierSchema,
  displayName: z.string(),
  email: z.email(),
  firstName: nullableString,
  lastName: nullableString,
  username: nullableString,
  mobile: nullableString,
  imageUrl: nullableString,
  nickname: nullableString.optional(),
  avatarUrl: nullableString.optional(),
  preferredLanguage: nullableString,
  emailVerified: z.boolean(),
  timeZone: nullableString,
  workspaceRole: RoleSchema.nullable().optional(),
  status: AccountStatusSchema,
  type: z.enum(["service", "user"]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type User = z.infer<typeof UserSchema>;

export const WorkspaceMemberSchema = z.strictObject({
  account: UserSchema,
  membershipId: IdentifierSchema,
  removedAt: IsoDateTimeSchema.nullable(),
  role: RoleSchema.nullable(),
  status: z.enum(["active", "disabled", "removed"]),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const PlatformMemberSchema = z.strictObject({
  account: UserSchema,
  displayName: z.string(),
  email: z.email(),
  id: IdentifierSchema,
  membershipId: IdentifierSchema,
  role: RoleSchema.nullable(),
  roleId: IdentifierSchema.nullable(),
  status: z.enum(["active", "disabled", "removed"]),
  userId: IdentifierSchema,
});
export type PlatformMember = z.infer<typeof PlatformMemberSchema>;

export const SettingValueTypeSchema = z.enum(["string", "boolean", "number", "json", "enum", "secret"]);
export const SettingValueOptionSchema = z.strictObject({ label: z.string(), value: z.string() });
export const SettingPayloadValueSchema = JsonValueSchema;
export type SettingPayloadValue = z.infer<typeof SettingPayloadValueSchema>;

export const SystemSettingSchema = z.strictObject({
  id: IdentifierSchema,
  name: z.string(),
  scope: z.enum(["platform", "workspace"]),
  value: nullableString,
  valueOptions: z.array(SettingValueOptionSchema).nullable().optional(),
  valueType: SettingValueTypeSchema,
});
export type SystemSettingDto = z.infer<typeof SystemSettingSchema>;

export const EffectiveWorkspaceSettingSchema = z.strictObject({
  defaultValue: nullableString,
  id: IdentifierSchema,
  isCustom: z.boolean(),
  isEditable: z.boolean(),
  isOrphaned: z.boolean(),
  isOverridden: z.boolean(),
  name: z.string(),
  overrideValue: nullableString,
  scope: z.enum(["platform", "workspace"]),
  workspaceId: IdentifierSchema,
  value: nullableString,
  valueOptions: z.array(SettingValueOptionSchema).nullable(),
  valueType: SettingValueTypeSchema,
});
export type EffectiveWorkspaceSetting = z.infer<typeof EffectiveWorkspaceSettingSchema>;

export const RuntimePreferencesSchema = z.strictObject({
  currency: z.string(),
  dateFormat: z.string(),
  language: z.enum(["en", "zh-Hans", "zh-Hant"]),
  regionCode: z.string(),
  sources: z.strictObject({
    currency: z.enum(["code", "platform", "workspace"]),
    dateFormat: z.enum(["code", "platform", "workspace"]),
    language: z.enum(["code", "platform", "workspace", "user"]),
    regionCode: z.enum(["code", "platform", "workspace"]),
    timeZone: z.enum(["code", "platform", "workspace", "user"]),
  }),
  timeZone: z.string(),
});
export type RuntimePreferences = z.infer<typeof RuntimePreferencesSchema>;

export const PermissionCatalogOperationSchema = z.strictObject({
  description: nullableString.optional(),
  isDangerous: z.boolean().optional(),
  label: z.string(), operation: z.string(), order: z.number().nullable().optional(), permission: z.string(),
});
export type PermissionCatalogOperation = z.infer<typeof PermissionCatalogOperationSchema>;
export const PermissionCatalogPurposeSchema = z.strictObject({
  label: z.string(), operations: z.array(PermissionCatalogOperationSchema), order: z.number().nullable().optional(), purpose: z.string(),
});
export type PermissionCatalogPurpose = z.infer<typeof PermissionCatalogPurposeSchema>;
export const PermissionCatalogEntitySchema = z.strictObject({
  entity: z.string(), label: z.string(), order: z.number().nullable().optional(), purposes: z.array(PermissionCatalogPurposeSchema),
});
export type PermissionCatalogEntity = z.infer<typeof PermissionCatalogEntitySchema>;
export const PermissionCatalogScopeSchema = z.strictObject({
  entities: z.array(PermissionCatalogEntitySchema), label: z.string(), scope: z.enum(["platform", "workspace", "own"]),
});
export type PermissionCatalogScope = z.infer<typeof PermissionCatalogScopeSchema>;
export const PermissionCatalogSchema = z.strictObject({ scopes: z.array(PermissionCatalogScopeSchema) });
export type PermissionCatalog = z.infer<typeof PermissionCatalogSchema>;

export const WorkspaceApplicationStatusSchema = z.enum([
  "pending_email_verification", "pending_review", "approved", "rejected", "cancelled",
]);
export const WorkspaceApplicationSchema = z.strictObject({
  createdAt: IsoDateTimeSchema,
  emailVerifiedAt: IsoDateTimeSchema.nullable(),
  id: IdentifierSchema,
  ownerDisplayName: z.string(),
  ownerEmail: z.email(),
  requestedName: z.string(),
  requestedSlug: z.string(),
  requestedSubdomain: nullableString,
  reviewedAt: IsoDateTimeSchema.nullable(),
  reviewedByAccountId: IdentifierSchema.nullable(),
  reviewNote: nullableString,
  status: WorkspaceApplicationStatusSchema,
  workspaceId: IdentifierSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type WorkspaceApplication = z.infer<typeof WorkspaceApplicationSchema>;

export const InviteStatusSchema = z.enum(["accepted", "declined", "expired", "invited", "revoked"]);
export type InviteStatus = z.infer<typeof InviteStatusSchema>;
export const InviteSchema = z.strictObject({
  acceptedCount: z.number().int().nonnegative(),
  acceptedUserId: IdentifierSchema.nullable(),
  actionDate: IsoDateTimeSchema.nullable(),
  closedAt: IsoDateTimeSchema.nullable(),
  email: z.email().nullable(),
  existingUser: z.boolean().optional(),
  createdAt: IsoDateTimeSchema,
  contextType: z.enum(["platform", "workspace"]),
  expireDate: IsoDateTimeSchema.nullable(),
  id: IdentifierSchema,
  invitedById: IdentifierSchema.nullable(),
  invitedBy: UserReferenceSchema.nullable().optional(),
  link: z.string().optional(),
  status: InviteStatusSchema,
  roleId: IdentifierSchema,
  workspaceRoleId: IdentifierSchema,
});
export type Invite = z.infer<typeof InviteSchema>;

export const UserNotificationStatusSchema = z.enum(["read", "unread"]);
export const UserNotificationKindSchema = z.enum(["error", "info", "success", "warning"]);
export const UserNotificationSchema = z.strictObject({
  actorUserId: IdentifierSchema.nullable(), body: nullableString, createdAt: IsoDateTimeSchema,
  dismissedAt: IsoDateTimeSchema.nullable(), id: IdentifierSchema, kind: UserNotificationKindSchema,
  payload: z.record(z.string(), JsonValueSchema).nullable(), readAt: IsoDateTimeSchema.nullable(),
  sourceId: IdentifierSchema.nullable(), sourceType: nullableString, status: UserNotificationStatusSchema,
  title: z.string(), updatedAt: IsoDateTimeSchema,
});
export type UserNotification = z.infer<typeof UserNotificationSchema>;

export const TicketStatusSchema = z.enum(["archived", "closed", "open"]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;
export const TicketSchema = z.strictObject({
  archivedAt: IsoDateTimeSchema.nullable(), assigneeUserId: IdentifierSchema.nullable(),
  conversationId: IdentifierSchema.nullable(), createdAt: IsoDateTimeSchema,
  handlerClosedAt: IsoDateTimeSchema.nullable(), id: IdentifierSchema,
  lastMessageAt: IsoDateTimeSchema.nullable(), participantUserIds: z.array(IdentifierSchema),
  requesterClosedAt: IsoDateTimeSchema.nullable(), requesterUserId: IdentifierSchema,
  status: TicketStatusSchema, subject: z.string(), updatedAt: IsoDateTimeSchema,
});
export type Ticket = z.infer<typeof TicketSchema>;

export const TicketMessageAttachmentSchema = z.strictObject({
  mimeType: z.string().optional(), name: z.string(), size: z.number().nonnegative().optional(),
  type: z.literal("image"), url: z.string(),
});
export type TicketMessageAttachment = z.infer<typeof TicketMessageAttachmentSchema>;
export const TicketMessageSchema = z.strictObject({
  attachments: z.array(TicketMessageAttachmentSchema), author: UserReferenceSchema.nullable(),
  authorUserId: IdentifierSchema.nullable(), body: z.string(), conversationId: IdentifierSchema,
  createdAt: IsoDateTimeSchema, id: IdentifierSchema, kind: z.enum(["message", "system"]),
  metadata: z.record(z.string(), JsonValueSchema).nullable(), sourceId: IdentifierSchema,
  sourceType: z.string(), updatedAt: IsoDateTimeSchema,
});
export type TicketMessage = z.infer<typeof TicketMessageSchema>;

export const SmtpConfigSchema = z.strictObject({
  fromAddress: nullableString, host: z.string(), id: IdentifierSchema, isValidated: z.boolean(),
  port: z.number().int(), secure: z.boolean(), username: nullableString,
});
export type SmtpConfig = z.infer<typeof SmtpConfigSchema>;
export const EmailTemplateSchema = z.strictObject({
  description: nullableString, hbs: z.string(), hasPlatformDefault: z.boolean(), id: IdentifierSchema,
  inherited: z.boolean(), isSystem: z.boolean(), languageCode: z.string(), mjml: nullableString,
  name: z.string(), subject: nullableString,
});
export type EmailTemplateDto = z.infer<typeof EmailTemplateSchema>;
export const EmailLogSchema = z.strictObject({
  content: nullableString,
  email: z.email(),
  id: IdentifierSchema,
  isArchived: z.boolean(),
  status: z.enum(["queued", "sent", "failed", "skipped"]),
  subject: nullableString,
  templateName: nullableString,
});
export type EmailLogDto = z.infer<typeof EmailLogSchema>;

export const FileUploadResponseSchema = z.strictObject({
  destinations: z.array(z.strictObject({ kind: z.string(), status: z.enum(["failed", "success"]), url: z.string().optional() })),
  mimeType: z.string().optional(), name: z.string().optional(), originalName: z.string().optional(),
  size: z.number().nonnegative().optional(), status: z.enum(["failed", "partial_success", "success"]), url: z.string().optional(),
});
export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>;

export const ApiErrorSchema = z.object({
  code: z.string().optional(), message: z.union([z.string(), z.array(z.string())]), statusCode: z.number().int().optional(),
}).passthrough();
export type ApiError = z.infer<typeof ApiErrorSchema>;
export const PaginationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export const SuccessSchema = z.strictObject({ success: z.boolean() });
export const OkSchema = z.strictObject({ ok: z.boolean() });
export const AllowedSchema = z.strictObject({ allowed: z.boolean() });
