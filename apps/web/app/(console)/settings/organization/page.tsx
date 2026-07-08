"use client";

import { useAdminShell } from "@/components/admin-shell";
import { OrganizationDetailPage } from "@/components/organization-detail-page";

export default function OrganizationPage() {
  const { snapshot } = useAdminShell();

  return <OrganizationDetailPage organizationId={snapshot?.organization?.id} />;
}
