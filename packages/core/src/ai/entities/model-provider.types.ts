export type ModelCapability =
  | "chat"
  | "embedding"
  | "rerank"
  | "speechToText"
  | "textToSpeech";

export type ModelProviderDriver = "openai-compatible";

export type ModelProviderStatus = "disabled" | "enabled";

export type ModelProviderConfig = Record<string, unknown>;

export type ModelDeploymentConfig = Record<string, unknown>;
