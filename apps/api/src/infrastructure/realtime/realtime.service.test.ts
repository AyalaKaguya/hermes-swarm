import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { RealtimeService } from "./realtime.service.js";

describe("RealtimeService", () => {
  it("accepts authenticated websocket upgrades and publishes events to a user", async () => {
    let upgradeHandler:
      | ((request: unknown, socket: FakeSocket) => Promise<void> | void)
      | null = null;
    const service = new RealtimeService(
      {
        httpAdapter: {
          getHttpServer: () => ({
            on: (event: string, handler: typeof upgradeHandler) => {
              if (event === "upgrade") upgradeHandler = handler;
            },
          }),
        },
      } as any,
      {
        validateAccessToken: async (token: string | undefined) => {
          assert.equal(token, "token-1");
          return {
            sessionId: "session-1",
            tenantId: "tenant-1",
            userId: "user-1",
          };
        },
      } as any,
    );

    service.onApplicationBootstrap();
    assert.ok(upgradeHandler);

    const socket = new FakeSocket();
    await upgradeHandler(
      {
        headers: {
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
        url: "/api/realtime?access_token=token-1",
      },
      socket,
    );

    assert.match(String(socket.writes[0]), /101 Switching Protocols/);
    assert.equal(decodeServerFrame(socket.writes[1] as Buffer).type, "realtime.connected");

    service.publishToUser("tenant-1", "user-1", {
      payload: { value: 1 },
      type: "custom.event",
    });

    const pushed = decodeServerFrame(socket.writes[2] as Buffer);
    assert.equal(pushed.type, "custom.event");
    assert.deepEqual(pushed.payload, { value: 1 });
    assert.equal(pushed.tenantId, "tenant-1");
  });

  it("rejects unauthenticated websocket upgrades", async () => {
    let upgradeHandler:
      | ((request: unknown, socket: FakeSocket) => Promise<void> | void)
      | null = null;
    const service = new RealtimeService(
      {
        httpAdapter: {
          getHttpServer: () => ({
            on: (event: string, handler: typeof upgradeHandler) => {
              if (event === "upgrade") upgradeHandler = handler;
            },
          }),
        },
      } as any,
      {
        validateAccessToken: async () => {
          throw new Error("invalid");
        },
      } as any,
    );

    service.onApplicationBootstrap();
    assert.ok(upgradeHandler);

    const socket = new FakeSocket();
    await upgradeHandler(
      {
        headers: {
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
        url: "/api/realtime?access_token=bad",
      },
      socket,
    );

    assert.match(String(socket.writes[0]), /401 Unauthorized/);
    assert.equal(socket.destroyed, true);
  });

  it("accepts one-time realtime tickets", async () => {
    let upgradeHandler:
      | ((request: unknown, socket: FakeSocket) => Promise<void> | void)
      | null = null;
    let consumedTicket: string | undefined;
    const service = new RealtimeService(
      {
        httpAdapter: {
          getHttpServer: () => ({
            on: (event: string, handler: typeof upgradeHandler) => {
              if (event === "upgrade") upgradeHandler = handler;
            },
          }),
        },
      } as any,
      {
        consumeRealtimeTicket: async (ticket: string | undefined) => {
          consumedTicket = ticket;
          return {
            sessionId: "session-1",
            tenantId: "tenant-1",
            userId: "user-1",
          };
        },
        validateAccessToken: async () => {
          throw new Error("access token should not be used");
        },
      } as any,
    );

    service.onApplicationBootstrap();
    assert.ok(upgradeHandler);

    const socket = new FakeSocket();
    await upgradeHandler(
      {
        headers: {
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
        url: "/api/realtime?ticket=ticket-1",
      },
      socket,
    );

    assert.equal(consumedTicket, "ticket-1");
    assert.match(String(socket.writes[0]), /101 Switching Protocols/);
  });

  it("buffers partial websocket frames before parsing client messages", async () => {
    let upgradeHandler:
      | ((request: unknown, socket: FakeSocket) => Promise<void> | void)
      | null = null;
    const service = new RealtimeService(
      {
        httpAdapter: {
          getHttpServer: () => ({
            on: (event: string, handler: typeof upgradeHandler) => {
              if (event === "upgrade") upgradeHandler = handler;
            },
          }),
        },
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tenantId: "tenant-1",
          userId: "user-1",
        }),
      } as any,
    );

    service.onApplicationBootstrap();
    assert.ok(upgradeHandler);

    const socket = new FakeSocket();
    await upgradeHandler(
      {
        headers: {
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
        url: "/api/realtime?access_token=token-1",
      },
      socket,
    );

    const frame = encodeClientFrame(Buffer.from(JSON.stringify({ type: "ping" })));
    socket.emit("data", frame.subarray(0, 4));
    assert.equal(socket.writes.length, 2);

    socket.emit("data", frame.subarray(4));
    assert.equal(decodeServerFrame(socket.writes[2] as Buffer).type, "pong");
  });

  it("closes clients whose buffered frame data exceeds the limit", async () => {
    let upgradeHandler:
      | ((request: unknown, socket: FakeSocket) => Promise<void> | void)
      | null = null;
    const service = new RealtimeService(
      {
        httpAdapter: {
          getHttpServer: () => ({
            on: (event: string, handler: typeof upgradeHandler) => {
              if (event === "upgrade") upgradeHandler = handler;
            },
          }),
        },
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tenantId: "tenant-1",
          userId: "user-1",
        }),
      } as any,
    );

    service.onApplicationBootstrap();
    assert.ok(upgradeHandler);

    const socket = new FakeSocket();
    await upgradeHandler(
      {
        headers: {
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
        url: "/api/realtime?access_token=token-1",
      },
      socket,
    );

    socket.emit("data", Buffer.alloc(1024 * 1024 + 1));

    assert.equal(socket.destroyed, true);
  });

  it("drops a client when writing a pong fails", async () => {
    let upgradeHandler:
      | ((request: unknown, socket: FakeSocket) => Promise<void> | void)
      | null = null;
    const service = new RealtimeService(
      {
        httpAdapter: {
          getHttpServer: () => ({
            on: (event: string, handler: typeof upgradeHandler) => {
              if (event === "upgrade") upgradeHandler = handler;
            },
          }),
        },
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tenantId: "tenant-1",
          userId: "user-1",
        }),
      } as any,
    );

    service.onApplicationBootstrap();
    assert.ok(upgradeHandler);

    const socket = new FakeSocket({ throwAfterWrites: 2 });
    await upgradeHandler(
      {
        headers: {
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
        url: "/api/realtime?access_token=token-1",
      },
      socket,
    );

    socket.emit("data", encodeClientFrame(Buffer.from("ping"), 0x9));

    assert.equal(socket.destroyed, true);
  });

  it("drops a failed socket write without blocking other client connections", async () => {
    let upgradeHandler:
      | ((request: unknown, socket: FakeSocket) => Promise<void> | void)
      | null = null;
    const service = new RealtimeService(
      {
        httpAdapter: {
          getHttpServer: () => ({
            on: (event: string, handler: typeof upgradeHandler) => {
              if (event === "upgrade") upgradeHandler = handler;
            },
          }),
        },
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tenantId: "tenant-1",
          userId: "user-1",
        }),
      } as any,
    );

    service.onApplicationBootstrap();
    assert.ok(upgradeHandler);

    const brokenSocket = new FakeSocket({ throwAfterWrites: 2 });
    const healthySocket = new FakeSocket();
    const request = {
      headers: {
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
      url: "/api/realtime?access_token=token-1",
    };

    await upgradeHandler(request, brokenSocket);
    await upgradeHandler(request, healthySocket);

    service.publishToUser("tenant-1", "user-1", {
      payload: { value: 1 },
      type: "custom.event",
    });

    assert.equal(brokenSocket.destroyed, true);
    assert.equal(decodeServerFrame(healthySocket.writes[2] as Buffer).type, "custom.event");
  });

  it("isolates the same user id across tenant client namespaces", async () => {
    let upgradeHandler:
      | ((request: unknown, socket: FakeSocket) => Promise<void> | void)
      | null = null;
    const service = new RealtimeService(
      {
        httpAdapter: {
          getHttpServer: () => ({
            on: (event: string, handler: typeof upgradeHandler) => {
              if (event === "upgrade") upgradeHandler = handler;
            },
          }),
        },
      } as any,
      {
        validateAccessToken: async (token: string) => ({
          sessionId: token,
          tenantId: token === "tenant-1-token" ? "tenant-1" : "tenant-2",
          userId: "shared-user-id",
        }),
      } as any,
    );
    service.onApplicationBootstrap();
    assert.ok(upgradeHandler);
    const tenantOneSocket = new FakeSocket();
    const tenantTwoSocket = new FakeSocket();
    await upgradeHandler(
      {
        headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
        url: "/api/realtime?access_token=tenant-1-token",
      },
      tenantOneSocket,
    );
    await upgradeHandler(
      {
        headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
        url: "/api/realtime?access_token=tenant-2-token",
      },
      tenantTwoSocket,
    );

    service.publishToUser("tenant-1", "shared-user-id", {
      type: "tenant.event",
    });

    assert.equal(tenantOneSocket.writes.length, 3);
    assert.equal(tenantTwoSocket.writes.length, 2);
  });
});

