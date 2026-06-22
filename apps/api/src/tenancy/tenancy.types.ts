import type {
  OrganizationStatus,
  TenantUserStatus,
} from "@hermes-swarm/core";

export type CreateOrganizationPayload = {
  name?: string;
  slug?: string;
  status?: OrganizationStatus;
};

export type UpdateOrganizationPayload = Partial<CreateOrganizationPayload>;

export type CreateUserPayload = {
  displayName?: string;
  email?: string;
  status?: TenantUserStatus;
};

export type UpdateUserPayload = Partial<CreateUserPayload>;

export type CreateMenuPayload = {
  code?: string;
  label?: string;
  path?: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type UpdateMenuPayload = Partial<CreateMenuPayload>;

export type MenuPermissionPayload = {
  menuId?: string;
  canView?: boolean;
  canManage?: boolean;
};

export type UpsertMenuPermissionsPayload = {
  permissions?: MenuPermissionPayload[];
};
