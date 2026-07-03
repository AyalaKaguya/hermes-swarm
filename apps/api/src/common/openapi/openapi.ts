import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export const OPENAPI_DOCS_PATH = "api/docs";
export const OPENAPI_JSON_PATH = "api/openapi.json";

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("Hermes Swarm Admin API")
    .setDescription("Administration API for Hermes Swarm.")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();

  return SwaggerModule.createDocument(app, config);
}

export function setupOpenApi(app: INestApplication) {
  const document = createOpenApiDocument(app);
  SwaggerModule.setup(OPENAPI_DOCS_PATH, app, document, {
    jsonDocumentUrl: `/${OPENAPI_JSON_PATH}`,
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
  return document;
}
