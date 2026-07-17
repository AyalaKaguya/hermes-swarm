import { redirect } from "next/navigation";

export default function TenantSettingsPage() {
  redirect("/settings/tenant/general");
}
