"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useLocale } from "next-intl";
import { useNotifications } from "@/components/app-notifications";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { useTextTranslation } from "@/hooks/use-text-translation";
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
import {
  getAuthenticatedAdminSessionMarker,
  withAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";

type PendingSessionAction =
  | {
      device: AuthSessionDevice;
      type: "delete" | "revoke";
    }
  | {
      type: "revoke-others";
    };

export default function SessionsPage() {
  const notifications = useNotifications();
  const tr = useTextTranslation();
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] =
    useState<PendingSessionAction | null>(null);
  const [sessions, setSessions] = useState<AuthSessionDevice[]>([]);

  const loadSessions = useCallback(async () => {
    const token = await getAuthenticatedAdminSessionMarker();
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setSessions(await listAuthSessions(token));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("登录设备加载失败"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function revokeSession(sessionId: string) {
    setBusySessionId(sessionId);
    setError(null);
    try {
      await withAuthenticatedAdminSessionMarker((token) =>
        revokeAuthSession(token, sessionId),
      );
      notifications.success(tr("设备已登出"));
      setPendingAction(null);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("登出失败"));
    } finally {
      setBusySessionId(null);
    }
  }

  async function revokeOtherSessions() {
    setBusySessionId("others");
    setError(null);
    try {
      await withAuthenticatedAdminSessionMarker((token) =>
        revokeOtherAuthSessions(token),
      );
      notifications.success(tr("其他设备已登出"));
      setPendingAction(null);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("登出失败"));
    } finally {
      setBusySessionId(null);
    }
  }

  async function deleteSessionRecord(sessionId: string) {
    setBusySessionId(sessionId);
    setError(null);
    try {
      await withAuthenticatedAdminSessionMarker((token) =>
        deleteAuthSessionRecord(token, sessionId),
      );
      notifications.success(tr("设备记录已删除"));
      setPendingAction(null);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("删除失败"));
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
  const canRevokeOtherSessions = sessions.some(
    (item) => !item.isCurrent && !item.revokedAt && !item.isExpired,
  );
  const revokeOtherDisabledReason =
    loading || busySessionId === "others"
      ? tr("正在处理")
      : canRevokeOtherSessions
        ? undefined
        : tr("没有其他可登出的设备");
  const dialogContent = getPendingActionDialogContent(
    pendingAction,
    locale,
    tr,
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
            <CardTitle>{tr("登录设备")}</CardTitle>
            <CardDescription>
              {tr("查看当前账号已经登录的浏览器终端")}
            </CardDescription>
          </div>
          <Button
            aria-label={tr("登出其他设备")}
            disabled={Boolean(revokeOtherDisabledReason)}
            onClick={() => setPendingAction({ type: "revoke-others" })}
            title={revokeOtherDisabledReason}
            type="button"
            variant="outline"
          >
            {tr("登出其他设备")}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {tr("加载中...")}
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {tr("暂无登录设备")}
            </div>
          ) : (
            <>
              <SessionSection
                emptyText={tr("暂无活跃设备")}
                items={activeSessions}
                title={tr("活跃设备")}
              >
                {(item) => (
                  <SessionDeviceRow
                    device={item}
                    key={item.sessionId}
                    onDeleteRecord={() =>
                      setPendingAction({ device: item, type: "delete" })
                    }
                    onRevoke={() =>
                      setPendingAction({ device: item, type: "revoke" })
                    }
                    working={busySessionId === item.sessionId}
                  />
                )}
              </SessionSection>

              <SessionSection
                description={tr(
                  "这些记录已经不能继续访问账号，查看后可直接删除。",
                )}
                emptyText={tr("暂无过期或已登出的设备")}
                items={inactiveSessions}
                title={tr("过期和已登出设备")}
              >
                {(item) => (
                  <SessionDeviceRow
                    device={item}
                    key={item.sessionId}
                    onDeleteRecord={() =>
                      setPendingAction({ device: item, type: "delete" })
                    }
                    onRevoke={() =>
                      setPendingAction({ device: item, type: "revoke" })
                    }
                    working={busySessionId === item.sessionId}
                  />
                )}
              </SessionSection>
            </>
          )}
        </CardContent>
      </Card>

      {dialogContent && (
        <ConfirmActionDialog
          confirmLabel={dialogContent.confirmLabel}
          description={dialogContent.description}
          onConfirm={() => {
            if (!pendingAction || busySessionId) return;
            if (pendingAction.type === "revoke-others") {
              void revokeOtherSessions();
              return;
            }
            if (pendingAction.type === "delete") {
              void deleteSessionRecord(pendingAction.device.sessionId);
              return;
            }
            void revokeSession(pendingAction.device.sessionId);
          }}
          onOpenChange={(open) => {
            if (!open && !busySessionId) setPendingAction(null);
          }}
          open={Boolean(pendingAction)}
          pending={Boolean(busySessionId)}
          title={dialogContent.title}
        />
      )}
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
  const tr = useTextTranslation();
  const locale = useLocale();
  const status = getSessionStatus(device);
  const statusLabel = tr(status.label);
  const historical = Boolean(device.revokedAt || device.isExpired);
  const deviceName = device.deviceLabel || tr("未知设备");
  const workingLabel = working ? tr("正在处理此设备") : undefined;
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-label={statusLabel}
            className={status.className}
            role="status"
            title={statusLabel}
          />
          <div className="truncate text-sm font-medium">
            {device.deviceLabel}
          </div>
        </div>
        <div className="grid gap-x-10 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[minmax(10rem,auto)_minmax(13rem,auto)] lg:max-w-xl">
          <SessionMeta label={tr("IP")} value={device.ipAddress ?? tr("未知")} />
          <SessionMeta
            label={tr("最近活跃")}
            value={formatDateTime(device.lastSeenAt, locale)}
          />
          <SessionMeta
            label={tr("创建时间")}
            value={formatDateTime(device.createdAt, locale)}
          />
          <SessionMeta
            label={tr("过期时间")}
            value={formatDateTime(device.expiresAt, locale)}
          />
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {device.isCurrent ? (
          <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
            {tr("当前设备")}
          </span>
        ) : historical ? (
          <>
            <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
              {statusLabel}
            </span>
            <Button
              aria-label={`${tr("删除")} ${deviceName}`}
              disabled={working}
              onClick={onDeleteRecord}
              size="sm"
              title={workingLabel ?? `${tr("删除")} ${deviceName}`}
              type="button"
              variant="outline"
            >
              {tr("删除")}
            </Button>
          </>
        ) : (
          <Button
            aria-label={`${tr("登出")} ${deviceName}`}
            disabled={working}
            onClick={onRevoke}
            size="sm"
            title={workingLabel ?? `${tr("登出")} ${deviceName}`}
            type="button"
            variant="outline"
          >
            {tr("登出")}
          </Button>
        )}
      </div>
    </div>
  );
}

