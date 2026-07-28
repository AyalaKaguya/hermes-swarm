import type { ModelCapability } from "@hermes-swarm/api-contracts/ai";

export type ModelProviderDriverDescriptor = Readonly<{
  capabilities: readonly ModelCapability[];
  displayName: string;
  driver: string;
}>;

export type ModelProviderEndpointPolicy = Readonly<{
  allowedHosts: readonly string[];
  requireHttps: boolean;
}>;

/**
 * A provider driver validates persistent configuration only. Remote model
 * calls belong to the Worker runtime and are intentionally absent here.
 */
export interface ModelProviderDriver<Configuration = unknown> {
  readonly descriptor: ModelProviderDriverDescriptor;
  normalizeConfiguration(input: unknown): Configuration;
}

export class ModelProviderDriverRegistryError extends Error {
  constructor(
    readonly code:
      | "AI_PROVIDER_DRIVER_DUPLICATE"
      | "AI_PROVIDER_DRIVER_INVALID"
      | "AI_PROVIDER_DRIVER_UNKNOWN",
    message: string,
  ) {
    super(message);
    this.name = "ModelProviderDriverRegistryError";
  }
}

export class ModelProviderConfigurationError extends Error {
  readonly code = "AI_PROVIDER_CONFIGURATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ModelProviderConfigurationError";
  }
}
