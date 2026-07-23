import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import type {
  UserNotification,
  UserNotificationKind,
  UserNotificationStatus,
} from "@hermes-swarm/api-contracts";
import { fetchAdmin } from "./client";

export function listUserNotifications(
  session: AuthenticatedAdminSessionMarker,
  options: { status?: UserNotificationStatus; take?: number } = {},
) {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.take) params.set("take", String(options.take));
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return fetchAdmin<UserNotification[]>(`/notifications${suffix}`, {});
}

export function getUnreadNotificationCount(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<{ count: number }>("/notifications/unread-count", {});
}

export function markNotificationRead(session: AuthenticatedAdminSessionMarker, notificationId: string) {
  return fetchAdmin<UserNotification>(`/notifications/${notificationId}/read`, {
    method: "PATCH",
  });
}

export function markAllNotificationsRead(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<{ ok: boolean }>("/notifications/read", {
    method: "PATCH",
  });
}

export function dismissReadNotifications(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<{ ok: boolean }>("/notifications/read", {
    method: "DELETE",
  });
}

export function dismissNotification(session: AuthenticatedAdminSessionMarker, notificationId: string) {
  return fetchAdmin<void>(`/notifications/${notificationId}`, {
    method: "DELETE",
  });
}

export function sendUserNotification(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    body?: string | null;
    kind?: UserNotificationKind;
    payload?: Record<string, unknown> | null;
    recipientUserIds: string[];
    title: string;
  },
) {
  return fetchAdmin<UserNotification[]>("/notifications", {
    body: payload,
    method: "POST",
  });
}
