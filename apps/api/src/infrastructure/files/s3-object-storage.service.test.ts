import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectStorageDisabledError } from "./object-storage.js";
import { S3ObjectStorageService } from "./s3-object-storage.service.js";

describe("S3ObjectStorageService", () => {
  it("creates browser-compatible PUT signatures without an empty-body checksum", async () => {
    const storage = new S3ObjectStorageService(storageConfig(true) as never);
    const signed = new URL(
      await storage.presignUpload({
        byteSize: 123,
        expiresInSeconds: 900,
        key: "opaque/object",
        mimeType: "image/png",
      }),
    );

    assert.equal(signed.searchParams.get("X-Amz-SignedHeaders"), "host");
    assert.equal(signed.searchParams.has("x-amz-checksum-crc32"), false);
    assert.equal(signed.searchParams.has("x-amz-sdk-checksum-algorithm"), false);
    assert.equal(signed.pathname, "/private-files/opaque/object");
  });

  it("does not create a client or contact storage while disabled", async () => {
    const storage = new S3ObjectStorageService(storageConfig(false) as never);
    assert.equal(storage.enabled, false);
    await assert.rejects(() => storage.healthCheck(), ObjectStorageDisabledError);
  });
});

function storageConfig(enabled: boolean) {
  const values: Record<string, unknown> = {
    "storage.accessKeyId": "test-access-key",
    "storage.bucket": "private-files",
    "storage.enabled": enabled,
    "storage.endpoint": "https://minio.example.com",
    "storage.forcePathStyle": true,
    "storage.region": "us-east-1",
    "storage.secretAccessKey": "test-secret-key",
  };
  return {
    get(name: string, fallback?: unknown) {
      return values[name] ?? fallback;
    },
    getOrThrow(name: string) {
      if (values[name] === undefined) throw new Error(`Missing ${name}`);
      return values[name];
    },
  };
}
