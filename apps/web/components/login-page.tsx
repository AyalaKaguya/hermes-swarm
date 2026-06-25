"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getPublicBootstrap, login } from "@/lib/admin-api";
import {
  clearStoredSession,
  hasAnyManagementAccess,
  resolveSession,
  storeSession,
} from "@/lib/session";

export function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@hermes.local");
  const [password, setPassword] = useState("admin123456");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    clearStoredSession();

    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await getPublicBootstrap();
        if (data.onboardingRequired) {
          router.replace("/onboarding");
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
    setError("");

    try {
      const response = await login({ email, password });
      const resolvedSession = resolveSession(response.snapshot);

      if (!hasAnyManagementAccess(response.snapshot, resolvedSession)) {
        setError("当前用户没有管理端访问权限");
        return;
      }

      storeSession({ token: response.token });
      router.replace("/organizations");
    } catch (loginError) {
      setError(getErrorMessage(loginError));
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true">
            H
          </div>
          <div>
            <p className="eyebrow">Hermes Swarm</p>
            <h1>登录</h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>邮箱</span>
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@hermes.local"
              type="email"
              value={email}
            />
          </label>

          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
              type="password"
              value={password}
            />
          </label>

          {error && <div className="form-error">{error}</div>}

          <button
            className="primary-action full-width"
            disabled={loading || !email || !password}
            type="submit"
          >
            登录
          </button>
        </form>
      </section>
    </main>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
