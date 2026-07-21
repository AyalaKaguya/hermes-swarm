import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { Account } from "../../identity/entities/account.entity.js";
import type { Ticket } from "./ticket.entity.js";

export type TicketMessageKind = "message" | "system";

export type TicketMessageAttachment = {
  mimeType?: string;
  name: string;
  size?: number;
  type: "image";
  url: string;
};

@Entity({ name: "ticket_messages" })
@Index(["workspaceId", "ticketId", "createdAt"])
export class TicketMessage extends WorkspaceOwnedBaseEntity {
  @Column({ name: "ticket_id", type: "uuid" })
  @Index()
  ticketId!: string;

  @ManyToOne("Ticket", { onDelete: "CASCADE" })
  @JoinColumn({ name: "ticket_id" })
  ticket!: Ticket;

  @Column({ name: "author_user_id", type: "uuid", nullable: true })
  @Index()
  authorUserId!: string | null;

  @ManyToOne("Account", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "author_user_id" })
  authorUser!: Account | null;

  @Column({ type: "varchar", length: 24, default: "message" })
  kind!: TicketMessageKind;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "jsonb", nullable: true })
  attachments!: TicketMessageAttachment[] | null;
}
