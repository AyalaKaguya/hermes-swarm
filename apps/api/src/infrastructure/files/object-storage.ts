import type { Readable } from "node:stream";

export type StoredObjectHead = {
  byteSize: number;
  etag: string | null;
  mimeType: string | null;
};

export type StoredObjectWrite = {
  body: Buffer | Readable;
  byteSize?: number;
  key: string;
  mimeType: string;
};

export class ObjectStorageDisabledError extends Error {
  constructor() {
    super("Object storage is disabled");
    this.name = "ObjectStorageDisabledError";
  }
}

export class ObjectStorageNotFoundError extends Error {
  constructor() {
    super("Stored object does not exist");
    this.name = "ObjectStorageNotFoundError";
  }
}

export class ObjectStorageUnavailableError extends Error {
  constructor(public readonly operation: string, options?: { cause?: unknown }) {
    super(`Object storage operation failed: ${operation}`, options);
    this.name = "ObjectStorageUnavailableError";
  }
}

export abstract class ObjectStorage {
  abstract readonly bucket: string;
  abstract readonly enabled: boolean;

  abstract deleteObject(key: string): Promise<void>;
  abstract getObjectStream(key: string): Promise<Readable>;
  abstract headObject(key: string): Promise<StoredObjectHead>;
  abstract healthCheck(): Promise<void>;
  abstract presignDownload(input: {
    expiresInSeconds: number;
    key: string;
    originalName: string;
  }): Promise<string>;
  abstract presignUpload(input: {
    byteSize: number;
    expiresInSeconds: number;
    key: string;
    mimeType: string;
  }): Promise<string>;
  abstract putObject(input: StoredObjectWrite): Promise<{ etag: string | null }>;
}
