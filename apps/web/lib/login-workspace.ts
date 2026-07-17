const RECENT_WORKSPACE_KEY = "hermes:recent-workspace";

export function normalizeWorkspace(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : "";
}

export function readRecentWorkspace(storage: Pick<Storage, "getItem">) {
  return normalizeWorkspace(storage.getItem(RECENT_WORKSPACE_KEY));
}

export function rememberWorkspace(
  storage: Pick<Storage, "setItem">,
  workspace: string,
) {
  const normalized = normalizeWorkspace(workspace);
  if (normalized) storage.setItem(RECENT_WORKSPACE_KEY, normalized);
}

export function forgetRecentWorkspace(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(RECENT_WORKSPACE_KEY);
}

export function withWorkspace(path: string, workspace: string) {
  const normalized = normalizeWorkspace(workspace);
  if (!normalized) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(normalized)}`;
}

export function safeReturnUrl(value: string | null | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/home";
}
