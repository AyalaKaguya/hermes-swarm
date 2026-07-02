"use client";

import { useMemo } from "react";
import { useAdminShell } from "@/components/admin-shell";
import {
  hasPageAccess as checkPageAccess,
  hasPermission as checkPermission,
} from "@/lib/access-control";
import type { AccessMode } from "@hermes-swarm/access";

export function usePermission() {
  const { resolvedSession, snapshot } = useAdminShell();
  const permissionSet = useMemo(
    () => new Set(resolvedSession?.permissions ?? []),
    [resolvedSession?.permissions],
  );

  return {
    hasPageAccess: (
      pageKey: string,
      routeContext: { organizationId?: string | null } = {},
    ) =>
      checkPageAccess(resolvedSession, pageKey, {
        organizationId:
          routeContext.organizationId ?? snapshot?.organization?.id ?? null,
      }),
    hasPermission: (
      permissions: string | string[],
      options: { mode?: AccessMode } = {},
    ) => checkPermission(resolvedSession, permissions, options),
    permissions: resolvedSession?.permissions ?? [],
    permissionSet,
    resolvedSession,
    snapshot,
  };
}
