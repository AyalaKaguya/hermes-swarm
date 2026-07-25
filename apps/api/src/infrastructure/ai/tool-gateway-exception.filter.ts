import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import {
  ToolGatewayErrorSchema,
  type ToolGatewayError,
} from "@hermes-swarm/api-contracts/ai";

const FALLBACK_CODE_BY_STATUS = Object.freeze({
  [HttpStatus.BAD_REQUEST]: "AI_TOOL_INVALID_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "AI_TOOL_AUTHENTICATION_REQUIRED",
  [HttpStatus.FORBIDDEN]: "AI_TOOL_AUTHORIZATION_DENIED",
  [HttpStatus.NOT_FOUND]: "AI_TOOL_NOT_FOUND",
  [HttpStatus.CONFLICT]: "AI_TOOL_CONFLICT",
  [HttpStatus.TOO_MANY_REQUESTS]: "AI_TOOL_RATE_LIMITED",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "AI_TOOL_INTERNAL_ERROR",
} as const);

type ToolGatewayStatus = keyof typeof FALLBACK_CODE_BY_STATUS;

@Catch()
export class ToolGatewayExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const statusCode = toolGatewayStatus(exception);
    const detail = exception instanceof HttpException
      ? exception.getResponse()
      : undefined;
    const message = publicMessage(detail, statusCode);
    const explicitCode = errorCode(detail);
    const candidate = ToolGatewayErrorSchema.safeParse({
      code: explicitCode,
      message,
      statusCode,
    });
    const body: ToolGatewayError = candidate.success
      ? candidate.data
      : ToolGatewayErrorSchema.parse({
          code: FALLBACK_CODE_BY_STATUS[statusCode],
          message,
          statusCode,
        });
    return response.status(statusCode).json(body);
  }
}

function toolGatewayStatus(exception: unknown): ToolGatewayStatus {
  const status = exception instanceof HttpException
    ? exception.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
  return Object.prototype.hasOwnProperty.call(FALLBACK_CODE_BY_STATUS, status)
    ? status as ToolGatewayStatus
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

function errorCode(detail: unknown) {
  if (typeof detail !== "object" || detail === null || !("code" in detail)) {
    return undefined;
  }
  return typeof detail.code === "string" ? detail.code : undefined;
}

function publicMessage(detail: unknown, statusCode: ToolGatewayStatus) {
  if (statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
    return "Tool Gateway request failed";
  }
  const raw = typeof detail === "string"
    ? detail
    : typeof detail === "object" && detail !== null && "message" in detail
      ? detail.message
      : undefined;
  const message = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string").join(", ")
    : typeof raw === "string"
      ? raw
      : "Tool Gateway request failed";
  return message.trim().slice(0, 2_000) || "Tool Gateway request failed";
}
