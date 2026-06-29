"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NotificationVariant = "error" | "info" | "success";

type NotificationInput = {
  description?: string;
  title: string;
  variant?: NotificationVariant;
};

type NotificationItem = Required<NotificationInput> & {
  id: number;
};

type NotificationsContextValue = {
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  notify: (notification: NotificationInput) => void;
  success: (title: string, description?: string) => void;
};

const NotificationsContext =
  createContext<NotificationsContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    ({ description = "", title, variant = "info" }: NotificationInput) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setItems((current) => [
        ...current.slice(-3),
        { description, id, title, variant },
      ]);
      window.setTimeout(() => remove(id), 3200);
    },
    [remove],
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({
      error: (title, description) =>
        notify({ description, title, variant: "error" }),
      info: (title, description) =>
        notify({ description, title, variant: "info" }),
      notify,
      success: (title, description) =>
        notify({ description, title, variant: "success" }),
    }),
    [notify],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 top-4 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2"
      >
        {items.map((item) => (
          <div
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-md border bg-popover px-3 py-2 text-sm shadow-lg",
              item.variant === "success" && "border-l-4 border-l-emerald-500",
              item.variant === "error" && "border-l-4 border-l-destructive",
              item.variant === "info" && "border-l-4 border-l-ring",
            )}
            key={item.id}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{item.title}</div>
              {item.description && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {item.description}
                </div>
              )}
            </div>
            <Button
              aria-label="关闭通知"
              className="-mr-1 -mt-1 size-7"
              onClick={() => remove(item.id)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <AppIcon className="size-3.5" name="x" />
            </Button>
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
}
