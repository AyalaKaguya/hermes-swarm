import { SetMetadata } from "@nestjs/common";
export const CONVERSATION_RESOURCE_METADATA = Symbol("conversation:resource");

export type ConversationResourceMetadata = {
  sourceIdParam?: string;
  sourceType: string;
};

export function ConversationResource(metadata: ConversationResourceMetadata) {
  return SetMetadata(CONVERSATION_RESOURCE_METADATA, metadata);
}
