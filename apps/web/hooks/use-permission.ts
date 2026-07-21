"use client";

import { useMemo } from "react";
import { useAdminShell } from "@/components/admin-shell";
import {
  hasPageAccess as checkPageAccess,
  hasPermission as checkPermission,
} from "@/lib/access-control";
import type { AccessMode } from "@hermes-swarm/rbac-api";

export function usePermission() {
  const { resolvedSession, snapshot } = useAdminShell();
  const permissionSet = useMemo(
    () => new Set(resolvedSession?.permissions ?? []),
    [resolvedSession?.permissions],
  );

  return {
    hasPageAccess: (pageKey: string) =>
      checkPageAccess(resolvedSession, pageKey),
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
