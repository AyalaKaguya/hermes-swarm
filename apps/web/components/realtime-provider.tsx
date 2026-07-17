"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRealtimeTicket, getRealtimeUrl } from "@/lib/admin-api";
import {
  parseRealtimeEnvelope,
  type RealtimeEnvelope,
} from "@/lib/realtime-events";

type RealtimeListener = (event: RealtimeEnvelope) => void;

type RealtimeContextValue = {
  connectionEpoch: number;
  status: "connected" | "connecting" | "disconnected";
  subscribe: (type: string, listener: RealtimeListener) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);
const MAX_RECONNECT_DELAY_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

export function RealtimeProvider({
  children,
  connectionKey,
  enabled,
}: {
  children: ReactNode;
  connectionKey: string;
  enabled: boolean;
}) {
  const listenersRef = useRef(new Map<string, Set<RealtimeListener>>());
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [status, setStatus] = useState<RealtimeContextValue["status"]>(
    enabled ? "connecting" : "disconnected",
  );

  const subscribe = useCallback((type: string, listener: RealtimeListener) => {
    const listeners = listenersRef.current.get(type) ?? new Set<RealtimeListener>();
    listeners.add(listener);
    listenersRef.current.set(type, listeners);
    return () => {
      const current = listenersRef.current.get(type);
      current?.delete(listener);
      if (current?.size === 0) listenersRef.current.delete(type);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !connectionKey) {
      setStatus("disconnected");
      return;
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let connecting = false;

    function clearHeartbeat() {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    function scheduleReconnect() {
      if (closed || reconnectTimer !== null) return;
      clearHeartbeat();
      setStatus("disconnected");
      const delay = Math.min(
        1_000 * 2 ** Math.min(reconnectAttempts, 4),
        MAX_RECONNECT_DELAY_MS,
      );
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    }

    function dispatch(event: RealtimeEnvelope) {
      for (const listener of listenersRef.current.get(event.type) ?? []) {
        try {
          listener(event);
        } catch {
          // A single consumer must not interrupt delivery to the other subscribers.
        }
      }
    }

    async function connect() {
      if (closed || connecting) return;
      if (
        socket?.readyState === WebSocket.CONNECTING ||
        socket?.readyState === WebSocket.OPEN
      ) {
        return;
      }
      connecting = true;
      setStatus("connecting");
      try {
        const { ticket } = await createRealtimeTicket();
        if (closed) return;
        socket = new WebSocket(getRealtimeUrl(ticket));
        socket.addEventListener("open", () => {
          if (closed) return;
          reconnectAttempts = 0;
          setStatus("connected");
          setConnectionEpoch((current) => current + 1);
          clearHeartbeat();
          heartbeatTimer = window.setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "ping" }));
            }
          }, HEARTBEAT_INTERVAL_MS);
        });
        socket.addEventListener("message", (message) => {
          const event = parseRealtimeEnvelope(message.data);
          if (event) dispatch(event);
        });
        socket.addEventListener("close", scheduleReconnect);
        socket.addEventListener("error", () => socket?.close());
      } catch {
        scheduleReconnect();
      } finally {
        connecting = false;
      }
    }

    function reconnectNow() {
      if (
        closed ||
        connecting ||
        socket?.readyState === WebSocket.CONNECTING ||
        socket?.readyState === WebSocket.OPEN
      ) {
        return;
      }
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      void connect();
    }

    window.addEventListener("online", reconnectNow);
    void connect();
    return () => {
      closed = true;
      window.removeEventListener("online", reconnectNow);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      clearHeartbeat();
      socket?.close();
    };
  }, [connectionKey, enabled]);

  const value = useMemo<RealtimeContextValue>(
    () => ({ connectionEpoch, status, subscribe }),
    [connectionEpoch, status, subscribe],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used within RealtimeProvider");
  }
  return context;
}
