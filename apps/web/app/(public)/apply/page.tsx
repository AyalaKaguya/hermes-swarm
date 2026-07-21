import { Suspense } from "react";
import { WorkspaceApplicationForm } from "@/components/workspace-application-form";

export default function ApplyPage() {
  return (
    <Suspense>
      <WorkspaceApplicationForm />
    </Suspense>
  );
}
