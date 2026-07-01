"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPublicBootstrap, onboard } from "@/lib/admin-api";
import { storeSession } from "@/lib/session";

export function OnboardingPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("Hermes");
  const [organizationSlug, setOrganizationSlug] = useState("hermes");
  const [adminName, setAdminName] = useState("Admin");
  const [adminEmail, setAdminEmail] = useState("admin@hermes.local");
  const [adminPassword, setAdminPassword] = useState("admin123456");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await getPublicBootstrap();
        if (!data.onboardingRequired) {
          router.replace("/login");
          return;
        }
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await onboard({
        adminEmail,
        adminName,
        adminPassword,
        organizationName,
        organizationSlug,
      });

      storeSession({ token: response.token });
      router.replace("/home");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-2xl" size="sm">
        <CardHeader className="gap-3">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground">
              <AppIcon className="size-4" name="sparkles" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Hermes Swarm</p>
              <p className="text-xs">首次设置</p>
            </div>
          </div>
          <div className="grid gap-1">
            <CardTitle>初始化</CardTitle>
            <CardDescription>创建管理员账号和默认组织</CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={submit}>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="onboarding-organization-name">组织名称</Label>
                <Input
                  id="onboarding-organization-name"
                  onChange={(event) => setOrganizationName(event.target.value)}
                  value={organizationName}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="onboarding-organization-slug">组织标识</Label>
                <Input
                  id="onboarding-organization-slug"
                  onChange={(event) => setOrganizationSlug(event.target.value)}
                  value={organizationSlug}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="onboarding-admin-name">管理员名称</Label>
                <Input
                  id="onboarding-admin-name"
                  onChange={(event) => setAdminName(event.target.value)}
                  value={adminName}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="onboarding-admin-email">管理员邮箱</Label>
                <Input
                  id="onboarding-admin-email"
                  onChange={(event) => setAdminEmail(event.target.value)}
                  type="email"
                  value={adminEmail}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="onboarding-admin-password">管理员密码</Label>
                <Input
                  id="onboarding-admin-password"
                  onChange={(event) => setAdminPassword(event.target.value)}
                  type="password"
                  value={adminPassword}
                />
              </div>
            </div>

            {error && (
              <div
                className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm"
                role="alert"
              >
                {error}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button asChild className="w-full sm:w-auto" variant="ghost">
              <a href="/login">返回登录</a>
            </Button>
            <Button
              className="w-full sm:w-auto"
              disabled={loading || saving}
              type="submit"
            >
              创建并进入
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
