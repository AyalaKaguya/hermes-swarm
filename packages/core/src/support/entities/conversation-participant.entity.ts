import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { Account } from "../../identity/entities/account.entity.js";
import type { Conversation } from "./conversation.entity.js";

export type ConversationParticipantRole = "participant";
export type ConversationParticipantJoinedReason =
  | "creator"
  | "manual"
  | "mention"
  | "migration"
  | "reply";

@Entity({ name: "conversation_participants" })
@Index(["workspaceId", "conversationId", "userId"], { unique: true })
@Index(["workspaceId", "userId", "updatedAt"])
export class ConversationParticipant extends WorkspaceOwnedBaseEntity {
  @Column({ name: "conversation_id", type: "uuid" })
  @Index()
  conversationId!: string;

  @ManyToOne("Conversation", { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
  conversation!: Conversation;

  @Column({ name: "user_id", type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne("Account", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "user_id" })
  user!: Account;

  @Column({ type: "varchar", length: 24, default: "participant" })
  role!: ConversationParticipantRole;

  @Column({ name: "joined_reason", type: "varchar", length: 24 })
  joinedReason!: ConversationParticipantJoinedReason;

  @Column({ name: "last_read_at", type: "timestamptz", nullable: true })
  lastReadAt!: Date | null;
}
