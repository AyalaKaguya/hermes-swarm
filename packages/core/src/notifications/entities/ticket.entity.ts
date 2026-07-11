import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { TenantOwnedBaseEntity } from "../../identity/entities/tenant-owned-base.entity.js";
import type { Department } from "../../identity/entities/department.entity.js";
import type { Organization } from "../../identity/entities/organization.entity.js";
import type { User } from "../../identity/entities/user.entity.js";
import type { Conversation } from "./conversation.entity.js";

export type TicketScope = "tenant" | "organization" | "department";
export type TicketStatus = "open" | "closed" | "archived";

@Entity({ name: "tickets" })
@Index(["tenantId", "scope", "organizationId", "departmentId", "status", "updatedAt"])
export class Ticket extends TenantOwnedBaseEntity {
  @Column({ type: "varchar", length: 24 })
  scope!: TicketScope;

  @Column({ name: "organization_id", type: "uuid", nullable: true })
  @Index()
  organizationId!: string | null;

  @ManyToOne("Organization", { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization | null;

  @Column({ name: "department_id", type: "uuid", nullable: true })
  @Index()
  departmentId!: string | null;

  @ManyToOne("Department", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "department_id" })
  department!: Department | null;

  @Column({ name: "requester_user_id", type: "uuid" })
  @Index()
  requesterUserId!: string;

  @ManyToOne("User", { onDelete: "CASCADE" })
  @JoinColumn({ name: "requester_user_id" })
  requesterUser!: User;

  @Column({ name: "assignee_user_id", type: "uuid", nullable: true })
  @Index()
  assigneeUserId!: string | null;

  @ManyToOne("User", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "assignee_user_id" })
  assigneeUser!: User | null;

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
