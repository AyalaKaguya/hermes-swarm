import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { Account } from "../../identity/entities/account.entity.js";

export type UserNotificationStatus = "read" | "unread";
export type UserNotificationKind = "info" | "success" | "warning" | "error";

@Entity({ name: "user_notifications" })
@Index(["workspaceId", "recipientUserId", "status", "createdAt"])
export class UserNotification extends WorkspaceOwnedBaseEntity {
  @Column({ name: "recipient_user_id", type: "uuid" })
  @Index()
  recipientUserId!: string;

  @ManyToOne("Account", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "recipient_user_id" })
  recipientUser!: Account;

  @Column({ name: "actor_user_id", type: "uuid", nullable: true })
  @Index()
  actorUserId!: string | null;

  @ManyToOne("Account", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "actor_user_id" })
  actorUser!: Account | null;

  @Column({ type: "varchar", length: 24, default: "info" })
  kind!: UserNotificationKind;

  @Column({ type: "varchar", length: 240 })
  title!: string;

  @Column({ type: "text", nullable: true })
  body!: string | null;

  @Column({ name: "source_type", type: "varchar", length: 80, nullable: true })
  sourceType!: string | null;

  @Column({ name: "source_id", type: "uuid", nullable: true })
  sourceId!: string | null;

  @Column({ type: "jsonb", nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ type: "varchar", length: 16, default: "unread" })
  status!: UserNotificationStatus;

  @Column({ name: "read_at", type: "timestamptz", nullable: true })
  readAt!: Date | null;

  @Column({ name: "dismissed_at", type: "timestamptz", nullable: true })
  dismissedAt!: Date | null;
}
