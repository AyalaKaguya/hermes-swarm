import type {
  Conversation,
  ConversationMessage,
  ConversationMessageAttachment,
} from "@hermes-swarm/core";

export type ConversationSource = {
  sourceId: string;
  sourceType: string;
  status?: "archived" | "closed" | "open";
  subject: string;
  workspaceId: string;
};

export type ConversationNotificationPayload = {
  body: string | null;
  title: string;
};

export type ConversationMessageInput = {
  attachments?: ConversationMessageAttachment[] | null;
  body: string;
  metadata?: Record<string, unknown> | null;
};

export type ConversationAccessResolver = {
  buildNotificationPayload?: (input: {
    conversation: Conversation;
    kind: "mention" | "message";
    message: ConversationMessage;
    source: ConversationSource;
  }) => ConversationNotificationPayload;
  canRead: (userId: string, source: ConversationSource) => Promise<boolean>;
  canWrite: (userId: string, source: ConversationSource) => Promise<boolean>;
  resolveMentionCandidates?: (
    mentionKeys: string[],
    source: ConversationSource,
    authorUserId: string,
  ) => Promise<string[]>;
};
