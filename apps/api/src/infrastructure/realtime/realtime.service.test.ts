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
          return { sessionId: "session-1", userId: "user-1" };
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

    service.publishToUser("user-1", {
      payload: { value: 1 },
      type: "custom.event",
    });

    const pushed = decodeServerFrame(socket.writes[2] as Buffer);
    assert.equal(pushed.type, "custom.event");
    assert.deepEqual(pushed.payload, { value: 1 });
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
        validateAccessToken: async () => ({ sessionId: "session-1", userId: "user-1" }),
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
});

class FakeSocket extends EventEmitter {
  destroyed = false;
  writes: Array<Buffer | string> = [];

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

function encodeClientFrame(payload: Buffer) {
  const mask = Buffer.from([1, 2, 3, 4]);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = masked[index]! ^ mask[index % 4]!;
  }
  return Buffer.concat([header, mask, masked]);
}
