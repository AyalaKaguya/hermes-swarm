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
  commitOrganizationSelection,
  getActiveOrganizationSelection,
  initializeOrganizationSelection,
  isOrganizationSelectionAllowed,
  resolveInitialOrganizationSelection,
  subscribeToOrganizationSelection,
  type OrganizationSelection,
  type OrganizationSelectionPrincipal,
} from "@/lib/organization-context";

type OrganizationContextValue = {
  activeOrganizationId: string | null;
  epoch: number;
  selection: OrganizationSelection | null;
  switchOrganization: (organizationId: string | null) => Promise<OrganizationSelection>;
};

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export function OrganizationContextProvider({
  children,
  principal,
}: {
  children: ReactNode;
  principal: OrganizationSelectionPrincipal;
}) {
  const [selection, setSelection] = useState<OrganizationSelection | null>(() => {
    const active = getActiveOrganizationSelection();
    if (
      active &&
      active.tenantId === (principal.tenantId ?? principal.user?.tenantId) &&
      isOrganizationSelectionAllowed(active.activeOrganizationId, principal)
    ) {
      return active;
    }
    return initializeOrganizationSelection(
      resolveInitialOrganizationSelection(principal),
    );
  });

  useEffect(() => subscribeToOrganizationSelection(setSelection), []);
  useEffect(() => {
    if (
      selection &&
      isOrganizationSelectionAllowed(selection.activeOrganizationId, principal)
    ) {
      return;
    }
    setSelection(
      initializeOrganizationSelection(resolveInitialOrganizationSelection(principal)),
    );
  }, [principal, selection]);

  const switchOrganization = useCallback(
    async (organizationId: string | null) =>
      commitOrganizationSelection(principal, organizationId),
    [principal],
  );
  const value = useMemo<OrganizationContextValue>(
    () => ({
      activeOrganizationId: selection?.activeOrganizationId ?? null,
      epoch: selection?.epoch ?? 0,
      selection,
      switchOrganization,
    }),
    [selection, switchOrganization],
  );
  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganizationContext() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error();
  }
  return context;
}
