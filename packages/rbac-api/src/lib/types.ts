export type PermissionScope = "organization" | "own" | "platform";

export type AccessMode = "all" | "any";

export type PageAccessSection =
  | "business"
  | "infrastructure"
  | "organization"
  | "personal"
  | "platform";

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
