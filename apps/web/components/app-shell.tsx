const navItems = ["租户", "组织", "用户", "权限"];

export function AppShell({ children }: { children: React.ReactNode }) {
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
          {navItems.map((item, index) => (
            <a className={index === 0 ? "active" : ""} href="#" key={item}>
              {item}
            </a>
          ))}
        </nav>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
