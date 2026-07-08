"use client";

import { useParams } from "next/navigation";
import { OrganizationDetailPage } from "@/components/organization-detail-page";

export default function PlatformOrganizationDetailPage() {
  const params = useParams<{ orgId?: string | string[] }>();
  const organizationId = Array.isArray(params.orgId)
    ? params.orgId[0]
    : params.orgId;

  return <OrganizationDetailPage organizationId={organizationId} />;
}
