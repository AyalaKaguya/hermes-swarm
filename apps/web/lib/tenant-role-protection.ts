export function isProtectedTenantRole(role: { name: string }) {
  return role.name === "tenant-owner";
}
