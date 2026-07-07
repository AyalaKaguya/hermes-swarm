"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { cn } from "@/lib/utils";

export function ConversationPanel<TMessage>({
  autoScrollToLatest = true,
  className,
  emptyLabel = "暂无消息",
  messages,
  renderMessage,
}: {
  autoScrollToLatest?: boolean;
  className?: string;
  emptyLabel?: string;
  messages: TMessage[];
  renderMessage: (message: TMessage) => ReactNode;
}) {
  const tr = useTextTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!autoScrollToLatest) return;
    scrollToLatest(scrollRef.current);
  }, [autoScrollToLatest, messages]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!autoScrollToLatest || !element) return;

    const observer = new ResizeObserver(() => {
      scrollToLatest(element);
    });
    observer.observe(element);
    if (element.firstElementChild) {
      observer.observe(element.firstElementChild);
    }
    return () => observer.disconnect();
  }, [autoScrollToLatest, messages]);

  return (
    <div
      className={cn("min-h-0 overflow-auto bg-muted/20 p-4", className)}
      ref={scrollRef}
    >
      {messages.length === 0 ? (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">
          {tr(emptyLabel)}
        </div>
      ) : (
        <div className="grid gap-3">{messages.map(renderMessage)}</div>
      )}
    </div>
  );
}

function scrollToLatest(element: HTMLDivElement | null) {
  if (!element) return;
  requestAnimationFrame(() => {
    element.scrollTop = element.scrollHeight;
  });
}
