"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import {
  dismissNotification,
  dismissReadNotifications,
  getRealtimeUrl,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type UserNotification,
} from "@/lib/admin-api";
import { getAuthenticatedAdminToken } from "@/lib/authenticated-admin";

type NotificationItem = {
  body?: string | null;
  createdAt: string;
  id: string;
  kind?: string;
  message: string;
  status?: "read" | "unread";
};

export function NotificationCenter() {
  const t = useTranslations();
  const format = useFormatter();
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;

    function push(message: string) {
      setItems((current) => [
        {
          createdAt: new Date().toISOString(),
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          message,
        },
        ...current.slice(0, 99),
      ]);
    }

    function pushNotification(notification: UserNotification) {
      setItems((current) => {
        const next = [
          {
            body: notification.body,
            createdAt: notification.createdAt,
            id: notification.id,
            kind: notification.kind,
            message: notification.title,
            status: notification.status,
          },
          ...current.filter((item) => item.id !== notification.id),
        ];
        return next.slice(0, 100);
      });
    }

    async function connectNotifications() {
      const token = await getAuthenticatedAdminToken();
      if (!token || closed) return;

      listUserNotifications(token, { take: 50 })
        .then((notifications) => {
          if (!closed) setItems(notifications.map(toNotificationItem));
        })
        .catch(() => undefined);

      if (closed) return;
      socket = new WebSocket(getRealtimeUrl(token));
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data as string) as {
            payload?: unknown;
            type?: string;
          };
          if (
            message.type === "notification.created" &&
            isUserNotification(message.payload)
          ) {
            pushNotification(message.payload);
          }
        } catch {
          // Ignore malformed realtime messages; the HTTP notification list is authoritative.
        }
      });
    }

    void connectNotifications();

    function onError(event: ErrorEvent) {
      push(event.message || t("notifications.runtimeError"));
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      push(
        reason instanceof Error
          ? reason.message
          : String(reason || t("notifications.unhandledRejection")),
      );
    }

    function onCustom(event: Event) {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) push(detail.message);
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("hermes:notification", onCustom);
    return () => {
      closed = true;
      socket?.close();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("hermes:notification", onCustom);
    };
  }, [t]);

  const countLabel = useMemo(
    () => {
      const unread = items.filter((item) => item.status !== "read").length;
      return unread > 99 ? "99+" : String(unread);
    },
    [items],
  );
  const unreadCount = items.filter((item) => item.status !== "read").length;

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            isActive={false}
            tooltip={t("notifications.title")}
            type="button"
          >
            <span className="relative">
              <AppIcon className="size-4 shrink-0" name="bell" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 size-2 rounded-full bg-destructive" />
              )}
            </span>
            <span>{t("notifications.title")}</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <div className="flex items-center justify-between gap-3 px-1.5 py-1">
            <DropdownMenuLabel className="p-0">
              {items.length > 0
                ? t("notifications.titleWithCount", { count: countLabel })
                : t("notifications.title")}
            </DropdownMenuLabel>
            <div className="flex items-center gap-1">
              <Button
                aria-label={t("notifications.allRead")}
                disabled={items.length === 0}
                onClick={(event) => {
                  event.stopPropagation();
                  void getAuthenticatedAdminToken().then((token) => {
                    if (token) void markAllNotificationsRead(token);
                  });
                  setItems((current) =>
                    current.map((item) => ({ ...item, status: "read" })),
                  );
                }}
                size="icon-xs"
                title={t("notifications.allRead")}
                type="button"
                variant="ghost"
              >
                <AppIcon className="size-3.5" name="check" />
              </Button>
              <Button
                aria-label={t("notifications.clearRead")}
                disabled={!items.some((item) => item.status === "read")}
                onClick={(event) => {
                  event.stopPropagation();
                  void getAuthenticatedAdminToken().then((token) => {
                    if (token) void dismissReadNotifications(token);
                  });
                  setItems((current) =>
                    current.filter((item) => item.status !== "read"),
                  );
                }}
                size="icon-xs"
                title={t("notifications.clearRead")}
                type="button"
                variant="ghost"
              >
                <AppIcon className="size-3.5" name="list-x" />
              </Button>
            </div>
          </div>
          <DropdownMenuSeparator />
          {items.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm">
              {t("notifications.empty")}
            </div>
          ) : (
            <div className="max-h-80 overflow-auto">
              {items.map((item, index) => (
                <DropdownMenuItem
                  className="items-start gap-2 py-2"
                  key={item.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    if (item.status === "unread") {
                      void getAuthenticatedAdminToken().then((token) => {
                        if (token) void markNotificationRead(token, item.id);
                      });
                    }
                    setItems((current) =>
                      current.map((currentItem) =>
                        currentItem.id === item.id
                          ? { ...currentItem, status: "read" }
                          : currentItem,
                      ),
                    );
                  }}
                >
                  <span
                    className={
                      item.status === "read"
                        ? "mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                        : "mt-1 size-1.5 shrink-0 rounded-full bg-destructive"
                    }
                  />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="break-words text-sm leading-snug">
                      {item.message}
                    </span>
                    {item.body && (
                      <span className="line-clamp-2 break-words text-xs">
                        {item.body}
                      </span>
                    )}
                    <span className="text-xs">
                      {formatNotificationTime(item.createdAt, format)}
                    </span>
                  </span>
                  <Button
                    aria-label={t("notifications.dismiss")}
                    onClick={(event) => {
                      event.stopPropagation();
                      void getAuthenticatedAdminToken().then((token) => {
                        if (token) void dismissNotification(token, item.id);
                      });
                      setItems((current) =>
                        current.filter((_, i) => i !== index),
                      );
                    }}
                    size="icon-xs"
                    title={t("notifications.dismiss")}
                    type="button"
                    variant="ghost"
                  >
                    <AppIcon className="size-3" name="x" />
                  </Button>
                </DropdownMenuItem>
              ))}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function toNotificationItem(notification: UserNotification): NotificationItem {
  return {
    body: notification.body,
    createdAt: notification.createdAt,
    id: notification.id,
    kind: notification.kind,
    message: notification.title,
    status: notification.status,
  };
}

function formatNotificationTime(
  value: string,
  format: ReturnType<typeof useFormatter>,
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return format.dateTime(date, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function isUserNotification(value: unknown): value is UserNotification {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as UserNotification).id === "string" &&
      typeof (value as UserNotification).title === "string",
  );
}
