"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
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
      router.replace("/organizations");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel wide">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true">
            H
          </div>
          <div>
            <p className="eyebrow">Hermes Swarm</p>
            <h1>初始化</h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              <span>组织名称</span>
              <input
                onChange={(event) => setOrganizationName(event.target.value)}
                value={organizationName}
              />
            </label>
            <label>
              <span>组织标识</span>
              <input
                onChange={(event) => setOrganizationSlug(event.target.value)}
                value={organizationSlug}
              />
            </label>
            <label>
              <span>管理员名称</span>
              <input
                onChange={(event) => setAdminName(event.target.value)}
                value={adminName}
              />
            </label>
            <label>
              <span>管理员邮箱</span>
              <input
                onChange={(event) => setAdminEmail(event.target.value)}
                type="email"
                value={adminEmail}
              />
            </label>
            <label>
              <span>管理员密码</span>
              <input
                onChange={(event) => setAdminPassword(event.target.value)}
                type="password"
                value={adminPassword}
              />
            </label>
          </div>

          {error && <div className="form-error">{error}</div>}

          <button
            className="primary-action full-width"
            disabled={loading || saving}
            type="submit"
          >
            创建并进入
          </button>
        </form>

        <div className="auth-links">
          <a href="/login">返回登录</a>
        </div>
      </section>
    </main>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
