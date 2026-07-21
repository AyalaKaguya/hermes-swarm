export type PermissionScope =
  | "platform"
  | "workspace"
  | "own";

/** Data-plane request scope. Platform access uses a separate principal. */
export type RequestScopeLevel = "workspace";

export type AccessMode = "all" | "any";

export type PageAccessSection =
  | "business"
  | "infrastructure"
  | "personal"
  | "platform"
  | "workspace";

export type PageAccessDefinition = {
  defaultRoles: string[];
  description: string;
  href: string;
  icon: string;
  key: string;
  label: string;
  order: number;
  permission: string;
  routePatterns: string[];
  scope: PermissionScope;
  section: PageAccessSection;
  sectionLabel: string;
};
