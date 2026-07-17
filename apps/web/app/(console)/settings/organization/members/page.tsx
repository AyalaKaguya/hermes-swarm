"use client";

import { useAdminShell } from "@/components/admin-shell";
import { OrganizationDetailPage } from "@/components/organization-detail-page";
import { useOrganizationContext } from "@/components/organization-context-provider";

export default function OrganizationMembersPage() {
  const { snapshot } = useAdminShell();
  const { activeOrganizationId } = useOrganizationContext();

  return (
    <OrganizationDetailPage
      organizationId={activeOrganizationId ?? snapshot?.organization?.id}
      section="members"
    />
  );
}
