import type { ReactNode } from "react";

const navItems = [
  { href: "/organizations", key: "organizations", label: "组织用户" },
];

export function AppShell({
  activeItem = "organizations",
  actions,
  children,
}: {
  activeItem?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
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
          {navItems.map((item) => (
            <a
              className={item.key === activeItem ? "active" : ""}
              href={item.href}
              key={item.key}
            >
              {item.label}
            </a>
          ))}
        </nav>
        {actions && <div className="sidebar-actions">{actions}</div>}
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
