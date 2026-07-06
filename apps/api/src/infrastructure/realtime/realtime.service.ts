import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { AuthSessionService } from "../auth/auth-session.service.js";

type RealtimeClient = {
  buffer: Buffer;
  id: string;
  sessionId?: string;
  socket: Socket;
  userId: string;
};

export type RealtimeEvent = {
  id?: string;
  payload?: unknown;
  type: string;
};

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly clients = new Map<string, RealtimeClient>();
  private readonly clientsByUserId = new Map<string, Set<string>>();
  private server: { on: (event: string, listener: (...args: any[]) => void) => void } | null =
    null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly authSessionService: AuthSessionService,
  ) {}

  onApplicationBootstrap() {
    this.server = this.adapterHost.httpAdapter.getHttpServer();
    this.server?.on("upgrade", (request: IncomingMessage, socket: Socket) => {
      void this.handleUpgrade(request, socket);
    });
  }

  onModuleDestroy() {
    for (const client of this.clients.values()) {
      client.socket.destroy();
    }
    this.clients.clear();
    this.clientsByUserId.clear();
  }

  publishToUser(userId: string, event: RealtimeEvent) {
    const clientIds = this.clientsByUserId.get(userId);
    if (!clientIds?.size) return;
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId);
      if (client) this.send(client, event);
    }
  }

  publishToUsers(userIds: string[], event: RealtimeEvent) {
    for (const userId of new Set(userIds)) {
      this.publishToUser(userId, event);
    }
  }

  private async handleUpgrade(request: IncomingMessage, socket: Socket) {
    const url = new URL(request.url ?? "", "http://localhost");
    if (url.pathname !== "/api/realtime") {
      socket.destroy();
      return;
    }

    try {
      const websocketKey = request.headers["sec-websocket-key"];
      if (typeof websocketKey !== "string" || !websocketKey.trim()) {
        throw new Error("Missing websocket key");
      }
      const token =
        url.searchParams.get("access_token") ??
        extractBearerToken(request.headers.authorization);
      const session = await this.authSessionService.validateAccessToken(token ?? undefined);
      const accept = createHash("sha1")
        .update(`${websocketKey}${WEBSOCKET_GUID}`)
        .digest("base64");

      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "\r\n",
        ].join("\r\n"),
      );

      const client: RealtimeClient = {
        buffer: Buffer.alloc(0),
        id: randomUUID(),
        sessionId: session.sessionId,
        socket,
        userId: session.userId,
      };
      this.register(client);
      this.send(client, {
        type: "realtime.connected",
        payload: { clientId: client.id, sessionId: client.sessionId },
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  }

  private register(client: RealtimeClient) {
    this.clients.set(client.id, client);
    const userClients = this.clientsByUserId.get(client.userId) ?? new Set<string>();
    userClients.add(client.id);
    this.clientsByUserId.set(client.userId, userClients);

    client.socket.on("data", (chunk) => this.handleData(client, chunk));
    client.socket.on("close", () => this.unregister(client));
    client.socket.on("error", () => this.unregister(client));
  }

  private unregister(client: RealtimeClient) {
    this.clients.delete(client.id);
    const userClients = this.clientsByUserId.get(client.userId);
    userClients?.delete(client.id);
    if (userClients && userClients.size === 0) {
      this.clientsByUserId.delete(client.userId);
    }
  }

  private handleData(client: RealtimeClient, chunk: Buffer) {
    const result = decodeFrames(Buffer.concat([client.buffer, chunk]));
    client.buffer = result.remaining;
    for (const frame of result.frames) {
      if (frame.opcode === 0x8) {
        client.socket.end();
        this.unregister(client);
        return;
      }
      if (frame.opcode === 0x9) {
        client.socket.write(encodeFrame(frame.payload, 0xA));
        continue;
      }
      if (frame.opcode !== 0x1) continue;
      const message = frame.payload.toString("utf8");
      if (message === "ping") {
        this.send(client, { type: "pong" });
        continue;
      }
      try {
        const parsed = JSON.parse(message) as { type?: string };
        if (parsed.type === "ping") {
          this.send(client, { type: "pong" });
        }
      } catch {
        this.send(client, { type: "realtime.error", payload: { message: "Invalid JSON" } });
      }
    }
  }

  private send(client: RealtimeClient, event: RealtimeEvent) {
    if (client.socket.destroyed) return;
    const payload = JSON.stringify({
      id: event.id ?? randomUUID(),
      payload: event.payload ?? null,
      sentAt: new Date().toISOString(),
      type: event.type,
    });
    client.socket.write(encodeFrame(Buffer.from(payload, "utf8"), 0x1));
  }
}

function extractBearerToken(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  return header?.replace(/^Bearer\s+/i, "").trim() || null;
}

function decodeFrames(chunk: Buffer) {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let offset = 0;
  while (offset + 2 <= chunk.length) {
    const frameStart = offset;
    const first = chunk[offset]!;
    const second = chunk[offset + 1]!;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let length = second & 0x7f;
    offset += 2;

    if (length === 126) {
      if (offset + 2 > chunk.length) {
        offset = frameStart;
        break;
      }
      length = chunk.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (offset + 8 > chunk.length) {
        offset = frameStart;
        break;
      }
      const bigLength = chunk.readBigUInt64BE(offset);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        offset = chunk.length;
        break;
      }
      length = Number(bigLength);
      offset += 8;
    }

    if (masked && offset + 4 > chunk.length) {
      offset = frameStart;
      break;
    }
    const mask = masked ? chunk.subarray(offset, offset + 4) : null;
    if (masked) offset += 4;
    if (offset + length > chunk.length) {
      offset = frameStart;
      break;
    }
    const payload = Buffer.from(chunk.subarray(offset, offset + length));
    offset += length;

    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = payload[index]! ^ mask[index % 4]!;
      }
    }
    frames.push({ opcode, payload });
  }
  return {
    frames,
    remaining: offset < chunk.length ? chunk.subarray(offset) : Buffer.alloc(0),
  };
}

function encodeFrame(payload: Buffer, opcode: number) {
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
  }
  if (length < 65536) {
    const header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.allocUnsafe(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}
