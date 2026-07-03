"use client";

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { usePermission } from "@/hooks/use-permission";
import type { AccessMode } from "@hermes-swarm/access";

type AccessGateProps = {
  children: ReactNode;
  disabledInsteadOfHidden?: boolean;
  fallback?: ReactNode;
  mode?: AccessMode;
  pageKey?: string;
  permission?: string;
  permissions?: string | string[];
};

export function AccessGate({
  children,
  disabledInsteadOfHidden = false,
  fallback = null,
  mode = "any",
  pageKey,
  permission,
  permissions,
}: AccessGateProps) {
  const access = usePermission();
  const requiredPermissions = permissions ?? permission;
  const allowed = Boolean(
    access.resolvedSession &&
      (!pageKey || access.hasPageAccess(pageKey)) &&
      (!requiredPermissions ||
        access.hasPermission(requiredPermissions, { mode })),
  );

  if (allowed) return children;
  if (!disabledInsteadOfHidden) return fallback;
  if (!isValidElement(children)) return fallback;
  return cloneElement(children as ReactElement<{ disabled?: boolean }>, {
    disabled: true,
  });
}
