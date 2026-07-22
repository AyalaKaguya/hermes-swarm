import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  SetMetadata,
  createParamDecorator,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  findAdminContract,
  responseSchemaFor,
  type ApiContract,
} from "@hermes-swarm/api-contracts/contracts";
import { map, type Observable } from "rxjs";
import type { ZodError, ZodType } from "zod";

const RESPONSE_CONTRACT_METADATA = Symbol("admin-response-contract");

export const ContractResponse = (contract: ApiContract) =>
  SetMetadata(RESPONSE_CONTRACT_METADATA, contract);

export const ContractBody = createContractParameter("body");
export const ContractQuery = createContractParameter("query");
export const ContractParams = createContractParameter("params");

@Injectable()
export class AdminContractInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminContractInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<ContractRequest>();
    const response = http.getResponse<{ statusCode?: number }>();
    const explicit = this.reflector.getAllAndOverride<ApiContract | undefined>(
      RESPONSE_CONTRACT_METADATA,
      [context.getHandler(), context.getClass()],
    );
    const match = explicit
      ? { contract: explicit, params: request.params ?? {} }
      : findAdminContract(request.method, request.originalUrl ?? request.url);

    if (!match) return next.handle();
    const { contract, params } = match;
    if (!contract.multipart) {
      request.params = parseRequestPart(contract, "params", params);
      defineValidatedQuery(
        request,
        parseRequestPart(contract, "query", request.query ?? {}),
      );
      if (contract.body) request.body = parseSchema(contract.body, request.body, contract, "body");
    } else if (contract.params) {
      request.params = parseSchema(contract.params, params, contract, "params");
    }

    return next.handle().pipe(
      map((value) => {
        if (contract.binary) return value;
        const status = response.statusCode ?? 200;
        const schema = responseSchemaFor(contract, status);
        if (schema === undefined) return value;
        if (schema === null) {
          if (value !== undefined && value !== null) this.throwResponseMismatch(contract, status, ["response"]);
          return value;
        }
        const result = schema.safeParse(toWireValue(value));
        if (!result.success) {
          this.throwResponseMismatch(
            contract,
            status,
            result.error.issues.map((issue) => issue.path.join(".") || "response"),
          );
        }
        return result.data;
      }),
    );
  }

  private throwResponseMismatch(contract: ApiContract, status: number, paths: string[]): never {
    this.logger.error(JSON.stringify({
      code: "RESPONSE_CONTRACT_MISMATCH",
      contract: contract.id,
      method: contract.method,
      path: contract.path,
      issues: [...new Set(paths)].slice(0, 20),
      status,
    }));
    throw new InternalServerErrorException({
      code: "RESPONSE_CONTRACT_MISMATCH",
      message: "API response did not match its public contract",
    });
  }
}

function defineValidatedQuery(request: ContractRequest, query: unknown) {
  Object.defineProperty(request, "query", {
    configurable: true,
    enumerable: true,
    value: query,
    writable: true,
  });
}

function createContractParameter(part: "body" | "query" | "params") {
  return createParamDecorator((contract: ApiContract, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<ContractRequest>();
    const source = request[part] ?? {};
    return parseRequestPart(contract, part, source);
  });
}

function parseRequestPart(
  contract: ApiContract,
  part: "body" | "query" | "params",
  value: unknown,
) {
  const schema = contract[part];
  return schema ? parseSchema(schema, value, contract, part) : value;
}

function parseSchema(schema: ZodType, value: unknown, contract: ApiContract, source: string) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw validationError(contract, source, result.error);
}

function validationError(contract: ApiContract, source: string, error: ZodError) {
  return new BadRequestException({
    code: "VALIDATION_ERROR",
    message: "Request validation failed",
    issues: error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: [source, ...issue.path].join("."),
    })),
    contract: contract.id,
  });
}

function toWireValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toWireValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toWireValue(item)]),
  );
}

type ContractRequest = {
  body?: unknown;
  method: string;
  originalUrl?: string;
  params?: unknown;
  query?: unknown;
  url: string;
};
