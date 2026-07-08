"use client";

import { useCallback, useEffect, useState } from "react";
import { createRealtimeTicket, getRealtimeUrl } from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  type AuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";

type SourceConversationMessage = {
  id: string;
  sourceId?: string;
  sourceType?: string;
};

type ConversationRealtimeMessage<TMessage> = {
  payload?: {
    message?: TMessage;
  };
  type?: string;
};

type ConversationRealtimeSource<TSourcePayload> = {
  payload?: {
    source?: {
      sourceId?: string;
      sourceType?: string;
    };
    sourcePayload?: TSourcePayload;
  };
  type?: string;
};

export function useSourceConversation<
  TMessage extends SourceConversationMessage,
  TSourcePayload = unknown,
>(input: {
  enabled: boolean;
  loadMessages: (
    session: AuthenticatedAdminSessionMarker,
    sourceId: string,
  ) => Promise<TMessage[]>;
  markRead?: (
    session: AuthenticatedAdminSessionMarker,
    sourceId: string,
  ) => Promise<unknown>;
  onError?: (message: string) => void;
  onSourceUpdated?: (payload: TSourcePayload) => void;
  sourceId: string | null;
  sourceType: string;
}) {
  const [messages, setMessages] = useState<TMessage[]>([]);

  const appendMessage = useCallback((message: TMessage) => {
    setMessages((current) =>
      current.some((item) => item.id === message.id)
        ? current
        : [...current, message],
    );
  }, []);

  useEffect(() => {
    if (!input.enabled || !input.sourceId) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    async function loadMessages() {
      const token = await getAuthenticatedAdminSessionMarker();
      if (!token || cancelled || !input.sourceId) {
        if (!cancelled) setMessages([]);
        return;
      }

      input
        .loadMessages(token, input.sourceId)
        .then((items) => {
          if (!cancelled) setMessages(items);
        })
        .catch((error) => {
          if (!cancelled) {
            input.onError?.(
              error instanceof Error ? error.message : "消息加载失败",
            );
          }
        });
      void input.markRead?.(token, input.sourceId);
    }

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [
    input.enabled,
    input.loadMessages,
    input.markRead,
    input.onError,
    input.sourceId,
  ]);

  useEffect(() => {
    if (!input.enabled) return;

    let cancelled = false;
    let socket: WebSocket | null = null;

    async function connectRealtime() {
      const sessionMarker = await getAuthenticatedAdminSessionMarker();
      if (!sessionMarker || cancelled) return;
      const ticket = await createRealtimeTicket()
        .then((response) => response.ticket)
        .catch(() => null);
      if (!ticket || cancelled) return;

      socket = new WebSocket(getRealtimeUrl(ticket));
      socket.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data as string) as
            | ConversationRealtimeMessage<TMessage>
            | ConversationRealtimeSource<TSourcePayload>;

          if (data.type === "conversation.source.updated") {
            const sourceEvent =
              data as ConversationRealtimeSource<TSourcePayload>;
            if (sourceEvent.payload?.source?.sourceType !== input.sourceType) {
              return;
            }
            if (sourceEvent.payload.sourcePayload !== undefined) {
              input.onSourceUpdated?.(sourceEvent.payload.sourcePayload);
            }
            return;
          }

          if (data.type !== "conversation.message.created") return;
          const message = (data as ConversationRealtimeMessage<TMessage>)
            .payload?.message;
          if (!message || message.sourceType !== input.sourceType) return;
          if (message.sourceId !== input.sourceId) return;

          appendMessage(message);
          if (input.sourceId) {
            void input.markRead?.(sessionMarker, input.sourceId);
          }
        } catch {
          // Regular HTTP refresh remains authoritative.
        }
      });
    }

    void connectRealtime();

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [
    appendMessage,
    input.enabled,
    input.markRead,
    input.onSourceUpdated,
    input.sourceId,
    input.sourceType,
  ]);

  return {
    appendMessage,
    messages,
    setMessages,
  };
}
