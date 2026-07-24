import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type {
  CompleteFileObjectPayload,
  CreateFileObjectPayload,
} from "@hermes-swarm/api-contracts";
import {
  Account,
  ConversationMessageFile,
  FileObject,
  type FileObjectPurpose,
  type FileObjectScope,
} from "@hermes-swarm/core";
import type { AccessAuthSession } from "@hermes-swarm/rbac";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Readable } from "node:stream";
import { DataSource, type EntityManager, Repository } from "typeorm";
import {
  detectImageMimeType,
  IMAGE_MIME_TYPES,
  MAX_AVATAR_BYTES,
} from "./image-file-validation.js";
import {
  ObjectStorage,
  ObjectStorageDisabledError,
  ObjectStorageNotFoundError,
  ObjectStorageUnavailableError,
} from "./object-storage.js";

export type FileActor = Pick<
  AccessAuthSession,
  "principalType" | "userId" | "workspaceId"
>;

export type UploadedFileBuffer = {
  buffer?: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

const ALLOWED_MIME_TYPES = new Set<string>([
  ...IMAGE_MIME_TYPES,
  "application/json",
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/plain",
]);
const COMPLETION_LEASE_MS = 30 * 60 * 1_000;
const DELETE_LEASE_MS = 5 * 60 * 1_000;
const OBJECT_STREAM_IDLE_TIMEOUT_MS = 30_000;

@Injectable()
export class FileObjectService {
  private readonly downloadUrlTtlSeconds: number;
  private readonly maxUploadBytes: number;
  private readonly pendingTtlSeconds: number;
  private readonly uploadUrlTtlSeconds: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly objectStorage: ObjectStorage,
    config: ConfigService,
    @InjectRepository(FileObject)
    private readonly files: Repository<FileObject>,
  ) {
    this.downloadUrlTtlSeconds = config.get<number>(
      "storage.downloadUrlTtlSeconds",
      300,
    );
    this.maxUploadBytes = config.get<number>(
      "storage.maxUploadBytes",
      100 * 1024 * 1024,
    );
    this.pendingTtlSeconds = config.get<number>(
      "storage.pendingTtlSeconds",
      24 * 60 * 60,
    );
    this.uploadUrlTtlSeconds = config.get<number>(
      "storage.uploadUrlTtlSeconds",
      900,
    );
  }

  async createUploadIntent(actor: FileActor, payload: CreateFileObjectPayload) {
    this.requireEnabled();
    const scope = this.resolveScope(actor, payload.scope, payload.purpose);
    const file = await this.createPendingFile(actor, {
      byteSize: payload.byteSize,
      mimeType: payload.mimeType,
      originalName: payload.originalName,
      purpose: payload.purpose,
      scope,
    });

    try {
      const uploadUrl = await this.objectStorage.presignUpload({
        byteSize: file.byteSize,
        expiresInSeconds: this.uploadUrlTtlSeconds,
        key: file.objectKey,
        mimeType: file.mimeType,
      });
      return {
        file: this.toDto(file),
        requiredHeaders: { "Content-Type": file.mimeType },
        uploadUrl,
        uploadUrlExpiresAt: new Date(
          Date.now() + this.uploadUrlTtlSeconds * 1_000,
        ),
      };
    } catch (error) {
      await this.markFailed(file, "PRESIGN_FAILED");
      this.throwStorageError(error);
    }
  }

  async uploadImage(
    actor: FileActor,
    uploaded: UploadedFileBuffer | undefined,
    input: { purpose: "avatar" | "ticket_attachment"; scope: "account" | "platform" | "workspace" },
  ) {
    this.requireEnabled();
    const buffer = uploaded?.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new BadRequestException("请选择要上传的图片");
    }
    if (buffer.length > MAX_AVATAR_BYTES) {
      throw fileError(
        BadRequestException,
        "UPLOAD_FILE_TOO_LARGE",
        "图片不能超过 2 MB",
      );
    }
    const detectedMimeType = detectImageMimeType(buffer);
    const declaredMimeType = normalizeMimeType(uploaded?.mimetype ?? "");
    if (!detectedMimeType || detectedMimeType !== declaredMimeType) {
      throw fileError(
        BadRequestException,
        "FILE_TYPE_NOT_ALLOWED",
        "仅支持 PNG、JPG、GIF 或 WebP 图片",
      );
    }

    const scope = this.resolveScope(actor, input.scope, input.purpose);
    const file = await this.createPendingFile(actor, {
      byteSize: buffer.length,
      mimeType: detectedMimeType,
      originalName: uploaded?.originalname ?? "image",
      purpose: input.purpose,
      scope,
    });
    try {
      await this.objectStorage.putObject({
        body: buffer,
        byteSize: buffer.length,
        key: file.objectKey,
        mimeType: detectedMimeType,
      });
    } catch (error) {
      await this.markFailed(file, "UPLOAD_FAILED");
      this.throwStorageError(error);
    }
    const ready = await this.complete(actor, file.id, {});
    let url: string;
    try {
      url = await this.objectStorage.presignDownload({
        expiresInSeconds: this.downloadUrlTtlSeconds,
        key: file.objectKey,
        originalName: ready.originalName,
      });
    } catch (error) {
      this.throwStorageError(error);
    }
    return {
      destinations: [{ kind: "storage", status: "success" as const, url }],
      fileId: file.id,
      mimeType: ready.mimeType,
      name: ready.originalName,
      originalName: ready.originalName,
      size: ready.byteSize,
      status: "success" as const,
      url,
    };
  }

  async complete(
    actor: FileActor,
    fileId: string,
    payload: CompleteFileObjectPayload,
  ) {
    this.requireEnabled();
    const file = await this.beginCompletion(actor, fileId);
    if (file.status === "ready") return this.toDto(file);

    try {
      const head = await this.objectStorage.headObject(file.objectKey);
      if (
        head.byteSize !== file.byteSize ||
        (head.mimeType && normalizeMimeType(head.mimeType) !== file.mimeType)
      ) {
        await this.markCompletionFailed(file.id, "OBJECT_METADATA_MISMATCH");
        throw fileError(
          BadRequestException,
          "FILE_OBJECT_METADATA_MISMATCH",
          "上传对象的大小或类型与上传意图不一致",
        );
      }

      const inspected = await inspectObject(
        await this.objectStorage.getObjectStream(file.objectKey),
        this.maxUploadBytes,
      );
      if (inspected.byteSize !== file.byteSize) {
        await this.markCompletionFailed(file.id, "OBJECT_SIZE_MISMATCH");
        throw fileError(
          BadRequestException,
          "FILE_OBJECT_SIZE_MISMATCH",
          "上传对象的实际大小不一致",
        );
      }
      if (
        payload.sha256 &&
        inspected.sha256 !== payload.sha256.trim().toLowerCase()
      ) {
        await this.markCompletionFailed(file.id, "OBJECT_HASH_MISMATCH");
        throw fileError(
          BadRequestException,
          "FILE_OBJECT_HASH_MISMATCH",
          "上传对象的 SHA-256 不一致",
        );
      }
      if (
        isImageMimeType(file.mimeType) &&
        detectImageMimeType(inspected.signature) !== file.mimeType
      ) {
        await this.markCompletionFailed(file.id, "OBJECT_TYPE_MISMATCH");
        throw fileError(
          BadRequestException,
          "FILE_OBJECT_TYPE_MISMATCH",
          "图片实际格式与声明类型不一致",
        );
      }

      return this.toDto(
        await this.finishCompletion(file.id, {
          byteSize: inspected.byteSize,
          etag: head.etag,
          sha256: inspected.sha256,
        }),
      );
    } catch (error) {
      if (error instanceof ObjectStorageNotFoundError) {
        await this.markCompletionFailed(file.id, "OBJECT_MISSING");
      }
      this.throwStorageError(error);
    }
  }

  async getMetadata(actor: FileActor, fileId: string) {
    return this.toDto(await this.findAuthorized(actor, fileId));
  }

  async getContentUrl(actor: FileActor, fileId: string) {
    this.requireEnabled();
    const file = await this.findAuthorized(actor, fileId);
    if (file.status !== "ready") {
      throw fileError(NotFoundException, "FILE_OBJECT_NOT_READY", "文件不可用");
    }
    try {
      return await this.objectStorage.presignDownload({
        expiresInSeconds: this.downloadUrlTtlSeconds,
        key: file.objectKey,
        originalName: file.originalName,
      });
    } catch (error) {
      this.throwStorageError(error);
    }
  }

  async deleteTemporary(actor: FileActor, fileId: string) {
    this.requireEnabled();
    const file = await this.dataSource.transaction(async (manager) => {
      const candidate = await manager.findOne(FileObject, {
        lock: { mode: "pessimistic_write" },
        where: { id: fileId },
      });
      if (!candidate || !this.actorCanManage(actor, candidate)) {
        throw new NotFoundException("文件不存在");
      }
      if (this.hasActiveCompletionLease(candidate)) {
        throw fileError(
          ConflictException,
          "FILE_OBJECT_COMPLETION_IN_PROGRESS",
          "文件正在完成校验，请稍后再删除",
        );
      }
      if (this.hasActiveDeletionLease(candidate)) {
        throw fileError(
          ConflictException,
          "FILE_OBJECT_DELETION_IN_PROGRESS",
          "文件正在删除",
        );
      }
      if (
        candidate.createdByAccountId !== actor.userId ||
        candidate.retention !== "temporary"
      ) {
        throw fileError(
          ForbiddenException,
          "FILE_OBJECT_DELETE_FORBIDDEN",
          "只能删除自己创建且尚未绑定的临时文件",
        );
      }
      const [avatarBindings, messageBindings] = await Promise.all([
        manager.count(Account, {
          where: { avatarFileObjectId: candidate.id },
        }),
        manager.count(ConversationMessageFile, {
          where: { fileObjectId: candidate.id },
        }),
      ]);
      if (avatarBindings + messageBindings > 0) {
        throw fileError(
          ConflictException,
          "FILE_OBJECT_ALREADY_BOUND",
          "已绑定的文件必须由所属业务删除",
        );
      }
      return this.stageDeletion(manager, candidate);
    });
    await this.deletePhysicalObject(file);
  }

  async claimAvatar(
    manager: EntityManager,
    fileId: string,
    accountId: string,
  ) {
    const file = await manager.findOne(FileObject, {
      lock: { mode: "pessimistic_write" },
      where: { id: fileId },
    });
    if (
      !file ||
      file.scopeType !== "account" ||
      file.workspaceId !== null ||
      file.createdByAccountId !== accountId ||
      file.purpose !== "avatar" ||
      file.status !== "ready"
    ) {
      throw fileError(
        BadRequestException,
        "AVATAR_FILE_INVALID",
        "头像文件无效或不属于当前账号",
      );
    }
    file.expiresAt = null;
    file.retention = "persistent";
    file.updatedAt = new Date();
    return manager.save(FileObject, file);
  }

  async claimTicketFiles(
    manager: EntityManager,
    input: {
      actor: FileActor;
      allowPlatformFiles: boolean;
      fileIds: string[];
      workspaceId: string;
    },
  ) {
    const uniqueIds = [...new Set(input.fileIds)];
    if (uniqueIds.length !== input.fileIds.length || uniqueIds.length > 6) {
      throw fileError(
        BadRequestException,
        "TICKET_ATTACHMENTS_INVALID",
        "工单附件重复或超过 6 个",
      );
    }
    const claimed: FileObject[] = [];
    for (const fileId of uniqueIds) {
      const file = await manager.findOne(FileObject, {
        lock: { mode: "pessimistic_write" },
        where: { id: fileId },
      });
      const workspaceOwned =
        file?.scopeType === "workspace" &&
        file.workspaceId === input.workspaceId &&
        input.actor.workspaceId === input.workspaceId;
      const platformOwned =
        input.allowPlatformFiles &&
        input.actor.principalType === "platform" &&
        file?.scopeType === "platform" &&
        file.workspaceId === null;
      if (
        !file ||
        (!workspaceOwned && !platformOwned) ||
        file.createdByAccountId !== input.actor.userId ||
        file.purpose !== "ticket_attachment" ||
        file.status !== "ready" ||
        file.retention !== "temporary"
      ) {
        throw fileError(
          BadRequestException,
          "TICKET_ATTACHMENT_FILE_INVALID",
          "工单附件无效、已被使用或不属于当前上下文",
        );
      }
      const bindings = await manager.count(ConversationMessageFile, {
        where: { fileObjectId: file.id },
      });
      if (bindings > 0) {
        throw fileError(
          ConflictException,
          "TICKET_ATTACHMENT_ALREADY_BOUND",
          "工单附件已经绑定到其他消息",
        );
      }
      file.expiresAt = null;
      file.purpose = "ticket_attachment";
      file.retention = "persistent";
      file.scopeType = "workspace";
      file.workspaceId = input.workspaceId;
      file.updatedAt = new Date();
      claimed.push(await manager.save(FileObject, file));
    }
    return claimed;
  }

  async createWorkspaceDownloadUrls(files: FileObject[], workspaceId: string) {
    this.requireEnabled();
    return Promise.all(
      files.map(async (file) => {
        if (
          file.scopeType !== "workspace" ||
          file.workspaceId !== workspaceId ||
          file.status !== "ready"
        ) {
          throw new NotFoundException("文件不存在");
        }
        try {
          const url = await this.objectStorage.presignDownload({
            expiresInSeconds: this.downloadUrlTtlSeconds,
            key: file.objectKey,
            originalName: file.originalName,
          });
          return { file, url };
        } catch (error) {
          this.throwStorageError(error);
        }
      }),
    );
  }

  async collectGarbage(limit = 100) {
    if (!this.objectStorage.enabled) return { deleted: 0, failed: 0, scanned: 0 };
    const files = await this.files
      .createQueryBuilder("file")
      .where("file.retention = :retention", { retention: "temporary" })
      .andWhere("file.status <> :deleted", { deleted: "deleted" })
      .andWhere("file.expiresAt IS NOT NULL AND file.expiresAt <= :now", {
        now: new Date(),
      })
      .orderBy("file.expiresAt", "ASC")
      .take(Math.max(1, Math.min(limit, 1_000)))
      .getMany();
    let deleted = 0;
    let failed = 0;
    for (const file of files) {
      const leased = await this.leaseExpiredFile(file.id);
      if (!leased) continue;
      try {
        await this.deletePhysicalObject(leased);
        deleted += 1;
      } catch {
        failed += 1;
      }
    }
    return { deleted, failed, scanned: files.length };
  }

  async healthStatus() {
    if (!this.objectStorage.enabled) return "disabled" as const;
    await this.objectStorage.healthCheck();
    return "connected" as const;
  }

  toDto(file: FileObject) {
    return {
      byteSize: file.byteSize,
      createdAt: file.createdAt,
      createdByAccountId: file.createdByAccountId,
      deletedAt: file.deletedAt,
      expiresAt: file.expiresAt,
      id: file.id,
      mimeType: file.mimeType,
      originalName: file.originalName,
      purpose: file.purpose,
      retention: file.retention,
      scope: file.scopeType,
      sha256: file.sha256,
      status: file.status,
      updatedAt: file.updatedAt,
      workspaceId: file.workspaceId,
    };
  }

  private async createPendingFile(
    actor: FileActor,
    input: {
      byteSize: number;
      mimeType: string;
      originalName: string;
      purpose: FileObjectPurpose;
      scope: FileObjectScope;
    },
  ) {
    const byteSize = Number(input.byteSize);
    const mimeType = normalizeMimeType(input.mimeType);
    if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > this.maxUploadBytes) {
      throw fileError(
        BadRequestException,
        "FILE_SIZE_INVALID",
        `文件大小必须在 1 字节到 ${this.maxUploadBytes} 字节之间`,
      );
    }
    if (input.purpose === "avatar" && byteSize > MAX_AVATAR_BYTES) {
      throw fileError(
        BadRequestException,
        "UPLOAD_FILE_TOO_LARGE",
        "头像不能超过 2 MB",
      );
    }
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw fileError(
        BadRequestException,
        "FILE_TYPE_NOT_ALLOWED",
        "不支持此文件类型",
      );
    }
    const file = this.files.create({
      bucket: this.objectStorage.bucket,
      byteSize,
      createdByAccountId: actor.userId,
      deletedAt: null,
      etag: null,
      expiresAt: new Date(Date.now() + this.pendingTtlSeconds * 1_000),
      failureCode: null,
      mimeType,
      objectKey: randomObjectKey(),
      originalName: normalizeFilename(input.originalName),
      purpose: input.purpose,
      retention: "temporary",
      scopeType: input.scope,
      sha256: null,
      status: "pending",
      storageBackend: "s3",
      workspaceId: input.scope === "workspace" ? actor.workspaceId : null,
    });
    return this.files.save(file);
  }

  private resolveScope(
    actor: FileActor,
    requested: FileObjectScope | undefined,
    purpose: FileObjectPurpose,
  ): FileObjectScope {
    if (actor.principalType === "integration") {
      throw new ForbiddenException("集成令牌不能创建文件对象");
    }
    const scope =
      requested ??
      (purpose === "avatar"
        ? "account"
        : actor.principalType === "platform"
          ? "platform"
          : "workspace");
    if (purpose === "avatar" && scope !== "account") {
      throw fileError(
        BadRequestException,
        "FILE_SCOPE_INVALID",
        "头像必须使用账号作用域",
      );
    }
    if (scope === "platform" && actor.principalType !== "platform") {
      throw new ForbiddenException("平台文件需要平台会话");
    }
    if (
      scope === "workspace" &&
      (actor.principalType !== "workspace" || !actor.workspaceId)
    ) {
      throw new ForbiddenException("工作空间文件需要工作空间会话");
    }
    if (actor.principalType === "platform" && scope !== "platform" && scope !== "account") {
      throw new ForbiddenException("平台会话不能直接创建工作空间文件");
    }
    return scope;
  }

  private async findAuthorized(actor: FileActor, fileId: string) {
    const file = await this.files.findOne({ where: { id: fileId } });
    if (!file || !this.actorCanManage(actor, file)) {
      throw new NotFoundException("文件不存在");
    }
    return file;
  }

  private async beginCompletion(actor: FileActor, fileId: string) {
    return this.dataSource.transaction(async (manager) => {
      const file = await manager.findOne(FileObject, {
        lock: { mode: "pessimistic_write" },
        where: { id: fileId },
      });
      if (!file || !this.actorCanManage(actor, file)) {
        throw new NotFoundException("文件不存在");
      }
      if (file.status === "ready") return file;
      if (file.status !== "pending") {
        throw fileError(
          ConflictException,
          "FILE_OBJECT_NOT_PENDING",
          "文件不处于待确认状态",
        );
      }
      file.failureCode = "COMPLETE_PENDING";
      file.updatedAt = new Date();
      return manager.save(FileObject, file);
    });
  }

  private async finishCompletion(
    fileId: string,
    input: { byteSize: number; etag: string | null; sha256: string },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const file = await manager.findOne(FileObject, {
        lock: { mode: "pessimistic_write" },
        where: { id: fileId },
      });
      if (!file) throw new NotFoundException("文件不存在");
      if (file.status === "ready") return file;
      if (file.status !== "pending" || file.failureCode !== "COMPLETE_PENDING") {
        throw fileError(
          ConflictException,
          "FILE_OBJECT_COMPLETION_CONFLICT",
          "文件状态已被其他操作修改",
        );
      }
      file.byteSize = input.byteSize;
      file.etag = input.etag;
      file.failureCode = null;
      file.sha256 = input.sha256;
      file.status = "ready";
      file.updatedAt = new Date();
      return manager.save(FileObject, file);
    });
  }

  private async markCompletionFailed(fileId: string, code: string) {
    return this.dataSource.transaction(async (manager) => {
      const file = await manager.findOne(FileObject, {
        lock: { mode: "pessimistic_write" },
        where: { id: fileId },
      });
      if (
        !file ||
        file.status !== "pending" ||
        file.failureCode !== "COMPLETE_PENDING"
      ) {
        return file;
      }
      file.failureCode = code;
      file.status = "failed";
      file.updatedAt = new Date();
      return manager.save(FileObject, file);
    });
  }

  private actorCanManage(actor: FileActor, file: FileObject) {
    if (
      file.status === "deleted" ||
      (file.retention === "persistent" && file.purpose !== "avatar")
    ) {
      return false;
    }
    return (
      (file.scopeType === "account" &&
        actor.principalType !== "integration" &&
        file.createdByAccountId === actor.userId) ||
        (file.scopeType === "platform" &&
          actor.principalType === "platform" &&
          file.createdByAccountId === actor.userId) ||
        (file.scopeType === "workspace" &&
          actor.principalType === "workspace" &&
          Boolean(actor.workspaceId) &&
          file.workspaceId === actor.workspaceId &&
          file.createdByAccountId === actor.userId)
    );
  }

  private async leaseExpiredFile(fileId: string) {
    return this.dataSource.transaction(async (manager) => {
      const file = await manager.findOne(FileObject, {
        lock: { mode: "pessimistic_write" },
        where: { id: fileId },
      });
      if (
        !file ||
        file.retention !== "temporary" ||
        file.status === "deleted" ||
        !file.expiresAt ||
        file.expiresAt > new Date() ||
        this.hasActiveCompletionLease(file)
      ) {
        return null;
      }
      return this.stageDeletion(manager, file);
    });
  }

  private stageDeletion(manager: EntityManager, file: FileObject) {
    file.expiresAt = new Date(Date.now() + DELETE_LEASE_MS);
    file.failureCode = "DELETE_PENDING";
    file.status = "failed";
    file.updatedAt = new Date();
    return manager.save(FileObject, file);
  }

  private hasActiveCompletionLease(file: FileObject) {
    return (
      file.status === "pending" &&
      file.failureCode === "COMPLETE_PENDING" &&
      file.updatedAt > new Date(Date.now() - COMPLETION_LEASE_MS)
    );
  }

  private hasActiveDeletionLease(file: FileObject) {
    return (
      file.failureCode === "DELETE_PENDING" &&
      Boolean(file.expiresAt && file.expiresAt > new Date())
    );
  }

  private async deletePhysicalObject(file: FileObject) {
    try {
      await this.objectStorage.deleteObject(file.objectKey);
      file.deletedAt = new Date();
      file.failureCode = null;
      file.status = "deleted";
      file.updatedAt = new Date();
      await this.files.save(file);
    } catch (error) {
      if (error instanceof ObjectStorageNotFoundError) {
        file.deletedAt = new Date();
        file.failureCode = null;
        file.status = "deleted";
        file.updatedAt = new Date();
        await this.files.save(file);
        return;
      }
      file.failureCode = "DELETE_RETRY";
      file.expiresAt = new Date();
      file.status = "failed";
      file.updatedAt = new Date();
      await this.files.save(file);
      this.throwStorageError(error);
    }
  }

  private async markFailed(file: FileObject, code: string) {
    file.failureCode = code;
    file.status = "failed";
    file.updatedAt = new Date();
    await this.files.save(file);
  }

  private requireEnabled() {
    if (!this.objectStorage.enabled) {
      throw fileError(
        ServiceUnavailableException,
        "OBJECT_STORAGE_DISABLED",
        "对象存储尚未启用",
      );
    }
  }

  private throwStorageError(error: unknown): never {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof ForbiddenException ||
      error instanceof NotFoundException ||
      error instanceof ServiceUnavailableException
    ) {
      throw error;
    }
    if (error instanceof ObjectStorageNotFoundError) {
      throw fileError(
        BadRequestException,
        "FILE_OBJECT_MISSING",
        "对象存储中不存在该文件",
      );
    }
    if (
      error instanceof ObjectStorageDisabledError ||
      error instanceof ObjectStorageUnavailableError
    ) {
      throw fileError(
        ServiceUnavailableException,
        error instanceof ObjectStorageDisabledError
          ? "OBJECT_STORAGE_DISABLED"
          : "OBJECT_STORAGE_UNAVAILABLE",
        error instanceof ObjectStorageDisabledError
          ? "对象存储尚未启用"
          : "对象存储暂时不可用",
      );
    }
    throw error;
  }
}

