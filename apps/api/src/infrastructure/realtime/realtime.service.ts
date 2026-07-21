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
import { PublicRealtimeEnvelopeSchema } from "@hermes-swarm/api-contracts/realtime";
import { AuthSessionService } from "../auth/auth-session.service.js";

type RealtimeClient = {
  buffer: Buffer;
  id: string;
  sessionId?: string;
  socket: Socket;
  workspaceId: string;
  userId: string;
};

export type RealtimeEvent = {
  id?: string;
  payload?: unknown;
  type: string;
};

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_CLIENT_FRAME_BUFFER_BYTES = 1024 * 1024;

@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly clients = new Map<string, RealtimeClient>();
  private readonly clientsByWorkspaceUser = new Map<string, Set<string>>();
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
    this.clientsByWorkspaceUser.clear();
  }

  publishToUser(workspaceId: string, userId: string, event: RealtimeEvent) {
    const clientIds = this.clientsByWorkspaceUser.get(
      recipientKey(workspaceId, userId),
    );
    if (!clientIds?.size) return;
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId);
      if (client) this.send(client, event);
    }
  }

  publishToUsers(workspaceId: string, userIds: string[], event: RealtimeEvent) {
    for (const userId of new Set(userIds)) {
      this.publishToUser(workspaceId, userId, event);
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
      const ticket = url.searchParams.get("ticket");
      const token =
        url.searchParams.get("access_token") ??
        extractBearerToken(request.headers.authorization);
      const session = ticket
        ? await this.authSessionService.consumeRealtimeTicket(ticket)
        : await this.authSessionService.validateAccessToken(token ?? undefined);
      const workspaceId = session.workspaceId?.trim();
      if (!workspaceId) throw new Error("Workspace session required");
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
        id: `${workspaceId}:${randomUUID()}`,
        sessionId: session.sessionId,
        socket,
        workspaceId,
        userId: session.userId,
      };
      this.register(client);
      this.send(client, {
        type: "realtime.connected",
        payload: {
          clientId: client.id,
          sessionId: client.sessionId,
          workspaceId: client.workspaceId,
        },
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  }

  private register(client: RealtimeClient) {
    this.clients.set(client.id, client);
    const key = recipientKey(client.workspaceId, client.userId);
    const userClients = this.clientsByWorkspaceUser.get(key) ?? new Set<string>();
    userClients.add(client.id);
    this.clientsByWorkspaceUser.set(key, userClients);

    client.socket.on("data", (chunk) => this.handleData(client, chunk));
    client.socket.on("close", () => this.unregister(client));
    client.socket.on("error", () => this.unregister(client));
  }

  private unregister(client: RealtimeClient) {
    this.clients.delete(client.id);
    const key = recipientKey(client.workspaceId, client.userId);
    const userClients = this.clientsByWorkspaceUser.get(key);
    userClients?.delete(client.id);
    if (userClients && userClients.size === 0) {
      this.clientsByWorkspaceUser.delete(key);
    }
  }

  private handleData(client: RealtimeClient, chunk: Buffer) {
    const nextBuffer = Buffer.concat([client.buffer, chunk]);
    if (nextBuffer.length > MAX_CLIENT_FRAME_BUFFER_BYTES) {
      this.closeClient(client);
      return;
    }

    const result = decodeFrames(nextBuffer);
    client.buffer = result.remaining;
    for (const frame of result.frames) {
      if (frame.opcode === 0x8) {
        this.closeClient(client);
        return;
      }
      if (frame.opcode === 0x9) {
        if (!this.writeFrame(client, encodeFrame(frame.payload, 0xA))) return;
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
    const wireEvent = toWireValue({
      id: event.id ?? randomUUID(),
      payload: event.payload ?? null,
      sentAt: new Date().toISOString(),
      workspaceId: client.workspaceId,
      type: event.type,
    });
    const parsed = PublicRealtimeEnvelopeSchema.safeParse(wireEvent);
    if (!parsed.success) {
      this.logger.warn(JSON.stringify({
        code: "REALTIME_CONTRACT_MISMATCH",
        issues: parsed.error.issues.map((issue) => issue.path.join(".") || "event"),
        type: event.type,
      }));
      return;
    }
    const payload = JSON.stringify(parsed.data);
    try {
      this.writeFrame(client, encodeFrame(Buffer.from(payload, "utf8"), 0x1));
    } catch (error) {
      this.dropClientAfterWriteFailure(client, error);
    }
  }

  private writeFrame(client: RealtimeClient, frame: Buffer) {
    if (client.socket.destroyed) return false;
    try {
      client.socket.write(frame);
      return true;
    } catch (error) {
      this.dropClientAfterWriteFailure(client, error);
      return false;
    }
  }

  private dropClientAfterWriteFailure(client: RealtimeClient, error: unknown) {
    this.logger.warn(
      `realtime send failed for client ${client.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    this.unregister(client);
    client.socket.destroy();
  }

  private closeClient(client: RealtimeClient) {
    this.unregister(client);
    if (client.socket.destroyed) return;
    try {
      client.socket.end();
    } catch (error) {
      this.logger.warn(
        `realtime close failed for client ${client.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      client.socket.destroy();
    }
  }
}

function toWireValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toWireValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toWireValue(item)]));
}

function recipientKey(workspaceId: string, userId: string) {
  return `${workspaceId}:${userId}`;
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
