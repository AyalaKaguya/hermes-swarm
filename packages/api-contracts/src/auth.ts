import { z } from "zod";
import {
  IdentifierSchema, IsoDateTimeSchema, RolePermissionSchema, RoleSchema,
  RuntimePreferencesSchema, SystemSettingSchema, UserSchema, WorkspaceSchema,
} from "./models.js";

export const LoginRequestSchema = z.strictObject({
  contextType: z.enum(["platform", "workspace"]).optional(),
  email: z.email(),
  password: z.string().min(1),
  workspaceSlug: z.string().trim().min(1).optional(),
});
export type LoginRequest = z.input<typeof LoginRequestSchema>;

export const SelectContextRequestSchema = z.strictObject({
  contextType: z.enum(["platform", "workspace"]),
  membershipId: IdentifierSchema,
  selectionToken: z.string().min(1),
});
export type SelectContextPayload = z.input<typeof SelectContextRequestSchema>;

export const WorkspaceContextSummarySchema = z.strictObject({
  id: IdentifierSchema,
  name: z.string(),
  slug: z.string(),
  subdomain: z.string().nullable(),
});

export const ContextSelectionOptionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    membershipId: IdentifierSchema,
    role: RoleSchema.pick({ displayName: true, id: true, name: true }),
    type: z.literal("platform"),
  }),
  z.strictObject({
    membershipId: IdentifierSchema,
    role: RoleSchema.pick({ displayName: true, id: true, name: true }),
    type: z.literal("workspace"),
    workspace: WorkspaceContextSummarySchema,
  }),
]);
export type ContextSelectionOption = z.infer<typeof ContextSelectionOptionSchema>;

export const ContextSelectionRequiredSchema = z.strictObject({
  contexts: z.array(ContextSelectionOptionSchema), expiresAt: IsoDateTimeSchema,
  selectionToken: z.string(), status: z.literal("context_selection_required"),
});

const ActiveMembershipSchema = z.strictObject({ id: IdentifierSchema, role: RoleSchema, status: z.literal("active") });
export const WorkspacePrincipalSessionSchema = z.strictObject({
  account: UserSchema,
  context: z.strictObject({ membershipId: IdentifierSchema, type: z.literal("workspace"), workspace: WorkspaceSchema }),
  membership: ActiveMembershipSchema,
  isPlatformAdmin: z.boolean().optional(), permissions: z.array(z.string()), role: RoleSchema.nullable().optional(),
  principalType: z.literal("workspace"), runtimePreferences: RuntimePreferencesSchema,
  systemSettings: z.array(SystemSettingSchema).optional(), workspace: WorkspaceSchema.nullable().optional(),
  workspaceId: IdentifierSchema, workspaceRole: RoleSchema.nullable(),
});
export const PlatformPrincipalSessionSchema = z.strictObject({
  account: UserSchema,
  context: z.strictObject({ membershipId: IdentifierSchema, type: z.literal("platform") }),
  membership: ActiveMembershipSchema, permissions: z.array(z.string()), principalType: z.literal("platform"),
  role: RoleSchema, runtimePreferences: RuntimePreferencesSchema, systemSettings: z.array(SystemSettingSchema).optional(),
});
export const PrincipalSessionSchema = z.discriminatedUnion("principalType", [
  WorkspacePrincipalSessionSchema, PlatformPrincipalSessionSchema,
]);
export type PrincipalSession = z.infer<typeof PrincipalSessionSchema>;

export const AuthenticatedLoginInternalSchema = z.strictObject({
  accessToken: z.string().min(1), expiresAt: IsoDateTimeSchema, sessionId: IdentifierSchema,
  snapshot: PrincipalSessionSchema, status: z.literal("authenticated"),
});
export type AuthenticatedLoginInternal = z.infer<typeof AuthenticatedLoginInternalSchema>;
export const AuthenticatedLoginResponseSchema = AuthenticatedLoginInternalSchema.omit({ accessToken: true });
export type AuthenticatedLoginResponse = z.infer<typeof AuthenticatedLoginResponseSchema>;
export const AuthLoginInternalResponseSchema = z.union([AuthenticatedLoginInternalSchema, ContextSelectionRequiredSchema]);
export const AuthLoginResponseSchema = z.union([AuthenticatedLoginResponseSchema, ContextSelectionRequiredSchema]);
export type AuthLoginResponse = z.infer<typeof AuthLoginResponseSchema>;

export const RefreshSessionInternalSchema = z.strictObject({
  accessToken: z.string().min(1), expiresAt: IsoDateTimeSchema, sessionId: IdentifierSchema,
});
export const RefreshSessionResponseSchema = RefreshSessionInternalSchema.omit({ accessToken: true });
export type AuthRefreshResponse = z.infer<typeof RefreshSessionResponseSchema>;

export const AuthSessionDeviceSchema = z.strictObject({
  browser: z.string(), createdAt: IsoDateTimeSchema, deviceLabel: z.string(), expiresAt: IsoDateTimeSchema,
  ipAddress: z.string().nullable(), isCurrent: z.boolean(), isExpired: z.boolean(), lastSeenAt: IsoDateTimeSchema,
  os: z.string(), revokedAt: IsoDateTimeSchema.nullable(), sessionId: IdentifierSchema,
});
export type AuthSessionDevice = z.infer<typeof AuthSessionDeviceSchema>;

export const CurrentUserSchema = z.strictObject({
  isPlatformAdmin: z.boolean().optional(), permissions: z.array(z.string()),
  principalType: z.enum(["platform", "workspace"]), role: RoleSchema.nullable(), user: UserSchema,
});
export type CurrentUser = z.infer<typeof CurrentUserSchema>;

export const SnapshotSchema = z.strictObject({
  context: z.union([WorkspacePrincipalSessionSchema.shape.context, PlatformPrincipalSessionSchema.shape.context]),
  currentUser: CurrentUserSchema,
  isPlatformAdmin: z.boolean(), permissions: z.array(z.string()), principalType: z.enum(["platform", "workspace"]),
  role: RoleSchema.nullable().optional(), rolePermissions: z.array(RolePermissionSchema), roles: z.array(RoleSchema),
  runtimePreferences: RuntimePreferencesSchema, systemSettings: z.array(SystemSettingSchema),
  workspace: WorkspaceSchema.nullable().optional(), workspaceId: IdentifierSchema.nullable().optional(),
  workspaceRole: RoleSchema.nullable().optional(), user: UserSchema, users: z.array(UserSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export type WorkspacePrincipalSession = z.infer<typeof WorkspacePrincipalSessionSchema>;
export type PlatformPrincipalSession = z.infer<typeof PlatformPrincipalSessionSchema>;
export type ContextSelectionRequiredResponse = z.infer<typeof ContextSelectionRequiredSchema>;
