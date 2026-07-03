import "reflect-metadata";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { createOpenApiDocument } from "./common/openapi/openapi.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const outputPath =
  process.env.OPENAPI_OUTPUT ??
  path.resolve(workspaceRoot, "docs/api/openapi.admin.json");

async function generateOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix("api");
    await app.init();

    const document = createOpenApiDocument(app);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    console.log(`OpenAPI document written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

generateOpenApi().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
