"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
import { InlineNotice } from "@/components/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateTenant } from "@/lib/admin-api";
import { requireAuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";

export default function TenantConsolePage() {
  const t = useTranslations("tenantScope");
  const common = useTranslations("common");
  const { refreshSnapshot, snapshot } = useAdminShell();
  const tenant = snapshot?.tenant ?? null;
  const [name, setName] = useState(tenant?.name ?? "");
  const [slug, setSlug] = useState(tenant?.slug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(tenant?.name ?? "");
    setSlug(tenant?.slug ?? "");
  }, [tenant?.id, tenant?.name, tenant?.slug]);

  if (!tenant) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await updateTenant(session, { name: name.trim() });
      await refreshSnapshot();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t("tenantConsole")}</h1>
        <p className="text-sm text-muted-foreground">{t("tenantDescription")}</p>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("workspaceProfile")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={submit}>
              <div className="grid gap-2">
                <Label htmlFor="tenant-name">{t("tenantName")}</Label>
                <Input
                  id="tenant-name"
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tenant-slug">{t("tenantSlug")}</Label>
                <Input
                  disabled
                  id="tenant-slug"
                  value={slug}
                />
              </div>
              <div className="flex justify-end">
                <Button disabled={saving} type="submit">
                  {saving ? common("saving") : common("save")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("tenantStatus")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={tenant.status === "active" ? "default" : "secondary"}>
                {tenant.status}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid gap-2 pt-6">
              <Button asChild variant="outline">
                <Link href="/settings/organizations">{t("organizations")}</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
