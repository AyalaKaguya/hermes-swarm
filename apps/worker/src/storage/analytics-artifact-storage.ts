import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { WorkerRuntimeConfig } from "../config/worker-runtime.config.js";

export const ANALYTICS_ARTIFACT_STORAGE = Symbol(
  "ANALYTICS_ARTIFACT_STORAGE",
);

export type AnalyticsArtifactWrite = Readonly<{
  body: Buffer;
  key: string;
  mimeType: "application/json";
  signal: AbortSignal;
}>;

export interface AnalyticsArtifactStorage {
  readonly bucket: string;
  readonly enabled: boolean;
  put(input: AnalyticsArtifactWrite): Promise<{ etag: string | null }>;
}

export class AnalyticsArtifactStorageDisabledError extends Error {
  readonly code = "ANALYTICS_ARTIFACT_UNAVAILABLE";
  readonly retryable = false;

  constructor() {
    super("Object storage is disabled for analytics artifacts.");
    this.name = "AnalyticsArtifactStorageDisabledError";
  }
}

export class AnalyticsArtifactStorageUnavailableError extends Error {
  readonly code = "ANALYTICS_ARTIFACT_UNAVAILABLE";
  readonly retryable = true;

  constructor(options?: { cause?: unknown }) {
    super("Object storage is temporarily unavailable for analytics artifacts.", options);
    this.name = "AnalyticsArtifactStorageUnavailableError";
  }
}

@Injectable()
export class S3AnalyticsArtifactStorage implements AnalyticsArtifactStorage {
  readonly bucket: string;
  readonly enabled: boolean;
  private readonly client: S3Client | null;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    const storage = configService.getOrThrow<WorkerRuntimeConfig>("worker")
      .objectStorage;
    this.bucket = storage.bucket;
    this.enabled = storage.enabled;
    this.client = storage.enabled
      ? new S3Client({
          credentials: {
            accessKeyId: storage.accessKeyId,
            secretAccessKey: storage.secretAccessKey,
          },
          endpoint: storage.endpoint,
          forcePathStyle: storage.forcePathStyle,
          maxAttempts: 3,
          region: storage.region,
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
        })
      : null;
  }

  async put(input: AnalyticsArtifactWrite) {
    if (!this.client) throw new AnalyticsArtifactStorageDisabledError();
    try {
      const result = await this.client.send(
        new PutObjectCommand({
          Body: input.body,
          Bucket: this.bucket,
          ContentLength: input.body.byteLength,
          ContentType: input.mimeType,
          Key: input.key,
        }),
        { abortSignal: input.signal },
      );
      return { etag: result.ETag?.replace(/^"|"$/g, "") || null };
    } catch (error) {
      if (error instanceof AnalyticsArtifactStorageDisabledError) throw error;
      throw new AnalyticsArtifactStorageUnavailableError({ cause: error });
    }
  }
}
