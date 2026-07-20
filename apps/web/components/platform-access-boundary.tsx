"use client";

import { usePathname } from "next/navigation";
import { findPageAccessDefinitionsByPath } from "@hermes-swarm/rbac-api";
import { useAdminShell } from "@/components/admin-shell";
import { hasPageAccess } from "@/lib/access-control";

export function PlatformAccessBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { resolvedSession } = useAdminShell();
  const definitions = findPageAccessDefinitionsByPath(pathname).filter(
    (definition) => definition.scope === "platform",
  );
  const allowed =
    definitions.length > 0 &&
    definitions.some((definition) =>
      hasPageAccess(resolvedSession, definition.key),
    );

  if (allowed) return children;
  return (
    <div className="flex min-h-[360px] items-center justify-center p-6">
      <div className="grid max-w-md gap-2 text-center">
        <div className="text-base font-semibold">无权访问此页面</div>
        <div className="text-sm text-muted-foreground">
          当前平台角色未获得此页面所需的权限。
        </div>
      </div>
    </div>
  );
}
