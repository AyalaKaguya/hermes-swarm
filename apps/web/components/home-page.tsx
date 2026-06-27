"use client";

import Link from "next/link";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage() {
  const { resolvedSession, snapshot } = useAdminShell();
  const organization = snapshot?.organization ?? resolvedSession?.organization;
  const organizationSettingsHref = organization
    ? `/settings/organizations/${organization.id}`
    : "/settings/account";
  const isPlatformScope = snapshot?.scope.level === "platform";
  const activeMenus = snapshot?.menus.filter((menu) => menu.isActive) ?? [];
  const activeUsers =
    snapshot?.users.filter((user) => user.status === "active").length ?? 0;
  const disabledUsers =
    snapshot?.users.filter((user) => user.status !== "active").length ?? 0;

  const summaryItems = [
    {
      href: `${organizationSettingsHref}?tab=members`,
      icon: "users",
      label: "用户",
      value: String(snapshot?.users.length ?? 0),
      detail: `${activeUsers} 启用 / ${disabledUsers} 禁用`,
    },
    {
      href: `${organizationSettingsHref}?tab=groups`,
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
      href: "/settings/menus",
      icon: "menu",
      label: "网页",
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
    {
      href: isPlatformScope ? "/settings/tenant" : `${organizationSettingsHref}?tab=members`,
      icon: "users",
      label: isPlatformScope ? "平台设置" : "成员管理",
    },
    { href: "/settings/email-templates", icon: "file", label: "邮件模板" },
    { href: "/settings/custom-smtp", icon: "settings", label: "SMTP" },
    { href: "/settings/features", icon: "grid", label: "功能开关" },
  ] satisfies Array<{ href: string; icon: AppIconName; label: string }>;

  return (
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
  );
}
