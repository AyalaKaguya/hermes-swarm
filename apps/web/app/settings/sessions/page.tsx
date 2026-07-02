"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useNotifications } from "@/components/app-notifications";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  deleteAuthSessionRecord,
  listAuthSessions,
  revokeAuthSession,
  revokeOtherAuthSessions,
  type AuthSessionDevice,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export default function SessionsPage() {
  const notifications = useNotifications();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AuthSessionDevice[]>([]);

  const loadSessions = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.accessToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setSessions(await listAuthSessions(session.accessToken));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录设备加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function revokeSession(sessionId: string) {
    const session = getStoredSession();
    if (!session?.accessToken) return;

    setBusySessionId(sessionId);
    setError(null);
    try {
      await revokeAuthSession(session.accessToken, sessionId);
      notifications.success("设备已登出");
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登出失败");
    } finally {
      setBusySessionId(null);
    }
  }

  async function revokeOtherSessions() {
    const session = getStoredSession();
    if (!session?.accessToken) return;

    setBusySessionId("others");
    setError(null);
    try {
      await revokeOtherAuthSessions(session.accessToken);
      notifications.success("其他设备已登出");
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登出失败");
    } finally {
      setBusySessionId(null);
    }
  }

  async function deleteSessionRecord(sessionId: string) {
    const session = getStoredSession();
    if (!session?.accessToken) return;

    setBusySessionId(sessionId);
    setError(null);
    try {
      await deleteAuthSessionRecord(session.accessToken, sessionId);
      notifications.success("设备记录已删除");
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusySessionId(null);
    }
  }

  const activeSessions = sessions.filter(
    (item) => !item.revokedAt && !item.isExpired,
  );
  const inactiveSessions = sessions.filter(
    (item) => Boolean(item.revokedAt) || item.isExpired,
  );

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      {error && (
        <div
          className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-1">
            <CardTitle>登录设备</CardTitle>
            <CardDescription>查看当前账号已经登录的浏览器终端</CardDescription>
          </div>
          <Button
            disabled={
              loading ||
              busySessionId === "others" ||
              sessions.every(
                (item) => item.isCurrent || item.revokedAt || item.isExpired,
              )
            }
            onClick={revokeOtherSessions}
            type="button"
            variant="outline"
          >
            登出其他设备
          </Button>
        </CardHeader>
        <CardContent className="grid gap-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              加载中...
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              暂无登录设备
            </div>
          ) : (
            <>
              <SessionSection
                emptyText="暂无活跃设备"
                items={activeSessions}
                title="活跃设备"
              >
                {(item) => (
                  <SessionDeviceRow
                    device={item}
                    key={item.sessionId}
                    onDeleteRecord={() => deleteSessionRecord(item.sessionId)}
                    onRevoke={() => revokeSession(item.sessionId)}
                    working={busySessionId === item.sessionId}
                  />
                )}
              </SessionSection>

              <SessionSection
                description="这些记录已经不能继续访问账号，查看后可直接删除。"
                emptyText="暂无过期或已登出的设备"
                items={inactiveSessions}
                title="过期和已登出设备"
              >
                {(item) => (
                  <SessionDeviceRow
                    device={item}
                    key={item.sessionId}
                    onDeleteRecord={() => deleteSessionRecord(item.sessionId)}
                    onRevoke={() => revokeSession(item.sessionId)}
                    working={busySessionId === item.sessionId}
                  />
                )}
              </SessionSection>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SessionSection({
  children,
  description,
  emptyText,
  items,
  title,
}: {
  children: (item: AuthSessionDevice) => ReactNode;
  description?: string;
  emptyText: string;
  items: AuthSessionDevice[];
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="grid gap-3">{items.map((item) => children(item))}</div>
      )}
    </section>
  );
}

function SessionDeviceRow({
  device,
  onDeleteRecord,
  onRevoke,
  working,
}: {
  device: AuthSessionDevice;
  onDeleteRecord: () => void;
  onRevoke: () => void;
  working: boolean;
}) {
  const status = getSessionStatus(device);
  const historical = Boolean(device.revokedAt || device.isExpired);
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-label={status.label}
            className={status.className}
            role="status"
            title={status.label}
          />
          <div className="truncate text-sm font-medium">
            {device.deviceLabel}
          </div>
        </div>
        <div className="grid gap-0.5 text-xs text-muted-foreground sm:grid-cols-2">
          <span>IP：{device.ipAddress ?? "未知"}</span>
          <span>最近活跃：{formatDateTime(device.lastSeenAt)}</span>
          <span>创建时间：{formatDateTime(device.createdAt)}</span>
          <span>过期时间：{formatDateTime(device.expiresAt)}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {device.isCurrent ? (
          <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
            当前设备
          </span>
        ) : historical ? (
          <>
            <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
              {status.label}
            </span>
            <Button
              disabled={working}
              onClick={onDeleteRecord}
              size="sm"
              type="button"
              variant="outline"
            >
              删除
            </Button>
          </>
        ) : (
          <Button
            disabled={working}
            onClick={onRevoke}
            size="sm"
            type="button"
            variant="outline"
          >
            登出
          </Button>
        )}
      </div>
    </div>
  );
}

function getSessionStatus(device: AuthSessionDevice) {
  if (device.revokedAt) {
    return {
      className: "size-2.5 rounded-full bg-rose-500 ring-4 ring-rose-500/15",
      label: "已登出",
    };
  }
  if (device.isExpired || new Date(device.expiresAt).getTime() <= Date.now()) {
    return {
      className:
        "size-2.5 rounded-full bg-muted-foreground ring-4 ring-muted",
      label: "已过期",
    };
  }
  return {
    className:
      "size-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15",
    label: device.isCurrent ? "当前设备" : "已登录",
  };
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-Hans", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
