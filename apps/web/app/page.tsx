import { AppShell } from "@/components/app-shell";
import { TenantAdminConsole } from "@/components/tenant-admin-console";

export default function Home() {
  return (
    <AppShell>
      <section className="page-header">
        <div>
          <p className="eyebrow">Hermes Swarm</p>
          <h1>多租户管理</h1>
        </div>
      </section>
      <TenantAdminConsole />
    </AppShell>
  );
}
