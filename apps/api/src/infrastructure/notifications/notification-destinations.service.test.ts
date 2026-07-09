import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { NotificationDestinationsService } from "./notification-destinations.service.js";

describe("NotificationDestinationsService", () => {
  it("normalizes supported destination options and drops unknown keys", async () => {
    const repository = createDestinationRepositoryHarness();
    const service = new NotificationDestinationsService(repository.repository);

    const result = await service.create(" org-1 ", {
      name: " DingTalk ",
      options: {
        ignored: "drop",
        password: " secret ",
        url: " https://example.test/webhook ",
        username: "",
      },
      type: "dingtalk",
    });

    assert.equal(result.organizationId, "org-1");
    assert.equal(result.name, "DingTalk");
    assert.equal(result.type, "dingtalk");
    assert.deepEqual(result.options, {
      password: "secret",
      url: "https://example.test/webhook",
    });
  });

  it("rejects malformed destination payloads before saving", async () => {
    const repository = createDestinationRepositoryHarness();
    const service = new NotificationDestinationsService(repository.repository);

    await assert.rejects(
      () => service.create("org-1", null),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.create("org-1", {
          name: "Broken",
          options: {},
          type: "dingtalk",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.create("org-1", {
          name: "Broken",
          options: { appId: "app", appSecret: 123 },
          type: "feishu",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.create("org-1", {
          name: "Broken",
          options: { url: `https://example.test/${"x".repeat(2049)}` },
          type: "dingtalk",
        }),
      BadRequestException,
    );
    assert.equal(repository.saved.length, 0);
  });

  it("rejects type changes that would keep stale incompatible options", async () => {
    const destination = createDestination({
      id: "destination-1",
      options: { url: "https://example.test/webhook" },
      organizationId: "org-1",
      type: "dingtalk",
    });
    const repository = createDestinationRepositoryHarness([destination]);
    const service = new NotificationDestinationsService(repository.repository);

    await assert.rejects(
      () =>
        service.update("org-1", "destination-1", {
          type: "feishu",
        }),
      BadRequestException,
    );

    assert.equal(repository.saved.length, 0);
  });

  it("updates type and options together without preserving stale fields", async () => {
    const destination = createDestination({
      id: "destination-1",
      options: { password: "old", url: "https://example.test/webhook" },
      organizationId: "org-1",
      type: "dingtalk",
    });
    const repository = createDestinationRepositoryHarness([destination]);
    const service = new NotificationDestinationsService(repository.repository);

    const result = await service.update("org-1", "destination-1", {
      options: {
        appId: " app-id ",
        appSecret: " app-secret ",
        url: "should-be-dropped",
      },
      type: "feishu",
    });

    assert.equal(result.type, "feishu");
    assert.deepEqual(result.options, {
      appId: "app-id",
      appSecret: "app-secret",
    });
  });

  it("keeps organization scoping when reading, deleting, and listing", async () => {
    const repository = createDestinationRepositoryHarness([
      createDestination({
        id: "destination-1",
        organizationId: "org-1",
      }),
      createDestination({
        id: "destination-2",
        organizationId: "org-2",
      }),
    ]);
    const service = new NotificationDestinationsService(repository.repository);

    const list = await service.list("org-1");
    assert.deepEqual(
      list.map((item) => item.id),
      ["destination-1"],
    );
    await assert.rejects(
      () => service.getOne("org-1", "destination-2"),
      NotFoundException,
    );
    await service.delete("org-1", "destination-1");
    assert.deepEqual(repository.removed.map((item) => item.id), [
      "destination-1",
    ]);
  });

  it("returns empty groups for non-Feishu destinations without external calls", async () => {
    const repository = createDestinationRepositoryHarness([
      createDestination({
        id: "destination-1",
        organizationId: "org-1",
        type: "dingtalk",
      }),
    ]);
    const service = new NotificationDestinationsService(repository.repository);

    const result = await service.groups("org-1", "destination-1");

    assert.deepEqual(result, []);
  });

  it("maps Feishu API failures to controlled bad request errors", async () => {
    const originalFetch = globalThis.fetch;
    const repository = createDestinationRepositoryHarness([
      createDestination({
        id: "destination-1",
        options: { appId: "app", appSecret: "secret" },
        organizationId: "org-1",
        type: "feishu",
      }),
    ]);
    const service = new NotificationDestinationsService(repository.repository);
    globalThis.fetch = (async () =>
      ({
        json: async () => {
          throw new Error("invalid json");
        },
        ok: true,
      }) as Response) as typeof fetch;

    try {
      await assert.rejects(
        () => service.groups("org-1", "destination-1"),
        BadRequestException,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects malformed Feishu group list payloads", async () => {
    const originalFetch = globalThis.fetch;
    const repository = createDestinationRepositoryHarness([
      createDestination({
        id: "destination-1",
        options: { appId: "app", appSecret: "secret" },
        organizationId: "org-1",
        type: "feishu",
      }),
    ]);
    const service = new NotificationDestinationsService(repository.repository);
    const responses = [
      {
        json: async () => ({
          code: 0,
          tenant_access_token: "tenant-token",
        }),
        ok: true,
      },
      {
        json: async () => ({
          code: 0,
          data: { items: { id: "chat-1" } },
        }),
        ok: true,
      },
    ];
    globalThis.fetch = (async () => responses.shift() as Response) as typeof fetch;

    try {
      await assert.rejects(
        () => service.groups("org-1", "destination-1"),
        BadRequestException,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function createDestinationRepositoryHarness(initialItems: any[] = []) {
  const items = [...initialItems];
  const saved: any[] = [];
  const removed: any[] = [];
  const repository: any = {
    create: (value: any) => createDestination(value),
    find: async ({ where }: any) =>
      items.filter((item) => item.organizationId === where.organizationId),
    findOne: async ({ where }: any) =>
      items.find(
        (item) =>
          item.id === where.id && item.organizationId === where.organizationId,
      ) ?? null,
    remove: async (destination: any) => {
      removed.push(destination);
      const index = items.findIndex((item) => item.id === destination.id);
      if (index >= 0) items.splice(index, 1);
      return destination;
    },
    save: async (destination: any) => {
      saved.push(destination);
      const existingIndex = items.findIndex((item) => item.id === destination.id);
      if (existingIndex >= 0) {
        items[existingIndex] = destination;
      } else {
        items.push(destination);
      }
      return destination;
    },
  };
  return { items, removed, repository, saved };
}

function createDestination(overrides: Record<string, unknown> = {}) {
  return {
    id: "destination-1",
    name: "Destination",
    options: { url: "https://example.test/webhook" },
    organizationId: "org-1",
    type: "dingtalk",
    ...overrides,
  };
}
