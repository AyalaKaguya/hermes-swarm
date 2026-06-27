"use client";

import { useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type NotificationItem = {
  id: string;
  message: string;
  time: string;
};

export function NotificationCenter() {
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
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

    function onError(event: ErrorEvent) {
      push(event.message || "应用运行时错误");
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      push(reason instanceof Error ? reason.message : String(reason || "异步任务失败"));
    }

    function onCustom(event: Event) {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) push(detail.message);
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("hermes:notification", onCustom);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("hermes:notification", onCustom);
    };
  }, []);

  const countLabel = useMemo(() => (items.length > 99 ? "99+" : String(items.length)), [items.length]);

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton isActive={false} tooltip="通知" type="button">
            <span className="relative">
              <AppIcon className="size-4 shrink-0" name="bell" />
              {items.length > 0 && (
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
            <button
              className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              disabled={items.length === 0}
              onClick={() => setItems([])}
              type="button"
            >
              清空
            </button>
          </div>
          <DropdownMenuSeparator />
          {items.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              暂无通知
            </div>
          ) : (
            <div className="max-h-80 overflow-auto">
              {items.map((item, index) => (
                <DropdownMenuItem
                  className="items-start gap-2 py-2"
                  key={item.id}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-destructive" />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="break-words text-sm leading-snug">
                      {item.message}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.time}
                    </span>
                  </span>
                  <button
                    className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      setItems((current) => current.filter((_, i) => i !== index));
                    }}
                    type="button"
                  >
                    移除
                  </button>
                </DropdownMenuItem>
              ))}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
