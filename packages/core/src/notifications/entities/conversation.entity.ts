import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Organization } from "../../identity/entities/organization.entity.js";

export type ConversationScope = "organization" | "platform";
export type ConversationStatus = "open" | "closed" | "archived";

@Entity({ name: "conversations" })
@Index(["sourceType", "sourceId"], { unique: true })
@Index(["scope", "organizationId", "status", "updatedAt"])
export class Conversation extends BaseEntity {
  @Column({ name: "source_type", type: "varchar", length: 80 })
  sourceType!: string;

  @Column({ name: "source_id", type: "uuid" })
  sourceId!: string;

  @Column({ type: "varchar", length: 24 })
  scope!: ConversationScope;

  @Column({ name: "organization_id", type: "uuid", nullable: true })
  @Index()
  organizationId!: string | null;

  @ManyToOne("Organization", { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization | null;

  @Column({ type: "varchar", length: 240 })
  subject!: string;

  @Column({ type: "varchar", length: 24, default: "open" })
  status!: ConversationStatus;

  @Column({ name: "last_message_at", type: "timestamptz", nullable: true })
  lastMessageAt!: Date | null;
}
