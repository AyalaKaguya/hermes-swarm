import type { fetchMe } from "@/lib/admin-api";

type Principal = Awaited<ReturnType<typeof fetchMe>>;

/**
 * Organization is an in-session business selection, never a host boundary.
 * Tenant host resolution happens before authentication in the API/BFF layer.
 */
export function resolveHostOrganizationIdFromPrincipal(
  _principal: Principal,
  _hostname: string,
) {
  return null;
}
