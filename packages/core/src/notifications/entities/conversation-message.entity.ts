import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { User } from "../../identity/entities/user.entity.js";
import type { Conversation } from "./conversation.entity.js";

export type ConversationMessageKind = "message" | "system";

export type ConversationMessageAttachment = {
  mimeType?: string;
  name: string;
  size?: number;
  type: "image";
  url: string;
};

@Entity({ name: "conversation_messages" })
@Index(["conversationId", "createdAt"])
export class ConversationMessage extends BaseEntity {
  @Column({ name: "conversation_id", type: "uuid" })
  @Index()
  conversationId!: string;

  @ManyToOne("Conversation", { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
  conversation!: Conversation;

  @Column({ name: "author_user_id", type: "uuid", nullable: true })
  @Index()
  authorUserId!: string | null;

  @ManyToOne("User", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "author_user_id" })
  authorUser!: User | null;

  @Column({ type: "varchar", length: 24, default: "message" })
  kind!: ConversationMessageKind;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "jsonb", nullable: true })
  attachments!: ConversationMessageAttachment[] | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;
}
