import { Suspense } from "react";
import { TenantApplicationForm } from "@/components/tenant-application-form";

export default function ApplyPage() {
  return (
    <Suspense>
      <TenantApplicationForm />
    </Suspense>
  );
}
