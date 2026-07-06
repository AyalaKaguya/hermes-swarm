"use client";

import type { ReactNode } from "react";

export function ConversationPanel<TMessage>({
  emptyLabel = "暂无消息",
  messages,
  renderMessage,
}: {
  emptyLabel?: string;
  messages: TMessage[];
  renderMessage: (message: TMessage) => ReactNode;
}) {
  return (
    <div className="max-h-[56svh] min-h-[24rem] overflow-auto bg-muted/20 p-4">
      {messages.length === 0 ? (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="grid gap-3">{messages.map(renderMessage)}</div>
      )}
    </div>
  );
}
