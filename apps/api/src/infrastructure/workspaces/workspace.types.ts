export type WorkspaceRolePayload = {
  color?: string | null;
  description?: string | null;
  displayName?: string;
  name?: string;
};

export type WorkspaceRolePermissionsPayload = {
  permissions?: Array<{ enabled?: boolean; permission?: string }>;
};
