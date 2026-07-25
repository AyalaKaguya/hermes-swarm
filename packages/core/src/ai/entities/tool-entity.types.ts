export type ToolCatalogStatus = "disabled" | "enabled";

export type ToolDefinitionVersionStatus = "disabled" | "draft" | "published";

export type ToolDefinitionSchemaVersion = "hermes.tool-definition/v1";

export type ToolDriverType = "http" | "internal" | "mcpStreamableHttp";

export type ExternalToolDriverType = Exclude<ToolDriverType, "internal">;

export type ToolSideEffect = "irreversible" | "none" | "reversible";

export type ToolIdempotency = "notRequired" | "required" | "unsupported";

export type ToolNetworkScheme = "http" | "https";

export type ToolConnectionAuthType = "bearer" | "header" | "none";

export type ToolJsonObject = Record<string, unknown>;

export type ToolRetryPolicy = {
  backoffMs: number;
  maxAttempts: number;
  strategy: "exponential" | "fixed";
};
