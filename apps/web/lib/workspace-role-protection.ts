export function isProtectedWorkspaceRole(role: { name: string }) {
  return role.name === "workspace-owner";
}
