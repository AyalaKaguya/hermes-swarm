import { Column, Entity, Index } from "typeorm";
import { TenantOwnedBaseEntity } from "../../identity/entities/tenant-owned-base.entity.js";

export type ConversationStatus = "open" | "closed" | "archived";

@Entity({ name: "conversations" })
@Index(["tenantId", "sourceType", "sourceId"], { unique: true })
@Index(["tenantId", "status", "updatedAt"])
export class Conversation extends TenantOwnedBaseEntity {
  @Column({ name: "source_type", type: "varchar", length: 80 })
  sourceType!: string;

  @Column({ name: "source_id", type: "uuid" })
  sourceId!: string;

  @Column({ type: "varchar", length: 240 })
  subject!: string;

  @Column({ type: "varchar", length: 24, default: "open" })
  status!: ConversationStatus;

  @Column({ name: "last_message_at", type: "timestamptz", nullable: true })
  lastMessageAt!: Date | null;
}
