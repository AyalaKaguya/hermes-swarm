import "./zod-openapi-setup.js";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import {
  adminContractList,
  assertUniqueAdminContracts,
  type ApiContract,
} from "@hermes-swarm/api-contracts/contracts";
import { ApiErrorSchema } from "@hermes-swarm/api-contracts";
import type { OpenAPIObject } from "@nestjs/swagger";
import type { ZodType } from "zod";

export function mergeAdminContractOpenApi(nestDocument: OpenAPIObject): OpenAPIObject {
  assertUniqueAdminContracts();
  const registry = new OpenAPIRegistry();
  const errorSchema = registry.register("ApiError", ApiErrorSchema);

  for (const contract of adminContractList) {
    registry.registerPath(toRouteConfig(registry, contract, errorSchema));
  }

  const generated = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.0",
    info: {
      title: nestDocument.info.title,
      version: nestDocument.info.version,
      description: nestDocument.info.description,
    },
  });

  return {
    ...nestDocument,
    paths: {
      ...nestDocument.paths,
      ...generated.paths,
    },
    components: {
      ...nestDocument.components,
      ...generated.components,
      schemas: {
        ...nestDocument.components?.schemas,
        ...generated.components?.schemas,
      },
      securitySchemes: {
        ...nestDocument.components?.securitySchemes,
        ...generated.components?.securitySchemes,
      },
    },
  } as unknown as OpenAPIObject;
}

function toRouteConfig(
  registry: OpenAPIRegistry,
  contract: ApiContract,
  errorSchema: ZodType,
): RouteConfig {
  const request: NonNullable<RouteConfig["request"]> = {};
  if (contract.params) request.params = contract.params as never;
  if (contract.query) request.query = contract.query as never;
  if (contract.body) {
    request.body = {
      required: true,
      content: {
        "application/json": {
          schema: registry.register(componentName(contract, "Request"), contract.body),
        },
      },
    };
  } else if (contract.multipart) {
    request.body = {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["file"],
            properties: { file: { type: "string", format: "binary" } },
            additionalProperties: false,
          },
        },
      },
    };
  }

  const responses: RouteConfig["responses"] = {};
  for (const [status, schema] of Object.entries(contract.responses)) {
    if (contract.binary) {
      responses[status] = {
        description: "Binary file",
        content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
      };
    } else if (schema === null) {
      responses[status] = { description: "No content" };
    } else {
      responses[status] = {
        description: "Successful response",
        content: {
          "application/json": {
            schema: registry.register(componentName(contract, `Response${status}`), schema),
          },
        },
      };
    }
  }
  responses["400"] ??= {
    description: "Request validation failed",
    content: { "application/json": { schema: errorSchema } },
  };
  responses["500"] ??= {
    description: "Response contract mismatch",
    content: { "application/json": { schema: errorSchema } },
  };

  return {
    method: contract.method.toLowerCase() as RouteConfig["method"],
    path: `/api/admin${contract.path.replace(/:([^/]+)/g, "{$1}")}`,
    operationId: contract.id.replace(/[^A-Za-z0-9_]/g, "_"),
    request: Object.keys(request).length ? request : undefined,
    responses,
    summary: contract.id,
  };
}

function componentName(contract: ApiContract, suffix: string) {
  return `${contract.id}_${suffix}`.replace(/[^A-Za-z0-9_]/g, "_");
}
