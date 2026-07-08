import { AdminApiError } from "@/lib/admin-api";

const WEB_SESSION_SENTINEL = "web-session";

export async function getAuthenticatedAdminToken() {
  return WEB_SESSION_SENTINEL;
}

export async function requireAuthenticatedAdminToken() {
  const sessionMarker = await getAuthenticatedAdminToken();
  if (!sessionMarker) {
    throw new AdminApiError(
      "登录已失效，请重新登录",
      401,
      "AUTHENTICATION_REQUIRED",
    );
  }
  return sessionMarker;
}

export async function withAuthenticatedAdminToken<T>(
  request: (token: string) => Promise<T>,
) {
  return request(await requireAuthenticatedAdminToken());
}
