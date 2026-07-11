export const REQUEST_SCOPE_LEVEL_HEADER = "X-Scope-Level";
export const ORGANIZATION_ID_HEADER = "Organization-Id";
export const DEPARTMENT_ID_HEADER = "Department-Id";

const STORAGE_PREFIX = "hermes-swarm.request-scope";

export type RequestScopeLevel = "tenant" | "organization" | "department";

export type RequestScopeSelection = {
  departmentId: string | null;
  level: RequestScopeLevel;
  organizationId: string | null;
  tenantId: string | null;
};

export type RequestScope = RequestScopeSelection & {
  epoch: number;
  scopeKey: string;
};

export type DepartmentScopeMembership = {
  departmentId: string;
  organizationId: string;
  status: string;
  tenantId: string;
};

export type RequestScopePrincipal = {
  allowedScopes?: readonly RequestScopeLevel[];
  defaultScope?: {
    departmentId?: string | null;
    level: RequestScopeLevel;
    organizationId?: string | null;
  } | null;
  departmentMemberships?: readonly DepartmentScopeMembership[];
  memberships?: ReadonlyArray<{ organizationId: string; status: string }>;
  tenantId?: string | null;
  user: { id: string; tenantId?: string | null };
};

let activeScope: RequestScope | null = null;
let activeRequestController = new AbortController();
const listeners = new Set<(scope: RequestScope | null) => void>();

export function buildRequestScopeHeaders(
  scope: RequestScopeSelection | null,
): Record<string, string> {
  if (!scope) return {};

  const headers: Record<string, string> = {
    [REQUEST_SCOPE_LEVEL_HEADER]: scope.level,
  };

  if (scope.organizationId) {
    headers[ORGANIZATION_ID_HEADER] = scope.organizationId;
  }
  if (scope.departmentId) {
    headers[DEPARTMENT_ID_HEADER] = scope.departmentId;
  }

  return headers;
}

export function createRequestScope(
  selection: RequestScopeSelection,
  epoch = 0,
): RequestScope {
  const normalized = normalizeSelection(selection);
  return {
    ...normalized,
    epoch,
    scopeKey: [
      normalized.tenantId ?? "platform",
      normalized.level,
      normalized.organizationId ?? "none",
      normalized.departmentId ?? "none",
    ].join(":"),
  };
}

export function resolveInitialRequestScope(
  principal: RequestScopePrincipal,
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): RequestScope | null {
  const tenantId = principal.tenantId ?? principal.user.tenantId ?? null;
  const allowedScopes = resolveAllowedScopes(principal, tenantId);
  if (allowedScopes.length === 0) return null;

  const persisted = tenantId
    ? readStoredRequestScope(storage, tenantId, principal.user.id)
    : null;
  const candidates: RequestScopeSelection[] = [
    ...(persisted ? [persisted] : []),
    ...(principal.defaultScope
      ? [
          {
            departmentId: principal.defaultScope.departmentId ?? null,
            level: principal.defaultScope.level,
            organizationId: principal.defaultScope.organizationId ?? null,
            tenantId,
          },
        ]
      : []),
    ...fallbackSelections(principal, tenantId, allowedScopes),
  ];

  const selection = candidates.find((candidate) =>
    isRequestScopeAllowed(candidate, principal),
  );
  return selection ? createRequestScope(selection) : null;
}

export function isRequestScopeAllowed(
  selection: RequestScopeSelection,
  principal: RequestScopePrincipal,
): boolean {
  const tenantId = principal.tenantId ?? principal.user.tenantId ?? null;
  if (selection.tenantId !== tenantId) return false;

  const allowedScopes = resolveAllowedScopes(principal, tenantId);
  if (!allowedScopes.includes(selection.level)) return false;

  if (selection.level === "tenant") {
    return Boolean(tenantId && !selection.organizationId && !selection.departmentId);
  }

  const activeMemberships = (principal.memberships ?? []).filter(
    (membership) => membership.status === "active",
  );
  if (selection.level === "organization") {
    return Boolean(
      selection.organizationId &&
        !selection.departmentId &&
        activeMemberships.some(
          (membership) => membership.organizationId === selection.organizationId,
        ),
    );
  }

  return Boolean(
    selection.organizationId &&
      selection.departmentId &&
      (principal.departmentMemberships ?? []).some(
        (membership) =>
          membership.status === "active" &&
          membership.tenantId === tenantId &&
          membership.organizationId === selection.organizationId &&
          membership.departmentId === selection.departmentId,
      ),
  );
}

