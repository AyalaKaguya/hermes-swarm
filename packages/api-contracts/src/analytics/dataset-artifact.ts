import { z } from "zod";
import {
  DatasetResultFieldSchema,
  DatasetResultLineageSchema,
  DatasetResultRowSchema,
} from "./result.js";
import type { DatasetScalarType } from "./primitives.js";

export const DATASET_ARTIFACT_SCHEMA_VERSION =
  "hermes.analytics.dataset-artifact/v1" as const;
export const DATASET_ARTIFACT_MAX_PREVIEW_ROWS = 100;
export const DATASET_ARTIFACT_MAX_PREVIEW_BYTES = 256 * 1024;

export const DatasetArtifactStatusSchema = z.enum([
  "expired",
  "failed",
  "pending",
  "ready",
]);
export type DatasetArtifactStatus = z.infer<
  typeof DatasetArtifactStatusSchema
>;

const artifactDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const artifactDateTimeSchema = z.iso.datetime({ offset: true });
const artifactFailureCodeSchema = z.string().trim().min(1).max(128);
const artifactResultSchema = z.array(DatasetResultFieldSchema).min(1);
const artifactPreviewSchema = z
  .array(DatasetResultRowSchema)
  .max(DATASET_ARTIFACT_MAX_PREVIEW_ROWS);

const datasetArtifactBaseSchema = z.strictObject({
  byteSize: z.number().int().nonnegative().nullable(),
  createdAt: artifactDateTimeSchema,
  downloadAvailable: z.boolean(),
  expiresAt: artifactDateTimeSchema,
  failedAt: artifactDateTimeSchema.nullable(),
  failureCode: artifactFailureCodeSchema.nullable(),
  id: z.uuid(),
  lineage: DatasetResultLineageSchema.nullable(),
  preview: artifactPreviewSchema.nullable(),
  queryRunId: z.uuid(),
  readyAt: artifactDateTimeSchema.nullable(),
  resultSchema: artifactResultSchema.nullable(),
  rowCount: z.number().int().nonnegative().nullable(),
  schemaVersion: z.literal(DATASET_ARTIFACT_SCHEMA_VERSION),
  sha256: artifactDigestSchema.nullable(),
  status: DatasetArtifactStatusSchema,
  updatedAt: artifactDateTimeSchema,
});

type ArtifactContract = z.infer<typeof datasetArtifactBaseSchema>;

export const DatasetArtifactSchema = datasetArtifactBaseSchema
  .superRefine((artifact, context) => {
    validateArtifactLifecycle(artifact, context);
    validateArtifactPreview(artifact, context);
    validateArtifactTimes(artifact, context);
  });
export type DatasetArtifact = z.infer<typeof DatasetArtifactSchema>;

export const DatasetArtifactParamsSchema = z.strictObject({
  artifactId: z.uuid(),
});
export type DatasetArtifactParams = z.infer<
  typeof DatasetArtifactParamsSchema
>;

function validateArtifactLifecycle(
  artifact: ArtifactContract,
  context: z.RefinementCtx,
) {
  const completeMetadata = [
    artifact.byteSize,
    artifact.lineage,
    artifact.preview,
    artifact.resultSchema,
    artifact.rowCount,
    artifact.sha256,
  ].every((value) => value !== null);

  if (artifact.status === "ready") {
    if (!completeMetadata) {
      context.addIssue({
        code: "custom",
        message: "ready artifacts must include complete result metadata",
        path: [],
      });
    }
    if (artifact.readyAt === null) {
      context.addIssue({
        code: "custom",
        message: "ready artifacts must include readyAt",
        path: ["readyAt"],
      });
    }
    if (!artifact.downloadAvailable) {
      context.addIssue({
        code: "custom",
        message: "ready artifacts must be available for download",
        path: ["downloadAvailable"],
      });
    }
    if (artifact.failedAt !== null || artifact.failureCode !== null) {
      context.addIssue({
        code: "custom",
        message: "ready artifacts cannot include failure state",
        path: ["failureCode"],
      });
    }
    return;
  }

  if (artifact.downloadAvailable) {
    context.addIssue({
      code: "custom",
      message: "only ready artifacts are available for download",
      path: ["downloadAvailable"],
    });
  }
  if (artifact.readyAt !== null) {
    if (artifact.status !== "expired") {
      context.addIssue({
        code: "custom",
        message: "non-ready artifacts cannot include readyAt",
        path: ["readyAt"],
      });
    }
  }

  if (artifact.status === "failed") {
    if (artifact.failedAt === null || artifact.failureCode === null) {
      context.addIssue({
        code: "custom",
        message: "failed artifacts must include failure details",
        path: ["failureCode"],
      });
    }
  } else if (artifact.failedAt !== null || artifact.failureCode !== null) {
    context.addIssue({
      code: "custom",
      message: "non-failed artifacts cannot include failure state",
      path: ["failureCode"],
    });
  }

  if (artifact.status === "expired" && artifact.preview !== null) {
    context.addIssue({
      code: "custom",
      message: "expired artifacts cannot expose result preview payloads",
      path: ["preview"],
    });
  }
  if (
    artifact.status === "expired" &&
    (artifact.readyAt === null ||
      [
        artifact.byteSize,
        artifact.lineage,
        artifact.resultSchema,
        artifact.rowCount,
        artifact.sha256,
      ].some((value) => value === null))
  ) {
    context.addIssue({
      code: "custom",
      message: "expired artifacts must retain non-payload audit metadata",
      path: [],
    });
  }
}

