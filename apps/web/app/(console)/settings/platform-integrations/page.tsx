import { redirect } from "next/navigation";

export default function RemovedPlatformIntegrationsPage() {
  redirect("/settings/platform");
}
