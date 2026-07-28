import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module.js";

const logger = new Logger("WorkerBootstrap");

export async function bootstrapWorker() {
  const application = await NestFactory.createApplicationContext(WorkerModule, {
    abortOnError: false,
  });
  application.enableShutdownHooks(["SIGINT", "SIGTERM"]);
  return application;
}

void bootstrapWorker().catch(() => {
  process.exitCode = 1;
  logger.error("Worker failed to start.");
});
