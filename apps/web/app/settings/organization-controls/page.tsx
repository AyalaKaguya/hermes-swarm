"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminShell } from "@/components/admin-shell";

export default function OrganizationControlsPage() {
  const router = useRouter();
  const { snapshot } = useAdminShell();

  useEffect(() => {
    if (snapshot?.organization?.id) {
      router.replace(`/settings/organizations/${snapshot.organization.id}`);
    }
  }, [router, snapshot?.organization?.id]);

  return (
    <div className="flex items-center justify-center py-16 text-sm">
      加载中...
    </div>
  );
}
