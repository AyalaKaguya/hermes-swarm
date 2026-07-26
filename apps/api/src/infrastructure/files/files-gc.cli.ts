import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { pathToFileURL } from "node:url";
import { AnalysisQueryArtifactGcService } from "../../domains/analytics/analysis-query-artifact-gc.service.js";
import { FileObjectService } from "./file-object.service.js";

export async function runFileGarbageCollection() {
  process.env.RBAC_SYNC_CATALOG_ENABLED ??= "false";
  const { AppModule } = await import("../../app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    const limit = parseLimit(process.env.FILES_GC_BATCH_SIZE);
    const analytics = await app
      .get(AnalysisQueryArtifactGcService)
      .collectExpired(limit);
    const summary = await app.get(FileObjectService).collectGarbage(limit);
    const output = { ...summary, analytics };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

function parseLimit(value: string | undefined) {
  if (!value?.trim()) return 100;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new Error("FILES_GC_BATCH_SIZE must be an integer between 1 and 1000");
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFileGarbageCollection().catch((error) => {
    process.stderr.write(`File garbage collection failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
