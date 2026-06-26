"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { getSnapshot } from "@/lib/admin-api";
import type { Snapshot } from "@/lib/admin-api";
import {
  clearStoredSession,
  getStoredSession,
  resolveSession,
} from "@/lib/session";
import type { ResolvedSession } from "@/lib/session";

export function HomePage() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);

  useEffect(() => {
    async function loadSnapshot() {
      const session = getStoredSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      try {
        const data = await getSnapshot(session.token);
        setSnapshot(data);
        setResolvedSession(resolveSession(data));
      } catch {
        clearStoredSession();
        router.replace("/login");
      }
    }

    void loadSnapshot();
  }, [router]);

  const organization = snapshot?.organization ?? resolvedSession?.organization;

  return (
    <AppShell
      organizationName={organization?.name}
      user={resolvedSession?.user}
    >
      <section className="home-blank" aria-label="主页" />
    </AppShell>
  );
}