function getPendingActionDialogContent(
  action: PendingSessionAction | null,
  locale: string,
  tr: (value: string | null | undefined) => string,
) {
  if (!action) return null;

  if (action.type === "revoke-others") {
    return {
      confirmLabel: tr("登出"),
      description: tr("此操作会使除当前设备以外的所有活跃设备退出当前账号。"),
      title: tr("登出其他设备？"),
    };
  }

  if (action.type === "delete") {
    const device = formatSessionDeviceSummary(action.device, locale, tr);
    return {
      confirmLabel: tr("删除"),
      description: `${tr("设备")}：${device}。${tr(
        "此操作只会删除历史登录记录，不会影响当前账号。",
      )}`,
      title: tr("删除此设备记录？"),
    };
  }

  const device = formatSessionDeviceSummary(action.device, locale, tr);
  return {
    confirmLabel: tr("登出"),
    description: `${tr("设备")}：${device}。${tr(
      "此操作会使该设备立即退出当前账号。",
    )}`,
    title: tr("登出此设备？"),
  };
}

function formatSessionDeviceSummary(
  device: AuthSessionDevice,
  locale: string,
  tr: (value: string | null | undefined) => string,
) {
  return [
    device.deviceLabel || tr("未知设备"),
    device.ipAddress || tr("未知 IP"),
    `${tr("最近活跃")} ${formatDateTime(device.lastSeenAt, locale)}`,
  ].join(" / ");
}

function SessionMeta({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 gap-1 whitespace-nowrap">
      <span className="shrink-0">{label}：</span>
      <span className="min-w-0 truncate">{value}</span>
    </span>
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

function formatDateTime(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
