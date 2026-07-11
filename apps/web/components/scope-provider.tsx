"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  commitRequestScope,
  getActiveRequestScope,
  isRequestScopeAllowed,
  resolveInitialRequestScope,
  storeRequestScope,
  subscribeToRequestScope,
  type RequestScope,
  type RequestScopeLevel,
  type RequestScopePrincipal,
  type RequestScopeSelection,
} from "@/lib/request-scope";

type ScopeTarget = {
  departmentId?: string | null;
  level: RequestScopeLevel;
  organizationId?: string | null;
};

type ScopeContextValue = {
  scope: RequestScope | null;
  switchScope: (target: ScopeTarget) => Promise<RequestScope>;
};

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({
  children,
  principal,
}: {
  children: ReactNode;
  principal: RequestScopePrincipal;
}) {
  const [scope, setScope] = useState<RequestScope | null>(() => {
    const active = getActiveRequestScope();
    if (active && isRequestScopeAllowed(active, principal)) return active;
    return resolveInitialRequestScope(principal);
  });

  useEffect(() => {
    const unsubscribe = subscribeToRequestScope(setScope);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (scope && isRequestScopeAllowed(scope, principal)) return;
    const fallback = resolveInitialRequestScope(principal);
    setScope(commitRequestScope(fallback));
  }, [principal, scope]);

  const switchScope = useCallback(
    async (target: ScopeTarget) => {
      const tenantId = principal.tenantId ?? principal.user.tenantId ?? null;
      const selection: RequestScopeSelection = {
        departmentId: target.departmentId ?? null,
        level: target.level,
        organizationId: target.organizationId ?? null,
        tenantId,
      };

      if (!isRequestScopeAllowed(selection, principal)) {
        throw new Error("The requested scope is not available to this session.");
      }

      const next = commitRequestScope(selection);
      if (!next) throw new Error("Unable to activate the requested scope.");
      storeRequestScope(
        typeof window === "undefined" ? null : window.localStorage,
        principal.user.id,
        next,
      );
      setScope(next);
      return next;
    },
    [principal],
  );

  const value = useMemo<ScopeContextValue>(
    () => ({ scope, switchScope }),
    [scope, switchScope],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useRequestScope() {
  const context = useContext(ScopeContext);
  if (!context) {
    throw new Error("useRequestScope must be used inside ScopeProvider.");
  }
  return context;
}