async function inspectObject(stream: Readable, maxBytes: number) {
  const hash = createHash("sha256");
  const signatureParts: Buffer[] = [];
  let signatureLength = 0;
  let byteSize = 0;
  let idleTimeout: NodeJS.Timeout | undefined;
  const armIdleTimeout = () => {
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
      stream.destroy(new ObjectStorageUnavailableError("get_stream_timeout"));
    }, OBJECT_STREAM_IDLE_TIMEOUT_MS);
    idleTimeout.unref?.();
  };
  armIdleTimeout();
  try {
    for await (const raw of stream) {
      armIdleTimeout();
      const chunk = Buffer.from(raw);
      byteSize += chunk.length;
      if (byteSize > maxBytes) {
        throw fileError(
          BadRequestException,
          "FILE_SIZE_INVALID",
          "上传对象超过允许大小",
        );
      }
      hash.update(chunk);
      if (signatureLength < 16) {
        const part = chunk.subarray(0, 16 - signatureLength);
        signatureParts.push(part);
        signatureLength += part.length;
      }
    }
  } finally {
    if (idleTimeout) clearTimeout(idleTimeout);
  }
  return {
    byteSize,
    sha256: hash.digest("hex"),
    signature: Buffer.concat(signatureParts),
  };
}

function isImageMimeType(value: string) {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

function normalizeMimeType(value: string) {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

function normalizeFilename(value: string) {
  const filename = path.basename(String(value)).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!filename) throw new BadRequestException("文件名无效");
  return filename.slice(0, 240);
}

function randomObjectKey() {
  return `${randomUUID().replaceAll("-", "")}/${randomUUID().replaceAll("-", "")}`;
}

function fileError<T extends new (body: object) => Error>(
  ExceptionType: T,
  code: string,
  message: string,
) {
  return new ExceptionType({ code, message, statusCode: statusFor(ExceptionType) });
}

function statusFor(ExceptionType: new (body: object) => Error) {
  if (ExceptionType === BadRequestException) return 400;
  if (ExceptionType === ForbiddenException) return 403;
  if (ExceptionType === NotFoundException) return 404;
  if (ExceptionType === ConflictException) return 409;
  return 503;
}
