import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigService } from "@nestjs/config";
import {
  AnalyticsArtifactStorageDisabledError,
  S3AnalyticsArtifactStorage,
} from "./analytics-artifact-storage.js";

describe("S3AnalyticsArtifactStorage", () => {
  it("does not create a client and fails explicitly when storage is disabled", async () => {
    const service = new S3AnalyticsArtifactStorage(
      new ConfigService({
        worker: {
          objectStorage: {
            accessKeyId: "",
            bucket: "",
            downloadUrlTtlSeconds: 300,
            enabled: false,
            endpoint: "",
            forcePathStyle: true,
            pendingTtlSeconds: 86_400,
            region: "us-east-1",
            secretAccessKey: "",
          },
        },
      }),
    );

    assert.equal(service.enabled, false);
    await assert.rejects(
      () =>
        service.put({
          body: Buffer.from("{}"),
          key: "result.json",
          mimeType: "application/json",
          signal: new AbortController().signal,
        }),
      AnalyticsArtifactStorageDisabledError,
    );
  });
});
