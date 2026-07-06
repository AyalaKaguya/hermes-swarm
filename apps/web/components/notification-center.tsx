"use client";

import { useEffect, useMemo, useState } from "react";
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
import { getStoredSession } from "@/lib/session";

type NotificationItem = {
  body?: string | null;
  id: string;
  kind?: string;
  message: string;
  status?: "read" | "unread";
  time: string;
};

export function NotificationCenter() {
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    const session = getStoredSession();
    let socket: WebSocket | null = null;
    let closed = false;

    function push(message: string) {
      setItems((current) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          message,
          time: new Date().toLocaleTimeString(),
        },
        ...current.slice(0, 99),
      ]);
    }

    function pushNotification(notification: UserNotification) {
      setItems((current) => {
        const next = [
          {
            body: notification.body,
            id: notification.id,
            kind: notification.kind,
            message: notification.title,
            status: notification.status,
            time: formatNotificationTime(notification.createdAt),
          },
          ...current.filter((item) => item.id !== notification.id),
        ];
        return next.slice(0, 100);
      });
    }

    if (session?.accessToken) {
      listUserNotifications(session.accessToken, { take: 50 })
        .then((notifications) => {
          if (!closed) setItems(notifications.map(toNotificationItem));
        })
        .catch(() => undefined);

      socket = new WebSocket(getRealtimeUrl(session.accessToken));
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

    function onError(event: ErrorEvent) {
      push(event.message || "应用运行时错误");
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      push(
        reason instanceof Error
          ? reason.message
          : String(reason || "异步任务失败"),
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
  }, []);

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
          <SidebarMenuButton isActive={false} tooltip="通知" type="button">
            <span className="relative">
              <AppIcon className="size-4 shrink-0" name="bell" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 size-2 rounded-full bg-destructive" />
              )}
            </span>
            <span>通知</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <div className="flex items-center justify-between gap-3 px-1.5 py-1">
            <DropdownMenuLabel className="p-0">
              通知{items.length > 0 ? ` (${countLabel})` : ""}
            </DropdownMenuLabel>
            <div className="flex items-center gap-1">
              <Button
                aria-label="全部已读"
                disabled={items.length === 0}
                onClick={(event) => {
                  event.stopPropagation();
                  const token = getStoredSession()?.accessToken;
                  if (token) void markAllNotificationsRead(token);
                  setItems((current) =>
                    current.map((item) => ({ ...item, status: "read" })),
                  );
                }}
                size="icon-xs"
                title="全部已读"
                type="button"
                variant="ghost"
              >
                <AppIcon className="size-3.5" name="check" />
              </Button>
              <Button
                aria-label="清理已读"
                disabled={!items.some((item) => item.status === "read")}
                onClick={(event) => {
                  event.stopPropagation();
                  const token = getStoredSession()?.accessToken;
                  if (token) void dismissReadNotifications(token);
                  setItems((current) =>
                    current.filter((item) => item.status !== "read"),
                  );
                }}
                size="icon-xs"
                title="清理已读"
                type="button"
                variant="ghost"
              >
                <AppIcon className="size-3.5" name="list-x" />
              </Button>
            </div>
          </div>
          <DropdownMenuSeparator />
          {items.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm">暂无通知</div>
          ) : (
            <div className="max-h-80 overflow-auto">
              {items.map((item, index) => (
                <DropdownMenuItem
                  className="items-start gap-2 py-2"
                  key={item.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    const token = getStoredSession()?.accessToken;
                    if (token && item.status === "unread") {
                      void markNotificationRead(token, item.id);
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
                    <span className="text-xs">{item.time}</span>
                  </span>
                  <Button
                    aria-label="移除通知"
                    onClick={(event) => {
                      event.stopPropagation();
                      const token = getStoredSession()?.accessToken;
                      if (token) void dismissNotification(token, item.id);
                      setItems((current) =>
                        current.filter((_, i) => i !== index),
                      );
                    }}
                    size="icon-xs"
                    title="移除通知"
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
    id: notification.id,
    kind: notification.kind,
    message: notification.title,
    status: notification.status,
    time: formatNotificationTime(notification.createdAt),
  };
}

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function isUserNotification(value: unknown): value is UserNotification {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as UserNotification).id === "string" &&
      typeof (value as UserNotification).title === "string",
  );
}