export function commitRequestScope(selection: RequestScopeSelection | null) {
  activeRequestController.abort("request-scope-changed");
  activeRequestController = new AbortController();
  const nextEpoch = (activeScope?.epoch ?? 0) + 1;
  activeScope = selection ? createRequestScope(selection, nextEpoch) : null;
  for (const listener of listeners) listener(activeScope);
  return activeScope;
}

export function getActiveRequestScope() {
  return activeScope;
}

export function getRequestScopeSignal() {
  return activeRequestController.signal;
}

export function subscribeToRequestScope(
  listener: (scope: RequestScope | null) => void,
) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function storeRequestScope(
  storage: Pick<Storage, "setItem"> | null,
  userId: string,
  scope: RequestScopeSelection,
) {
  if (!storage || !scope.tenantId) return;
  storage.setItem(
    requestScopeStorageKey(scope.tenantId, userId),
    JSON.stringify(normalizeSelection(scope)),
  );
}

export function readStoredRequestScope(
  storage: Pick<Storage, "getItem"> | null,
  tenantId: string,
  userId: string,
): RequestScopeSelection | null {
  const raw = storage?.getItem(requestScopeStorageKey(tenantId, userId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RequestScopeSelection>;
    if (
      value.tenantId !== tenantId ||
      !["tenant", "organization", "department"].includes(value.level ?? "")
    ) {
      return null;
    }
    return normalizeSelection({
      departmentId: value.departmentId ?? null,
      level: value.level as RequestScopeLevel,
      organizationId: value.organizationId ?? null,
      tenantId,
    });
  } catch {
    return null;
  }
}

export function requestScopeStorageKey(tenantId: string, userId: string) {
  return `${STORAGE_PREFIX}.${tenantId}:${userId}`;
}

function normalizeSelection(
  selection: RequestScopeSelection,
): RequestScopeSelection {
  if (selection.level === "tenant") {
    return { ...selection, departmentId: null, organizationId: null };
  }
  if (selection.level === "organization") {
    return { ...selection, departmentId: null };
  }
  return selection;
}

function resolveAllowedScopes(
  principal: RequestScopePrincipal,
  tenantId: string | null,
): readonly RequestScopeLevel[] {
  if (principal.allowedScopes?.length) return principal.allowedScopes;
  const inferred: RequestScopeLevel[] = [];
  if (tenantId) inferred.push("tenant");
  if (principal.memberships?.some((membership) => membership.status === "active")) {
    inferred.push("organization");
  }
  if (
    principal.departmentMemberships?.some(
      (membership) => membership.status === "active",
    )
  ) {
    inferred.push("department");
  }
  return inferred;
}

function fallbackSelections(
  principal: RequestScopePrincipal,
  tenantId: string | null,
  allowedScopes: readonly RequestScopeLevel[],
): RequestScopeSelection[] {
  const firstOrganization = principal.memberships?.find(
    (membership) => membership.status === "active",
  );
  const firstDepartment = principal.departmentMemberships?.find(
    (membership) => membership.status === "active",
  );
  const fallbacks: RequestScopeSelection[] = [];
  if (allowedScopes.includes("tenant")) {
    fallbacks.push({
      departmentId: null,
      level: "tenant",
      organizationId: null,
      tenantId,
    });
  }
  if (allowedScopes.includes("organization") && firstOrganization) {
    fallbacks.push({
      departmentId: null,
      level: "organization",
      organizationId: firstOrganization.organizationId,
      tenantId,
    });
  }
  if (allowedScopes.includes("department") && firstDepartment) {
    fallbacks.push({
      departmentId: firstDepartment.departmentId,
      level: "department",
      organizationId: firstDepartment.organizationId,
      tenantId,
    });
  }
  return fallbacks;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
