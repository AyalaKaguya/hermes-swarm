import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  Account,
  ConversationMessage,
  ConversationMessageFile,
  FileObject,
  type ConversationMessageAttachment,
} from "@hermes-swarm/core";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DataSource, IsNull, Not } from "typeorm";
import { FileObjectService } from "./file-object.service.js";
import { detectImageMimeType } from "./image-file-validation.js";

const LEGACY_UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "avatars");
const LEGACY_URL = /^\/api\/admin\/files\/([^/?#]+)$/;

export type LocalFileMigrationSummary = {
  avatarsMigrated: number;
  messagesMigrated: number;
  missingSources: string[];
  skipped: number;
};

export async function migrateLocalFiles(
  dataSource: DataSource,
  fileObjects: FileObjectService,
): Promise<LocalFileMigrationSummary> {
  const summary: LocalFileMigrationSummary = {
    avatarsMigrated: 0,
    messagesMigrated: 0,
    missingSources: [],
    skipped: 0,
  };
  const accounts = await dataSource.getRepository(Account).find({
    where: { avatarFileObjectId: IsNull(), imageUrl: Not(IsNull()) },
  });
  for (const account of accounts) {
    const source = await readLegacyImage(account.imageUrl);
    if (!source) {
      summary.skipped += 1;
      if (isLegacyUrl(account.imageUrl)) summary.missingSources.push(account.imageUrl!);
      continue;
    }
    const uploaded = await fileObjects.uploadImage(
      { principalType: "workspace", userId: account.id, workspaceId: null },
      source,
      { purpose: "avatar", scope: "account" },
    );
    await dataSource.transaction(async (manager) => {
      const avatar = await fileObjects.claimAvatar(manager, uploaded.fileId, account.id);
      await manager.update(
        Account,
        { avatarFileObjectId: IsNull(), id: account.id },
        {
          avatarFileObjectId: avatar.id,
          avatarUrl: `/api/admin/files/objects/${avatar.id}/content`,
          imageUrl: `/api/admin/files/objects/${avatar.id}/content`,
          updatedAt: new Date(),
        },
      );
    });
    summary.avatarsMigrated += 1;
  }

  const messages = await dataSource.getRepository(ConversationMessage).find({
    where: { attachments: Not(IsNull()) },
  });
  for (const message of messages) {
    if (!message.authorUserId || !message.attachments?.length) {
      summary.skipped += 1;
      continue;
    }
    const existing = await dataSource.getRepository(ConversationMessageFile).count({
      where: { messageId: message.id, workspaceId: message.workspaceId },
    });
    if (existing > 0) {
      await dataSource.getRepository(ConversationMessage).update(
        { id: message.id, workspaceId: message.workspaceId },
        { attachments: null },
      );
      summary.skipped += 1;
      continue;
    }
    const sources = await Promise.all(message.attachments.map(readLegacyAttachment));
    if (sources.some((source) => !source)) {
      summary.skipped += 1;
      summary.missingSources.push(
        ...message.attachments
          .filter((_, index) => !sources[index])
          .map((attachment) => attachment.url),
      );
      continue;
    }
    const uploaded = [] as Array<{ fileId: string }>;
    for (const source of sources) {
      const result = await fileObjects.uploadImage(
        {
          principalType: "workspace",
          userId: message.authorUserId,
          workspaceId: message.workspaceId,
        },
        source!,
        { purpose: "ticket_attachment", scope: "workspace" },
      );
      uploaded.push({ fileId: result.fileId });
    }
    await dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ConversationMessage, {
        lock: { mode: "pessimistic_write" },
        where: { id: message.id, workspaceId: message.workspaceId },
      });
      if (!locked) return;
      const files = await fileObjects.claimTicketFiles(manager, {
        actor: {
          principalType: "workspace",
          userId: message.authorUserId!,
          workspaceId: message.workspaceId,
        },
        allowPlatformFiles: false,
        fileIds: uploaded.map((item) => item.fileId),
        workspaceId: message.workspaceId,
      });
      await manager.save(
        ConversationMessageFile,
        files.map((file, ordinal) =>
          manager.create(ConversationMessageFile, {
            fileObjectId: file.id,
            messageId: message.id,
            ordinal,
            workspaceId: message.workspaceId,
          }),
        ),
      );
      locked.attachments = null;
      await manager.save(ConversationMessage, locked);
    });
    summary.messagesMigrated += 1;
  }
  summary.missingSources = [...new Set(summary.missingSources)];
  return summary;
}

export async function runLocalFileMigration() {
  process.env.RBAC_SYNC_CATALOG_ENABLED ??= "false";
  const { AppModule } = await import("../../app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    const summary = await migrateLocalFiles(
      app.get(DataSource),
      app.get(FileObjectService),
    );
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.missingSources.length > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

async function readLegacyAttachment(attachment: ConversationMessageAttachment) {
  return readLegacyImage(attachment.url);
}

async function readLegacyImage(value: string | null) {
  const match = value?.match(LEGACY_URL);
  if (!match?.[1]) return null;
  const filename = decodeURIComponent(match[1]);
  const resolved = path.resolve(LEGACY_UPLOAD_ROOT, filename);
  const relative = path.relative(LEGACY_UPLOAD_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  try {
    const buffer = await readFile(resolved);
    const mimetype = detectImageMimeType(buffer);
    if (!mimetype) return null;
    return { buffer, mimetype, originalname: filename, size: buffer.length };
  } catch {
    return null;
  }
}

function isLegacyUrl(value: string | null) {
  return Boolean(value?.match(LEGACY_URL));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalFileMigration().catch((error) => {
    process.stderr.write(`Local file migration failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
