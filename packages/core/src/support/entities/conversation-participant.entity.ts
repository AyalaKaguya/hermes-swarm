import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { TenantOwnedBaseEntity } from "../../identity/entities/tenant-owned-base.entity.js";
import type { User } from "../../identity/entities/user.entity.js";
import type { Conversation } from "./conversation.entity.js";

export type ConversationParticipantRole = "participant";
export type ConversationParticipantJoinedReason =
  | "creator"
  | "manual"
  | "mention"
  | "migration"
  | "reply";

@Entity({ name: "conversation_participants" })
@Index(["tenantId", "conversationId", "userId"], { unique: true })
@Index(["tenantId", "userId", "updatedAt"])
export class ConversationParticipant extends TenantOwnedBaseEntity {
  @Column({ name: "conversation_id", type: "uuid" })
  @Index()
  conversationId!: string;

  @ManyToOne("Conversation", { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
  conversation!: Conversation;

  @Column({ name: "user_id", type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne("User", { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "varchar", length: 24, default: "participant" })
  role!: ConversationParticipantRole;

  @Column({ name: "joined_reason", type: "varchar", length: 24 })
  joinedReason!: ConversationParticipantJoinedReason;

  @Column({ name: "last_read_at", type: "timestamptz", nullable: true })
  lastReadAt!: Date | null;
}
