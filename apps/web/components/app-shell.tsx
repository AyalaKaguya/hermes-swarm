"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { UserAvatar } from "@/components/user-avatar";
import type { User } from "@/lib/admin-api";

export type AppShellNavItem = {
  badge?: string;
  icon?: import("@/components/app-icon").AppIconName;
  href: string;
  key: string;
  label: string;
};

export type AppShellNavSection = {
  badge?: string;
  items: AppShellNavItem[];
  key: string;
  label: string;
};

const fallbackNavSections: AppShellNavSection[] = [
  {
    items: [
      { href: "/organizations", icon: "users", key: "organizations", label: "用户" },
    ],
    key: "workspace",
    label: "组织范围",
  },
];

export function AppShell({
  actions,
  activeItem,
  children,
  navSections,
  onNavigate,
  organizationName,
  roleLabel,
  user,
}: {
  actions?: ReactNode;
  activeItem?: string;
  children: ReactNode;
  navSections?: AppShellNavSection[];
  onNavigate?: (item: AppShellNavItem) => void;
  organizationName?: string | null;
  roleLabel?: string | null;
  user?: User | null;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  const sections = navSections?.length ? navSections : fallbackNavSections;

  useEffect(() => {
    function syncHash() {
      setHash(window.location.hash);
    }

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar sidebar-rail" aria-label="快速导航">
        <button className="sidebar-rail-toggle" type="button">
          <AppIcon name="panel" />
        </button>
        <div className="sidebar-rail-group">
          <button className="sidebar-rail-item active" type="button">
            <AppIcon name="building" />
          </button>
          <button className="sidebar-rail-item" type="button">
            <AppIcon name="bot" />
          </button>
          <button className="sidebar-rail-item" type="button">
            <AppIcon name="chart" />
          </button>
          <button className="sidebar-rail-item" type="button">
            <AppIcon name="layers" />
          </button>
          <button className="sidebar-rail-item" type="button">
            <AppIcon name="grid" />
          </button>
          <button className="sidebar-rail-item" type="button">
            <AppIcon name="database" />
          </button>
        </div>
        <div className="sidebar-rail-bottom">
          <button className="sidebar-rail-item" type="button">
            <AppIcon name="bell" />
          </button>
          <button className="sidebar-rail-item" type="button">
            <AppIcon name="settings" />
          </button>
          <div className="sidebar-rail-avatar">
            <UserAvatar size="sm" user={user} />
          </div>
        </div>
      </aside>
      <aside className="sidebar sidebar-panel" aria-label="主导航">
        <div className="scope-card">
          <div className="scope-card-icon" aria-hidden="true">
            <AppIcon name="building" />
          </div>
          <div>
            <span>当前范围</span>
            <strong>{organizationName ?? "组织范围"}</strong>
            <small>{roleLabel || "管理控制台"}</small>
          </div>
        </div>
        <nav className="sidebar-nav">
          {sections.map((section) => (
            <div className="nav-section" key={section.key}>
              <div className="nav-section-label">
                <span>{section.label}</span>
                {section.badge && <em>{section.badge}</em>}
              </div>
              {section.items.map((item) => (
                <NavItem
                  active={
                    activeItem
                      ? item.key === activeItem
                      : isActiveNavItem(item.href, pathname, hash)
                  }
                  item={item}
                  key={item.key}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-actions">
          <div className="sidebar-user">
            <UserAvatar size="sm" user={user} />
            <div>
              <strong>{user?.displayName ?? "未登录"}</strong>
              <span>{roleLabel || organizationName || "管理控制台"}</span>
            </div>
          </div>
          {actions}
        </div>
      </aside>
      <main className="main-content">
        <div className="topbar-spacer" aria-hidden="true" />
        {children}
      </main>
    </div>
  );
}

function NavItem({
  active,
  item,
  onNavigate,
}: {
  active: boolean;
  item: AppShellNavItem;
  onNavigate?: (item: AppShellNavItem) => void;
}) {
  const content = (
    <>
      <span>{item.label}</span>
      {item.badge && <em>{item.badge}</em>}
    </>
  );

  if (onNavigate) {
    return (
      <button
        className={active ? "sidebar-nav-button active" : "sidebar-nav-button"}
        onClick={() => onNavigate(item)}
        type="button"
      >
        <AppIcon className="nav-item-icon" name={item.icon ?? "users"} />
        {content}
      </button>
    );
  }

  return (
    <a className={active ? "active" : ""} href={item.href}>
      <AppIcon className="nav-item-icon" name={item.icon ?? "users"} />
      {content}
    </a>
  );
}

function isActiveNavItem(href: string, pathname: string, hash: string) {
  const [path, itemHash] = href.split("#");
  if (path !== pathname) return false;
  if (!itemHash) return true;
  return hash === `#${itemHash}`;
}
