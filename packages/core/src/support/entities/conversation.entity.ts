import { Column, Entity, Index } from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";

export type ConversationStatus = "open" | "closed" | "archived";

@Entity({ name: "conversations" })
@Index(["workspaceId", "sourceType", "sourceId"], { unique: true })
@Index(["workspaceId", "status", "updatedAt"])
export class Conversation extends WorkspaceOwnedBaseEntity {
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
