import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { FileObject } from "@hermes-swarm/core";
import { FileObjectService } from "./file-object.service.js";
import {
  ObjectStorage,
  ObjectStorageNotFoundError,
  ObjectStorageUnavailableError,
} from "./object-storage.js";

const actor = {
  principalType: "workspace" as const,
  userId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
};

describe("FileObjectService", () => {
  it("creates an opaque workspace upload intent and completes it idempotently", async () => {
    const fixture = createFixture();
    const intent = await fixture.service.createUploadIntent(actor, {
      byteSize: 5,
      mimeType: "text/plain",
      originalName: "report.txt",
      purpose: "document",
      scope: "workspace",
    });
    assert.equal(intent.file.scope, "workspace");
    assert.equal(intent.file.workspaceId, actor.workspaceId);
    assert.equal(intent.requiredHeaders["Content-Type"], "text/plain");
    assert.doesNotMatch(fixture.repository.rows[0]!.objectKey, /report|workspace|1111/i);
    fixture.storage.objects.set(fixture.repository.rows[0]!.objectKey, {
      body: Buffer.from("hello"),
      mimeType: "text/plain",
    });
    const completed = await fixture.service.complete(actor, intent.file.id, {});
    const repeated = await fixture.service.complete(actor, intent.file.id, {});
    assert.equal(completed.status, "ready");
    assert.equal(completed.sha256, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    assert.deepEqual(repeated, completed);
  });

  it("rejects object metadata and image-byte mismatches", async () => {
    const fixture = createFixture();
    const intent = await fixture.service.createUploadIntent(actor, {
      byteSize: 8,
      mimeType: "image/png",
      originalName: "avatar.png",
      purpose: "avatar",
      scope: "account",
    });
    fixture.storage.objects.set(fixture.repository.rows[0]!.objectKey, {
      body: Buffer.from("not-png!"),
      mimeType: "image/png",
    });
    await assert.rejects(
      () => fixture.service.complete(actor, intent.file.id, {}),
      BadRequestException,
    );
    assert.equal(fixture.repository.rows[0]!.status, "failed");
  });

  it("marks missing, size-mismatched, and hash-mismatched objects as failed", async () => {
    const missing = createFixture();
    const missingIntent = await missing.service.createUploadIntent(actor, {
      byteSize: 5,
      mimeType: "text/plain",
      originalName: "missing.txt",
      purpose: "generic",
    });
    await assert.rejects(
      () => missing.service.complete(actor, missingIntent.file.id, {}),
      BadRequestException,
    );
    assert.equal(missing.repository.rows[0]!.failureCode, "OBJECT_MISSING");
    assert.equal(missing.repository.rows[0]!.status, "failed");

    const wrongSize = createFixture();
    const sizeIntent = await wrongSize.service.createUploadIntent(actor, {
      byteSize: 5,
      mimeType: "text/plain",
      originalName: "size.txt",
      purpose: "generic",
    });
    wrongSize.storage.objects.set(wrongSize.repository.rows[0]!.objectKey, {
      body: Buffer.from("too-long"),
      mimeType: "text/plain",
    });
    await assert.rejects(
      () => wrongSize.service.complete(actor, sizeIntent.file.id, {}),
      BadRequestException,
    );
    assert.equal(wrongSize.repository.rows[0]!.failureCode, "OBJECT_METADATA_MISMATCH");

    const wrongHash = createFixture();
    const hashIntent = await wrongHash.service.createUploadIntent(actor, {
      byteSize: 5,
      mimeType: "text/plain",
      originalName: "hash.txt",
      purpose: "generic",
    });
    wrongHash.storage.objects.set(wrongHash.repository.rows[0]!.objectKey, {
      body: Buffer.from("hello"),
      mimeType: "text/plain",
    });
    await assert.rejects(
      () =>
        wrongHash.service.complete(actor, hashIntent.file.id, {
          sha256: "0".repeat(64),
        }),
      BadRequestException,
    );
    assert.equal(wrongHash.repository.rows[0]!.failureCode, "OBJECT_HASH_MISMATCH");
  });

  it("keeps a pending upload retryable when storage is temporarily unavailable", async () => {
    const fixture = createFixture();
    const intent = await fixture.service.createUploadIntent(actor, {
      byteSize: 5,
      mimeType: "text/plain",
      originalName: "retry.txt",
      purpose: "generic",
    });
    fixture.storage.unavailableOperations.add("head");
    await assert.rejects(
      () => fixture.service.complete(actor, intent.file.id, {}),
      ServiceUnavailableException,
    );
    assert.equal(fixture.repository.rows[0]!.status, "pending");
  });

  it("fails closed across workspaces and deletes an unbound owner file", async () => {
    const fixture = createFixture();
    const intent = await fixture.service.createUploadIntent(actor, {
      byteSize: 5,
      mimeType: "text/plain",
      originalName: "note.txt",
      purpose: "generic",
      scope: "workspace",
    });
    await assert.rejects(
      () =>
        fixture.service.getMetadata(
          { ...actor, workspaceId: "33333333-3333-4333-8333-333333333333" },
          intent.file.id,
        ),
      NotFoundException,
    );
    fixture.storage.objects.set(fixture.repository.rows[0]!.objectKey, {
      body: Buffer.from("hello"),
      mimeType: "text/plain",
    });
    await fixture.service.deleteTemporary(actor, intent.file.id);
    assert.equal(fixture.repository.rows[0]!.status, "deleted");
  });

  it("does not expose account-scoped files to integration principals", async () => {
    const fixture = createFixture();
    const intent = await fixture.service.createUploadIntent(actor, {
      byteSize: 8,
      mimeType: "image/png",
      originalName: "avatar.png",
      purpose: "avatar",
      scope: "account",
    });
    await assert.rejects(
      () =>
        fixture.service.getMetadata(
          { ...actor, principalType: "integration" },
          intent.file.id,
        ),
      NotFoundException,
    );
  });

  it("returns a stable 503 when storage is disabled or unavailable", async () => {
    const disabled = createFixture(false);
    await assert.rejects(
      () =>
        disabled.service.createUploadIntent(actor, {
          byteSize: 1,
          mimeType: "text/plain",
          originalName: "a.txt",
          purpose: "generic",
        }),
      ServiceUnavailableException,
    );
    const unavailable = createFixture();
    unavailable.storage.fail = true;
    await assert.rejects(
      () => unavailable.service.healthStatus(),
      ObjectStorageUnavailableError,
    );
  });

  it("collects expired temporary objects and retries failures", async () => {
    const fixture = createFixture();
    const first = fixture.repository.add({ expiresAt: new Date(0) });
    const second = fixture.repository.add({ expiresAt: new Date(0) });
    fixture.storage.objects.set(first.objectKey, { body: Buffer.from("a"), mimeType: "text/plain" });
    fixture.storage.objects.set(second.objectKey, { body: Buffer.from("b"), mimeType: "text/plain" });
    fixture.storage.deleteFailures.add(second.objectKey);
    const summary = await fixture.service.collectGarbage();
    assert.deepEqual(summary, { deleted: 1, failed: 1, scanned: 2 });
    assert.equal(first.status, "deleted");
    assert.equal(second.failureCode, "DELETE_RETRY");
    assert.equal(second.status, "failed");
  });

  it("binds workspace files once and rebinds platform files only with explicit authority", async () => {
    const fixture = createFixture();
    const workspaceIntent = await readyTicketFile(fixture, actor);
    const manager = createEntityManager(fixture.repository);
    const [workspaceFile] = await fixture.service.claimTicketFiles(manager as any, {
      actor,
      allowPlatformFiles: false,
      fileIds: [workspaceIntent.file.id],
      workspaceId: actor.workspaceId,
    });
    assert.equal(workspaceFile?.retention, "persistent");
    await assert.rejects(
      () => fixture.service.getContentUrl(actor, workspaceIntent.file.id),
      NotFoundException,
    );
    await assert.rejects(
      () =>
        fixture.service.claimTicketFiles(manager as any, {
          actor,
          allowPlatformFiles: false,
          fileIds: [workspaceIntent.file.id],
          workspaceId: actor.workspaceId,
        }),
      BadRequestException,
    );

    const platformActor = {
      principalType: "platform" as const,
      userId: "44444444-4444-4444-8444-444444444444",
      workspaceId: null,
    };
    const platformIntent = await readyTicketFile(fixture, platformActor);
    await assert.rejects(
      () =>
        fixture.service.claimTicketFiles(manager as any, {
          actor: platformActor,
          allowPlatformFiles: false,
          fileIds: [platformIntent.file.id],
          workspaceId: actor.workspaceId,
        }),
      BadRequestException,
    );
    const [platformFile] = await fixture.service.claimTicketFiles(manager as any, {
      actor: platformActor,
      allowPlatformFiles: true,
      fileIds: [platformIntent.file.id],
      workspaceId: actor.workspaceId,
    });
    assert.equal(platformFile?.scopeType, "workspace");
    assert.equal(platformFile?.workspaceId, actor.workspaceId);
  });
});

async function readyTicketFile(
  fixture: ReturnType<typeof createFixture>,
  owner: typeof actor | { principalType: "platform"; userId: string; workspaceId: null },
) {
  const intent = await fixture.service.createUploadIntent(owner, {
    byteSize: 5,
    mimeType: "text/plain",
    originalName: "ticket.txt",
    purpose: "ticket_attachment",
    scope: owner.principalType === "platform" ? "platform" : "workspace",
  });
  const row = fixture.repository.rows.find((item) => item.id === intent.file.id)!;
  fixture.storage.objects.set(row.objectKey, {
    body: Buffer.from("hello"),
    mimeType: "text/plain",
  });
  await fixture.service.complete(owner, row.id, {});
  return intent;
}

function createEntityManager(repository: FakeFileRepository) {
  return {
    count: async () => 0,
    findOne: async (_target: unknown, input: { where: { id: string } }) =>
      repository.findOne(input),
    save: async (_target: unknown, value: FileObject) => repository.save(value),
  };
}

function createFixture(enabled = true) {
  const repository = new FakeFileRepository();
  const storage = new FakeObjectStorage(enabled);
  const manager = {
    count: async () => 0,
    findOne: async (_target: unknown, input: { where: { id: string } }) =>
      repository.findOne(input),
    save: async (_target: unknown, value: FileObject) => repository.save(value),
  };
  const dataSource = {
    manager,
    transaction: async (work: (entityManager: typeof manager) => unknown) =>
      work(manager),
  };
  const config = {
    get(name: string, fallback: unknown) {
      const values: Record<string, unknown> = {
        "storage.downloadUrlTtlSeconds": 300,
        "storage.maxUploadBytes": 100 * 1024 * 1024,
        "storage.pendingTtlSeconds": 86_400,
        "storage.uploadUrlTtlSeconds": 900,
      };
      return values[name] ?? fallback;
    },
  };
  return {
    repository,
    service: new FileObjectService(
      dataSource as any,
      storage,
      config as any,
      repository as any,
    ),
    storage,
  };
}

class FakeObjectStorage extends ObjectStorage {
  readonly bucket = "private-files";
  fail = false;
  readonly objects = new Map<string, { body: Buffer; mimeType: string }>();
  readonly deleteFailures = new Set<string>();
  readonly unavailableOperations = new Set<string>();

  constructor(readonly enabled: boolean) {
    super();
  }

  async deleteObject(key: string) {
    if (this.deleteFailures.has(key)) throw new ObjectStorageUnavailableError("delete");
    this.objects.delete(key);
  }
  async getObjectStream(key: string) {
    if (this.unavailableOperations.has("get")) {
      throw new ObjectStorageUnavailableError("get");
    }
    const object = this.objects.get(key);
    if (!object) throw new ObjectStorageNotFoundError();
    return Readable.from([object.body]);
  }
  async headObject(key: string) {
    if (this.unavailableOperations.has("head")) {
      throw new ObjectStorageUnavailableError("head");
    }
    const object = this.objects.get(key);
    if (!object) throw new ObjectStorageNotFoundError();
    return { byteSize: object.body.length, etag: "etag", mimeType: object.mimeType };
  }
  async healthCheck() {
    if (this.fail) throw new ObjectStorageUnavailableError("health");
  }
  async presignDownload({ key }: { key: string }) {
    return `https://storage.example/get/${key}`;
  }
  async presignUpload({ key }: { key: string }) {
    return `https://storage.example/put/${key}`;
  }
  async putObject(input: { body: Buffer; key: string; mimeType: string }) {
    this.objects.set(input.key, { body: input.body, mimeType: input.mimeType });
    return { etag: "etag" };
  }
}

class FakeFileRepository {
  readonly rows: FileObject[] = [];

  add(overrides: Partial<FileObject>) {
    return this.save(this.create({
      bucket: "private-files",
      byteSize: 1,
      createdByAccountId: actor.userId,
      deletedAt: null,
      etag: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      failureCode: null,
      mimeType: "text/plain",
      objectKey: randomUUID(),
      originalName: "file.txt",
      purpose: "generic",
      retention: "temporary",
      scopeType: "workspace",
      sha256: null,
      status: "pending",
      storageBackend: "s3",
      workspaceId: actor.workspaceId,
      ...overrides,
    })) as FileObject;
  }

  create(input: Partial<FileObject>) {
    return Object.assign(new FileObject(), input);
  }

  async findOne(input: { where: { id: string } }) {
    return this.rows.find((row) => row.id === input.where.id) ?? null;
  }

  save(file: FileObject) {
    file.id ||= randomUUID();
    file.createdAt ||= new Date();
    file.updatedAt ||= file.createdAt;
    if (!this.rows.includes(file)) this.rows.push(file);
    return file;
  }

  createQueryBuilder() {
    const builder = {
      andWhere: () => builder,
      getMany: async () =>
        this.rows.filter(
          (row) =>
            row.retention === "temporary" &&
            row.status !== "deleted" &&
            row.expiresAt !== null &&
            row.expiresAt <= new Date(),
        ),
      orderBy: () => builder,
      take: () => builder,
      where: () => builder,
    };
    return builder;
  }
}
