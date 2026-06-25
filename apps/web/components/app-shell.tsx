"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { UserAvatar } from "@/components/user-avatar";
import type { User } from "@/lib/admin-api";

export type AppShellNavItem = {
  badge?: string;
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
    items: [{ href: "/organizations", key: "organizations", label: "组织用户" }],
    key: "workspace",
    label: "工作台",
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
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            H
          </div>
          <div>
            <strong>Hermes</strong>
            <span>Swarm</span>
          </div>
        </div>
        <nav>
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
        <header className="topbar">
          <div>
            <span>{organizationName ?? "Hermes Swarm"}</span>
            <strong>{roleLabel ?? "Console"}</strong>
          </div>
          <div className="topbar-user">
            <UserAvatar size="md" user={user} />
            <span>{user?.email ?? "未确认用户"}</span>
          </div>
        </header>
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
        {content}
      </button>
    );
  }

  return (
    <a className={active ? "active" : ""} href={item.href}>
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
