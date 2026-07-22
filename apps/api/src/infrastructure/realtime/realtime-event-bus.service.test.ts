import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RealtimeEventBus,
  resolveRealtimeWorkspaceId,
} from "./realtime-event-bus.service.js";

describe("RealtimeEventBus", () => {
  it("rejects explicit cross-workspace recipients", () => {
    assert.equal(
      resolveRealtimeWorkspaceId(
        { scopeLevel: "workspace", workspaceId: "workspace-1" },
        "workspace-1",
      ),
      "workspace-1",
    );
    assert.throws(
      () =>
        resolveRealtimeWorkspaceId(
          { scopeLevel: "workspace", workspaceId: "workspace-1" },
          "workspace-2",
        ),
      /cannot cross workspace context/,
    );
  });

  it("delivers locally and remotely once while ignoring its own Redis event", async () => {
    const channelCallbacks = new Map<
      string,
      Array<(message: string, channel: string) => void>
    >();
    const published: Array<{ channel: string; event: string }> = [];
    const redis = {
      duplicate: () => ({
        connect: async () => undefined,
        on: () => undefined,
        quit: async () => undefined,
        pSubscribe: async (
          channel: string,
          callback: (message: string, channel: string) => void,
        ) => {
          channelCallbacks.set(channel, [
            ...(channelCallbacks.get(channel) ?? []),
            callback,
          ]);
        },
        pUnsubscribe: async () => undefined,
      }),
      publish: async (channel: string, event: string) => {
        published.push({ channel, event });
      },
    };
    const localDeliveries: any[] = [];
    const remoteDeliveries: any[] = [];
    const local = new RealtimeEventBus(
      { getClient: async () => redis } as any,
      {
        publishToUsers: (workspaceId: string, users: string[], event: unknown) =>
          localDeliveries.push({ event, workspaceId, users }),
      } as any,
      { current: () => ({ workspaceId: "workspace-1" }) } as any,
    );
    const remote = new RealtimeEventBus(
      { getClient: async () => redis } as any,
      {
        publishToUsers: (workspaceId: string, users: string[], event: unknown) =>
          remoteDeliveries.push({ event, workspaceId, users }),
      } as any,
      { current: () => ({ workspaceId: "workspace-1" }) } as any,
    );
    await local.onApplicationBootstrap();
    await remote.onApplicationBootstrap();

    await local.publishToUsers(["user-1", "user-1"], {
      payload: { message: "test" },
      type: "realtime.error",
    });
    assert.equal(localDeliveries.length, 1);
    assert.deepEqual(localDeliveries[0].users, ["user-1"]);

    assert.equal(published[0]?.channel, "realtime.events.v1:workspace-1");
    const callbacks = channelCallbacks.get("realtime.events.v1:*");
    assert.equal(callbacks?.length, 2);
    for (const callback of callbacks ?? []) {
      callback(published[0]!.event, published[0]!.channel);
    }
    assert.equal(localDeliveries.length, 1);
    assert.equal(remoteDeliveries.length, 1);
    assert.deepEqual(remoteDeliveries[0].users, ["user-1"]);
    assert.equal(remoteDeliveries[0].workspaceId, "workspace-1");
  });
});
