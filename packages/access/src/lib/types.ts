export type PermissionScope = "organization" | "own" | "platform";

export type AccessMode = "all" | "any";

export type PageAccessSection = "organization" | "personal" | "platform";

export type PageAccessDefinition = {
  defaultRoles: SystemRoleName[];
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

export type SystemRoleName =
  | "admin"
  | "member"
  | "owner"
  | "platform-admin"
  | "viewer";
