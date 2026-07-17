export type PermissionScope =
  | "platform"
  | "tenant"
  | "organization"
  | "own";

/** Data-plane request scope. Platform access uses a separate principal. */
export type RequestScopeLevel = "tenant" | "organization";

export type AccessMode = "all" | "any";

export type PageAccessSection =
  | "business"
  | "infrastructure"
  | "organization"
  | "personal"
  | "platform"
  | "tenant";

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
