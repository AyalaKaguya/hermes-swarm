import "reflect-metadata";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { createOpenApiDocument } from "./common/openapi/openapi.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const outputPath =
  process.env.OPENAPI_OUTPUT ??
  path.resolve(workspaceRoot, "docs/api/openapi.admin.json");

async function generateOpenApi() {
  preparePreviewEnvironment();
  const { AppModule } = await import("./app.module.js");
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
    preview: true,
  });
  try {
    app.setGlobalPrefix("api");

    const document = createOpenApiDocument(app);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    console.log(`OpenAPI document written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

function preparePreviewEnvironment() {
  // Preview mode does not instantiate database providers, but AppModule config
  // validation still requires the two isolated runtime identities.
  process.env.POSTGRES_TENANT_URL ??=
    "postgresql://hermes_tenant_app:openapi@localhost:5432/hermes_openapi";
  process.env.POSTGRES_PLATFORM_URL ??=
    "postgresql://hermes_platform:openapi@localhost:5432/hermes_openapi";
}

generateOpenApi().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