class FakeSocket extends EventEmitter {
  destroyed = false;
  writes: Array<Buffer | string> = [];

  constructor(private readonly options: { throwAfterWrites?: number } = {}) {
    super();
  }

  destroy() {
    this.destroyed = true;
    this.emit("close");
    return this;
  }

  end() {
    this.destroyed = true;
    this.emit("close");
    return this;
  }

  write(value: Buffer | string) {
    if (
      this.options.throwAfterWrites !== undefined &&
      this.writes.length >= this.options.throwAfterWrites
    ) {
      throw new Error("socket write failed");
    }
    this.writes.push(value);
    return true;
  }
}

function decodeServerFrame(value: Buffer) {
  const length = value[1]! & 0x7f;
  const payloadOffset = length === 126 ? 4 : length === 127 ? 10 : 2;
  const payloadLength =
    length === 126
      ? value.readUInt16BE(2)
      : length === 127
        ? Number(value.readBigUInt64BE(2))
        : length;
  const payload = value.subarray(payloadOffset, payloadOffset + payloadLength);
  return JSON.parse(payload.toString("utf8")) as {
    payload: unknown;
    type: string;
  };
}

function encodeClientFrame(payload: Buffer, opcode = 0x1) {
  const mask = Buffer.from([1, 2, 3, 4]);
  const header =
    payload.length < 126
      ? Buffer.from([0x80 | opcode, 0x80 | payload.length])
      : Buffer.from([
          0x80 | opcode,
          0x80 | 126,
          payload.length >> 8,
          payload.length & 0xff,
        ]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = masked[index]! ^ mask[index % 4]!;
  }
  return Buffer.concat([header, mask, masked]);
}
