import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { setupOpenApi } from "./common/openapi/openapi.js";

async function bootstrap() {
  const { AppModule } = await import("./app.module.js");
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.enableCors({
    origin: configService.getOrThrow<boolean | string[]>("app.corsOrigin"),
    credentials: true,
  });
  app.setGlobalPrefix("api");
  setupOpenApi(app);
  const port = configService.getOrThrow<number>("app.port");
  await app.listen(port);
  console.log(`🚀 API running on http://localhost:${port}/api`);
  console.log(`API docs running on http://localhost:${port}/api/docs`);
}

bootstrap();
