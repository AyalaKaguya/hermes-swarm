export type ToolSecurityPolicyErrorCode =
  | "TOOL_ENDPOINT_COMPONENT_FORBIDDEN"
  | "TOOL_ENDPOINT_HOST_FORBIDDEN"
  | "TOOL_ENDPOINT_INVALID"
  | "TOOL_ENDPOINT_NOT_APPROVED"
  | "TOOL_ENDPOINT_SCHEME_FORBIDDEN"
  | "TOOL_HEADER_FORBIDDEN"
  | "TOOL_HEADER_INVALID"
  | "TOOL_NETWORK_ADDRESS_FORBIDDEN"
  | "TOOL_NETWORK_ADDRESS_INVALID";

export class ToolSecurityPolicyError extends Error {
  constructor(
    readonly code: ToolSecurityPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolSecurityPolicyError";
  }
}
