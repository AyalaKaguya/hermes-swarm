import { AdminApiError } from "@/lib/admin-api";

const WEB_SESSION_SENTINEL = "web-session";

export type AuthenticatedAdminSessionMarker = typeof WEB_SESSION_SENTINEL;

export async function getAuthenticatedAdminSessionMarker(): Promise<AuthenticatedAdminSessionMarker> {
  return WEB_SESSION_SENTINEL;
}

export async function requireAuthenticatedAdminSessionMarker() {
  const sessionMarker = await getAuthenticatedAdminSessionMarker();
  if (!sessionMarker) {
    throw new AdminApiError(
      "登录已失效，请重新登录",
      401,
      "AUTHENTICATION_REQUIRED",
    );
  }
  return sessionMarker;
}

export async function withAuthenticatedAdminSessionMarker<T>(
  request: (session: AuthenticatedAdminSessionMarker) => Promise<T>,
) {
  return request(await requireAuthenticatedAdminSessionMarker());
}
