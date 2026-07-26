import { HttpException, HttpStatus } from "@nestjs/common";
import type { AnalyticsErrorCode } from "@hermes-swarm/api-contracts/analytics";

export class AnalyticsQueryError extends HttpException {
  readonly code: AnalyticsErrorCode;

  constructor(code: AnalyticsErrorCode, message: string) {
    const statusCode = statusForAnalyticsError(code);
    super({ code, message, statusCode }, statusCode);
    this.code = code;
    this.name = "AnalyticsQueryError";
  }
}

function statusForAnalyticsError(code: AnalyticsErrorCode): HttpStatus {
  switch (code) {
    case "ANALYTICS_SOURCE_NOT_FOUND":
      return HttpStatus.NOT_FOUND;
    case "ANALYTICS_SOURCE_FORBIDDEN":
      return HttpStatus.FORBIDDEN;
    case "ANALYTICS_QUERY_TIMEOUT":
      return HttpStatus.GATEWAY_TIMEOUT;
    case "ANALYTICS_RESULT_TOO_LARGE":
      return HttpStatus.PAYLOAD_TOO_LARGE;
    case "ANALYTICS_ADAPTER_UNAVAILABLE":
      return HttpStatus.SERVICE_UNAVAILABLE;
    case "ANALYTICS_CONTEXT_REQUIRED":
      return HttpStatus.INTERNAL_SERVER_ERROR;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}