function validateArtifactPreview(
  artifact: ArtifactContract,
  context: z.RefinementCtx,
) {
  if (artifact.preview === null) return;

  const previewBytes = new TextEncoder().encode(
    JSON.stringify(artifact.preview),
  ).byteLength;
  if (previewBytes > DATASET_ARTIFACT_MAX_PREVIEW_BYTES) {
    context.addIssue({
      code: "custom",
      message: "artifact preview exceeds the byte budget",
      path: ["preview"],
    });
  }
  if (
    artifact.rowCount !== null &&
    artifact.preview.length > artifact.rowCount
  ) {
    context.addIssue({
      code: "custom",
      message: "artifact preview cannot contain more rows than the result",
      path: ["preview"],
    });
  }
  if (artifact.resultSchema === null) return;

  const fields = new Map(
    artifact.resultSchema.map((field) => [field.key, field]),
  );
  if (fields.size !== artifact.resultSchema.length) {
    context.addIssue({
      code: "custom",
      message: "artifact result schema field keys must be unique",
      path: ["resultSchema"],
    });
  }

  artifact.preview.forEach((row, rowIndex) => {
    for (const key of Object.keys(row)) {
      if (!fields.has(key)) {
        context.addIssue({
          code: "custom",
          message: `preview row contains unknown field ${key}`,
          path: ["preview", rowIndex, key],
        });
      }
    }
    for (const [key, field] of fields) {
      if (!(key in row)) {
        context.addIssue({
          code: "custom",
          message: `preview row is missing field ${key}`,
          path: ["preview", rowIndex, key],
        });
        continue;
      }
      const value = row[key];
      if (value === null && !field.nullable) {
        context.addIssue({
          code: "custom",
          message: `field ${key} is not nullable`,
          path: ["preview", rowIndex, key],
        });
      } else if (!valueMatchesScalarType(value, field.scalarType)) {
        context.addIssue({
          code: "custom",
          message: `field ${key} does not match ${field.scalarType}`,
          path: ["preview", rowIndex, key],
        });
      }
    }
  });
}

function validateArtifactTimes(
  artifact: ArtifactContract,
  context: z.RefinementCtx,
) {
  const createdAt = Date.parse(artifact.createdAt);
  const updatedAt = Date.parse(artifact.updatedAt);
  const expiresAt = Date.parse(artifact.expiresAt);
  if (updatedAt < createdAt) {
    context.addIssue({
      code: "custom",
      message: "updatedAt cannot precede createdAt",
      path: ["updatedAt"],
    });
  }
  if (expiresAt <= createdAt) {
    context.addIssue({
      code: "custom",
      message: "expiresAt must follow createdAt",
      path: ["expiresAt"],
    });
  }
  for (const field of ["readyAt", "failedAt"] as const) {
    const value = artifact[field];
    if (value !== null && Date.parse(value) < createdAt) {
      context.addIssue({
        code: "custom",
        message: `${field} cannot precede createdAt`,
        path: [field],
      });
    }
  }
}

function valueMatchesScalarType(value: unknown, scalarType: DatasetScalarType) {
  if (value === null) return true;
  switch (scalarType) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && z.iso.date().safeParse(value).success;
    case "datetime":
      return (
        typeof value === "string" &&
        z.iso.datetime({ offset: true }).safeParse(value).success
      );
    case "string":
    case "enum":
      return typeof value === "string";
  }
}
