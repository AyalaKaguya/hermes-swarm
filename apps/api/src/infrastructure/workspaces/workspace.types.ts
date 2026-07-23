export type WorkspaceApplicationPayload = {
  ownerDisplayName?: string;
  ownerEmail?: string;
  preferredLanguage?: string;
  requestedName?: string;
  requestedSlug?: string;
  requestedSubdomain?: string | null;
};

export type WorkspaceApplicationReviewPayload = {
  note?: string | null;
};

export type WorkspaceRolePayload = {
  color?: string | null;
  description?: string | null;
  displayName?: string;
  name?: string;
};

export type WorkspaceRolePermissionsPayload = {
  permissions?: Array<{ enabled?: boolean; permission?: string }>;
};

export type UpdateWorkspacePayload = {
  name?: string;
};

export type UpdateWorkspaceStatusPayload = {
  status?: "active" | "archived" | "suspended";
};
