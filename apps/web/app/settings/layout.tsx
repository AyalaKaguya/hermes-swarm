"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppShell, type AppShellNavSection } from "@/components/app-shell";
import { getSnapshot } from "@/lib/admin-api";
import type { Snapshot } from "@/lib/admin-api";
import {
  clearStoredSession,
  getStoredSession,
  hasMenuAccess,
  resolveSession,
} from "@/lib/session";
import type { ResolvedSession } from "@/lib/session";

const SETTINGS_NAV_SECTIONS: AppShellNavSection[] = [
  {
    items: [
      { href: "/settings/account", icon: "user", key: "account", label: "账号" },
      { href: "/settings/users", icon: "users", key: "users", label: "用户" },
      { href: "/settings/groups", icon: "users", key: "groups", label: "用户组" },
      { href: "/settings/roles", icon: "shield", key: "roles", label: "角色与权限" },
      { href: "/settings/email-templates", icon: "file", key: "email-templates", label: "邮件模板" },
      { href: "/settings/custom-smtp", icon: "settings", key: "custom-smtp", label: "自定义 SMTP" },
      { href: "/settings/features", icon: "grid", key: "features", label: "功能" },
      { href: "/settings/organizations", icon: "building", key: "organizations", label: "组织" },
      { href: "/settings/tenant", icon: "server", key: "tenant", label: "租户" },
    ],
    key: "settings",
    label: "",
  },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] = useState<ResolvedSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const session = getStoredSession();
      if (!session) {
        setLoading(false);
        return;
      }
      try {
        const data = await getSnapshot(session.token);
        setSnapshot(data);
        setResolvedSession(resolveSession(data));
      } catch {
        clearStoredSession();
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const visibleItems = SETTINGS_NAV_SECTIONS[0].items.filter((item) => {
    if (!snapshot || !resolvedSession) return false;
    const menu = snapshot.menus.find((candidate) => candidate.code === item.key);
    return Boolean(menu?.isActive) && hasMenuAccess(snapshot, resolvedSession, item.key);
  });
  const navSections = visibleItems.length
    ? [{ ...SETTINGS_NAV_SECTIONS[0], items: visibleItems }]
    : [];

  const activeKey = visibleItems.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  )?.key;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-sm text-muted-foreground">加载中...</span>
      </div>
    );
  }

  return (
    <AppShell
      activeItem={activeKey}
      navSections={navSections}
      organizationName={snapshot?.organization?.name ?? resolvedSession?.organization?.name}
      user={resolvedSession?.user}
    >
      <div className="flex flex-col gap-6 p-6">
        {children}
      </div>
    </AppShell>
  );
}
