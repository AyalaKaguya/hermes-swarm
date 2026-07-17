import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { TenantOwnedBaseEntity } from "../../identity/entities/tenant-owned-base.entity.js";
import type { User } from "../../identity/entities/user.entity.js";
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
@Index(["tenantId", "ticketId", "createdAt"])
export class TicketMessage extends TenantOwnedBaseEntity {
  @Column({ name: "ticket_id", type: "uuid" })
  @Index()
  ticketId!: string;

  @ManyToOne("Ticket", { onDelete: "CASCADE" })
  @JoinColumn({ name: "ticket_id" })
  ticket!: Ticket;

  @Column({ name: "author_user_id", type: "uuid", nullable: true })
  @Index()
  authorUserId!: string | null;

  @ManyToOne("User", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "author_user_id" })
  authorUser!: User | null;

  @Column({ type: "varchar", length: 24, default: "message" })
  kind!: TicketMessageKind;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "jsonb", nullable: true })
  attachments!: TicketMessageAttachment[] | null;
}
