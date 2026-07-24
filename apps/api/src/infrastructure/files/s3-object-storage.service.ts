import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import {
  ObjectStorage,
  ObjectStorageDisabledError,
  ObjectStorageNotFoundError,
  ObjectStorageUnavailableError,
  type StoredObjectWrite,
} from "./object-storage.js";

const STORAGE_OPERATION_TIMEOUT_MS = 30_000;

@Injectable()
export class S3ObjectStorageService extends ObjectStorage {
  readonly bucket: string;
  readonly enabled: boolean;
  private readonly client: S3Client | null;

  constructor(config: ConfigService) {
    super();
    this.enabled = config.get<boolean>("storage.enabled", false);
    this.bucket = config.get<string>("storage.bucket", "");
    this.client = this.enabled
      ? new S3Client({
          credentials: {
            accessKeyId: config.getOrThrow<string>("storage.accessKeyId"),
            secretAccessKey: config.getOrThrow<string>("storage.secretAccessKey"),
          },
          endpoint: config.getOrThrow<string>("storage.endpoint"),
          forcePathStyle: config.get<boolean>("storage.forcePathStyle", true),
          maxAttempts: 3,
          region: config.get<string>("storage.region", "us-east-1"),
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
        })
      : null;
  }

  async putObject(input: StoredObjectWrite) {
    const client = this.requireClient();
    try {
      const upload = new Upload({
        client,
        leavePartsOnError: false,
        params: {
          Body: input.body,
          Bucket: this.bucket,
          ContentLength: input.byteSize,
          ContentType: input.mimeType,
          Key: input.key,
        },
        queueSize: 2,
      });
      const result = await withTimeout(upload.done(), "put", () => {
        void upload.abort().catch(() => undefined);
      });
      return { etag: normalizeEtag(result.ETag) };
    } catch (error) {
      throw normalizeStorageError(error, "put");
    }
  }

  async getObjectStream(key: string) {
    const client = this.requireClient();
    try {
      const result = await withTimeout(
        client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
        "get",
      );
      const body = result.Body as Readable | undefined;
      if (!body || typeof body[Symbol.asyncIterator] !== "function") {
        throw new ObjectStorageUnavailableError("get_body");
      }
      return body;
    } catch (error) {
      throw normalizeStorageError(error, "get");
    }
  }

  async headObject(key: string) {
    const client = this.requireClient();
    try {
      const result = await withTimeout(
        client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })),
        "head",
      );
      if (!Number.isSafeInteger(result.ContentLength) || result.ContentLength! < 0) {
        throw new ObjectStorageUnavailableError("head_metadata");
      }
      return {
        byteSize: result.ContentLength!,
        etag: normalizeEtag(result.ETag),
        mimeType: result.ContentType?.trim().toLowerCase() || null,
      };
    } catch (error) {
      throw normalizeStorageError(error, "head");
    }
  }

  async deleteObject(key: string) {
    const client = this.requireClient();
    try {
      await withTimeout(
        client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
        "delete",
      );
    } catch (error) {
      throw normalizeStorageError(error, "delete");
    }
  }

  async presignUpload(input: {
    byteSize: number;
    expiresInSeconds: number;
    key: string;
    mimeType: string;
  }) {
    const client = this.requireClient();
    try {
      return await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: this.bucket,
          ContentType: input.mimeType,
          Key: input.key,
        }),
        { expiresIn: input.expiresInSeconds },
      );
    } catch (error) {
      throw normalizeStorageError(error, "presign_upload");
    }
  }

  async presignDownload(input: {
    expiresInSeconds: number;
    key: string;
    originalName: string;
  }) {
    const client = this.requireClient();
    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          ResponseContentDisposition: contentDisposition(input.originalName),
        }),
        { expiresIn: input.expiresInSeconds },
      );
    } catch (error) {
      throw normalizeStorageError(error, "presign_download");
    }
  }

  async healthCheck() {
    const client = this.requireClient();
    try {
      await withTimeout(
        client.send(new HeadBucketCommand({ Bucket: this.bucket })),
        "health",
      );
    } catch (error) {
      throw normalizeStorageError(error, "health");
    }
  }

  private requireClient() {
    if (!this.client) throw new ObjectStorageDisabledError();
    return this.client;
  }
}

function normalizeStorageError(error: unknown, operation: string) {
  if (
    error instanceof ObjectStorageDisabledError ||
    error instanceof ObjectStorageNotFoundError ||
    error instanceof ObjectStorageUnavailableError
  ) {
    return error;
  }
  const typed = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  const objectLookup = operation === "get" || operation === "head";
  if (
    objectLookup &&
    typed.name !== "NoSuchBucket" &&
    (typed.$metadata?.httpStatusCode === 404 ||
      typed.name === "NoSuchKey" ||
      typed.name === "NotFound")
  ) {
    return new ObjectStorageNotFoundError();
  }
  return new ObjectStorageUnavailableError(operation, { cause: error });
}

async function withTimeout<T>(
  work: Promise<T>,
  operation: string,
  onTimeout?: () => void,
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          reject(new ObjectStorageUnavailableError(`${operation}_timeout`));
        }, STORAGE_OPERATION_TIMEOUT_MS);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeEtag(value: string | undefined) {
  return value?.replace(/^"|"$/g, "") || null;
}

function contentDisposition(filename: string) {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "download";
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
