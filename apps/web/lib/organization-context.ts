export type OrganizationSelection = {
  activeOrganizationId: string | null;
  epoch: number;
  tenantId: string;
  userId: string;
};

export type OrganizationSelectionPrincipal = {
  defaultOrganizationId?: string | null;
  memberships?: ReadonlyArray<{
    organizationId: string;
    status: string;
  }>;
  permissions?: readonly string[];
  principalType: "platform" | "tenant";
  tenantId?: string | null;
  tenantRole?: { name: string } | null;
  user?: { id: string; tenantId?: string | null };
};

let activeSelection: OrganizationSelection | null = null;
let organizationEpoch = 0;
let organizationAbortController = new AbortController();
const listeners = new Set<(selection: OrganizationSelection | null) => void>();
const ALL_ORGANIZATIONS_STORAGE_VALUE = "__all__";

export function resolveInitialOrganizationSelection(
  principal: OrganizationSelectionPrincipal,
  storage: Pick<Storage, "getItem"> | null =
    typeof window === "undefined" ? null : window.localStorage,
) {
  if (principal.principalType !== "tenant" || !principal.user) return null;
  const tenantId = principal.tenantId ?? principal.user.tenantId ?? null;
  if (!tenantId) return null;
  const memberships = (principal.memberships ?? []).filter(
    (membership) => membership.status === "active",
  );
  const storedId = readStoredOrganizationId(storage, tenantId, principal.user.id);
  const fallbackOrganizationId = memberships.some(
    (item) => item.organizationId === principal.defaultOrganizationId,
  )
    ? principal.defaultOrganizationId ?? null
    : memberships[0]?.organizationId ?? null;
  const activeOrganizationId =
    storedId === null && canSelectAllOrganizations(principal)
      ? null
      : typeof storedId === "string" &&
          memberships.some((item) => item.organizationId === storedId)
        ? storedId
        : fallbackOrganizationId;
  return createSelection(tenantId, principal.user.id, activeOrganizationId);
}

export function isOrganizationSelectionAllowed(
  organizationId: string | null,
  principal: OrganizationSelectionPrincipal,
) {
  if (principal.principalType !== "tenant") return false;
  if (organizationId === null) return canSelectAllOrganizations(principal);
  return (principal.memberships ?? []).some(
    (membership) =>
      membership.status === "active" &&
      membership.organizationId === organizationId,
  );
}

export function canSelectAllOrganizations(
  principal: OrganizationSelectionPrincipal,
) {
  if (principal.principalType !== "tenant") return false;
  return (principal.permissions ?? []).includes("workspace.console.access:tenant");
}

export function commitOrganizationSelection(
  principal: OrganizationSelectionPrincipal,
  organizationId: string | null,
) {
  if (!principal.user) throw new Error("当前会话缺少用户信息");
  const tenantId = principal.tenantId ?? principal.user.tenantId ?? null;
  if (!tenantId) throw new Error("当前会话缺少工作空间信息");
  if (!isOrganizationSelectionAllowed(organizationId, principal)) {
    throw new Error("当前账号不能切换到该组织");
  }
  organizationAbortController.abort();
  organizationAbortController = new AbortController();
  organizationEpoch += 1;
  activeSelection = {
    activeOrganizationId: organizationId,
    epoch: organizationEpoch,
    tenantId,
    userId: principal.user.id,
  };
  if (typeof window !== "undefined") {
    storeOrganizationId(
      window.localStorage,
      tenantId,
      principal.user.id,
      organizationId,
    );
  }
  for (const listener of listeners) listener(activeSelection);
  return activeSelection;
}

export function initializeOrganizationSelection(
  selection: OrganizationSelection | null,
) {
  activeSelection = selection;
  return selection;
}

export function getActiveOrganizationSelection() {
  return activeSelection;
}

export function getOrganizationRequestSignal() {
  return organizationAbortController.signal;
}

export function subscribeToOrganizationSelection(
  listener: (selection: OrganizationSelection | null) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function organizationStorageKey(tenantId: string, userId: string) {
  return `${tenantId}:${userId}:organization`;
}

export function storeOrganizationId(
  storage: Pick<Storage, "removeItem" | "setItem">,
  tenantId: string,
  userId: string,
  organizationId: string | null,
) {
  const key = organizationStorageKey(tenantId, userId);
  storage.setItem(key, organizationId ?? ALL_ORGANIZATIONS_STORAGE_VALUE);
}

export function readStoredOrganizationId(
  storage: Pick<Storage, "getItem"> | null,
  tenantId: string,
  userId: string,
) {
  const stored = storage?.getItem(organizationStorageKey(tenantId, userId));
  if (stored === null || stored === undefined || !stored.trim()) return undefined;
  return stored.trim() === ALL_ORGANIZATIONS_STORAGE_VALUE
    ? null
    : stored.trim();
}

function createSelection(
  tenantId: string,
  userId: string,
  activeOrganizationId: string | null,
) {
  return {
    activeOrganizationId,
    epoch: organizationEpoch,
    tenantId,
    userId,
  } satisfies OrganizationSelection;
}
