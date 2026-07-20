import { AdminShell } from "@/components/admin-shell";
import { PlatformAccessBoundary } from "@/components/platform-access-boundary";

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminShell>
      <PlatformAccessBoundary>{children}</PlatformAccessBoundary>
    </AdminShell>
  );
}
