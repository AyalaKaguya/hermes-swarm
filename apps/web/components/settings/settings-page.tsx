"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type SettingsNavItem = {
  href: string;
  icon: AppIconName;
  label: string;
};

export function SettingsSubnav({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: readonly SettingsNavItem[];
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={ariaLabel}
      className="flex min-w-0 gap-1 overflow-x-auto rounded-md border bg-muted/20 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm transition-colors hover:bg-accent",
              active && "bg-background font-medium shadow-sm",
            )}
            href={item.href}
            key={item.href}
          >
            <AppIcon className="size-4" name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SettingsPageHeader({
  actions,
  description,
  title,
}: {
  actions?: ReactNode;
  description: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actions}
    </div>
  );
}

export function SettingsCard({
  actions,
  children,
  description,
  headerActions,
  loading = false,
  loadingLabel = "加载中...",
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description: ReactNode;
  headerActions?: ReactNode;
  loading?: boolean;
  loadingLabel?: ReactNode;
  title: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {headerActions}
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {loadingLabel}
          </div>
        ) : (
          <>
            {children}
            {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsFieldRow({
  actions,
  children,
  className,
  description,
  htmlFor,
  label,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  htmlFor?: string;
  label: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 rounded-md border p-3 lg:items-center",
        actions
          ? "lg:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_auto]"
          : "lg:grid-cols-[minmax(180px,0.85fr)_minmax(220px,1.15fr)]",
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <Label className="text-sm font-medium" htmlFor={htmlFor}>
            {label}
          </Label>
        ) : (
          <div className="text-sm font-medium">{label}</div>
        )}
        {description && (
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
      {actions && <div className="flex items-center justify-end gap-2">{actions}</div>}
    </div>
  );
}
