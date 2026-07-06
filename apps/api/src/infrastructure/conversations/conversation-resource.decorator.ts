import { SetMetadata } from "@nestjs/common";
import type { ConversationScope } from "@hermes-swarm/core";

export const CONVERSATION_RESOURCE_METADATA = Symbol("conversation:resource");

export type ConversationResourceMetadata = {
  organizationParam?: string;
  scope: ConversationScope;
  sourceIdParam?: string;
  sourceType: string;
};

export function ConversationResource(metadata: ConversationResourceMetadata) {
  return SetMetadata(CONVERSATION_RESOURCE_METADATA, metadata);
}
