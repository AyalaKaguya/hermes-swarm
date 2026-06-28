import * as dotenv from "dotenv";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";

// Load root .env before any other imports
const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../../../.env") });

async function bootstrap() {
  const { AppModule } = await import("./app.module.js");
  const app = await NestFactory.create(AppModule);
  const corsOrigin =
    process.env.CORS_ORIGIN?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? true;

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
  app.setGlobalPrefix("api");
  const port = process.env.API_PORT ?? 3200;
  await app.listen(port);
  console.log(`🚀 API running on http://localhost:${port}/api`);
}

bootstrap();
