import * as dotenv from "dotenv";
import * as path from "node:path";

// Load root .env before any other imports
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  const port = process.env.API_PORT ?? 3100;
  await app.listen(port);
  console.log(`🚀 API running on http://localhost:${port}/api`);
}

bootstrap();
