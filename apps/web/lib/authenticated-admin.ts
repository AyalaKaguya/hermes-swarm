import { AdminApiError, getUsableStoredSession } from "@/lib/admin-api";

export async function getAuthenticatedAdminToken() {
  const session = await getUsableStoredSession().catch(() => null);
  return session?.accessToken ?? null;
}

export async function requireAuthenticatedAdminToken() {
  const accessToken = await getAuthenticatedAdminToken();
  if (!accessToken) {
    throw new AdminApiError(
      "登录已失效，请重新登录",
      401,
      "AUTHENTICATION_REQUIRED",
    );
  }
  return accessToken;
}

export async function withAuthenticatedAdminToken<T>(
  request: (token: string) => Promise<T>,
) {
  return request(await requireAuthenticatedAdminToken());
}
