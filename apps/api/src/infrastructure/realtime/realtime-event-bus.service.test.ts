import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RealtimeEventBus } from "./realtime-event-bus.service.js";

describe("RealtimeEventBus", () => {
  it("delivers locally and remotely once while ignoring its own Redis event", async () => {
    const channelCallbacks = new Map<string, (message: string) => void>();
    const published: string[] = [];
    const redis = {
      duplicate: () => ({
        connect: async () => undefined,
        on: () => undefined,
        quit: async () => undefined,
        subscribe: async (channel: string, callback: (message: string) => void) => {
          channelCallbacks.set(channel, callback);
        },
        unsubscribe: async () => undefined,
      }),
      publish: async (_channel: string, event: string) => {
        published.push(event);
      },
    };
    const localDeliveries: any[] = [];
    const remoteDeliveries: any[] = [];
    const local = new RealtimeEventBus(
      { getClient: async () => redis } as any,
      { publishToUsers: (users: string[], event: unknown) => localDeliveries.push({ event, users }) } as any,
    );
    const remote = new RealtimeEventBus(
      { getClient: async () => redis } as any,
      { publishToUsers: (users: string[], event: unknown) => remoteDeliveries.push({ event, users }) } as any,
    );
    await local.onApplicationBootstrap();
    await remote.onApplicationBootstrap();

    await local.publishToUsers(["user-1", "user-1"], {
      payload: { id: "message-1" },
      type: "conversation.message.created",
    });
    assert.equal(localDeliveries.length, 1);
    assert.deepEqual(localDeliveries[0].users, ["user-1"]);

    const callback = channelCallbacks.get("realtime.events.v1");
    assert.ok(callback);
    callback(published[0]!);
    assert.equal(localDeliveries.length, 1);
    assert.equal(remoteDeliveries.length, 1);
    assert.deepEqual(remoteDeliveries[0].users, ["user-1"]);
  });
});