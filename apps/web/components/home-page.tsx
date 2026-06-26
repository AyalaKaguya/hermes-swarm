"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSnapshot } from "@/lib/admin-api";
import type { Snapshot } from "@/lib/admin-api";
import {
  clearStoredSession,
  getStoredSession,
  resolveSession,
} from "@/lib/session";
import type { ResolvedSession } from "@/lib/session";

export function HomePage() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSnapshot() {
      const session = getStoredSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      try {
        const data = await getSnapshot(session.token);
        setSnapshot(data);
        setResolvedSession(resolveSession(data));
      } catch {
        clearStoredSession();
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }

    void loadSnapshot();
  }, [router]);

  const organization = snapshot?.organization ?? resolvedSession?.organization;
  const activeMenus = snapshot?.menus.filter((menu) => menu.isActive) ?? [];
  const activeUsers =
    snapshot?.users.filter((user) => user.status === "active").length ?? 0;
  const disabledUsers =
    snapshot?.users.filter((user) => user.status !== "active").length ?? 0;

  const summaryItems = [
    {
      href: "/settings/users",
      icon: "users",
      label: "用户",
      value: String(snapshot?.users.length ?? 0),
      detail: `${activeUsers} 启用 / ${disabledUsers} 禁用`,
    },
    {
      href: "/settings/groups",
      icon: "layers",
      label: "用户组",
      value: "管理",
      detail: "按成员组织访问范围",
    },
    {
      href: "/settings/roles",
      icon: "shield",
      label: "角色",
      value: String(snapshot?.roles.length ?? 0),
      detail: `${snapshot?.rolePermissions.filter((item) => item.enabled).length ?? 0} 条权限`,
    },
    {
      href: "/settings/features",
      icon: "grid",
      label: "菜单",
      value: String(activeMenus.length),
      detail: `${snapshot?.menus.length ?? 0} 个已配置项`,
    },
  ] satisfies Array<{
    detail: string;
    href: string;
    icon: AppIconName;
    label: string;
    value: string;
  }>;

  const quickActions = [
    { href: "/settings/users", icon: "users", label: "用户管理" },
    { href: "/settings/email-templates", icon: "file", label: "邮件模板" },
    { href: "/settings/custom-smtp", icon: "settings", label: "SMTP" },
    { href: "/settings/features", icon: "grid", label: "功能开关" },
  ] satisfies Array<{ href: string; icon: AppIconName; label: string }>;

  return (
    <AppShell
      organizationName={organization?.name}
      user={resolvedSession?.user}
    >
      {loading ? (
        <section aria-label="主页加载中" className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="grid gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-5 w-14" />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={index}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-16" />
                </CardHeader>
                <CardContent className="grid gap-2">
                  <Skeleton className="h-7 w-12" />
                  <Skeleton className="h-3 w-28" />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : (
        <section aria-label="主页" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">控制台</h1>
              <p className="text-sm text-muted-foreground">
                {organization?.name ?? "管理控制台"}
              </p>
            </div>
            {organization && (
              <Badge variant={organization.status === "active" ? "default" : "secondary"}>
                {organization.status === "active" ? "启用" : "已停用"}
              </Badge>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {summaryItems.map((item) => (
              <Card key={item.href}>
                <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
                  <CardTitle className="text-sm font-medium">{item.label}</CardTitle>
                  <AppIcon className="size-4 text-muted-foreground" name={item.icon} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{item.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Card>
              <CardHeader>
                <CardTitle>常用入口</CardTitle>
                <CardDescription>进入组织管理、邮件和功能配置</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {quickActions.map((action) => (
                  <Button
                    asChild
                    className="justify-start"
                    key={action.href}
                    variant="outline"
                  >
                    <Link href={action.href}>
                      <AppIcon className="size-4" name={action.icon} />
                      {action.label}
                    </Link>
                  </Button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>当前范围</CardTitle>
                <CardDescription>登录后使用的组织上下文</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">组织</span>
                  <span className="truncate font-medium">{organization?.name ?? "-"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">标识</span>
                  <span className="truncate font-mono text-xs">{organization?.slug ?? "-"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">用户</span>
                  <span className="truncate">{resolvedSession?.user.displayName ?? "-"}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}
    </AppShell>
  );
}
