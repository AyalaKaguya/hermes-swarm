import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { Account } from "../../identity/entities/account.entity.js";
import type { Conversation } from "./conversation.entity.js";

export type TicketStatus = "open" | "closed" | "archived";

@Entity({ name: "tickets" })
@Index(["workspaceId", "status", "updatedAt"])
export class Ticket extends WorkspaceOwnedBaseEntity {
  @Column({ name: "requester_user_id", type: "uuid" })
  @Index()
  requesterUserId!: string;

  @ManyToOne("Account", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "requester_user_id" })
  requesterUser!: Account;

  @Column({ name: "assignee_user_id", type: "uuid", nullable: true })
  @Index()
  assigneeUserId!: string | null;

  @ManyToOne("Account", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "assignee_user_id" })
  assigneeUser!: Account | null;

  @Column({ name: "conversation_id", type: "uuid", nullable: true })
  @Index()
  conversationId!: string | null;

  @ManyToOne("Conversation", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "conversation_id" })
  conversation!: Conversation | null;

  @Column({ type: "varchar", length: 240 })
  subject!: string;

  @Column({
    array: true,
    default: () => "ARRAY[]::uuid[]",
    name: "participant_user_ids",
    type: "uuid",
  })
  participantUserIds!: string[];

  @Column({ type: "varchar", length: 24, default: "open" })
  status!: TicketStatus;

  @Column({ name: "requester_closed_at", type: "timestamptz", nullable: true })
  requesterClosedAt!: Date | null;

  @Column({ name: "handler_closed_at", type: "timestamptz", nullable: true })
  handlerClosedAt!: Date | null;

  @Column({ name: "last_message_at", type: "timestamptz", nullable: true })
  lastMessageAt!: Date | null;

  @Column({ name: "archived_at", type: "timestamptz", nullable: true })
  archivedAt!: Date | null;
}
