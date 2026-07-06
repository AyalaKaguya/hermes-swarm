import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Organization } from "../../identity/entities/organization.entity.js";
import type { User } from "../../identity/entities/user.entity.js";

export type UserNotificationStatus = "read" | "unread";
export type UserNotificationKind = "info" | "success" | "warning" | "error";

@Entity({ name: "user_notifications" })
@Index(["recipientUserId", "status", "createdAt"])
export class UserNotification extends BaseEntity {
  @Column({ name: "recipient_user_id", type: "uuid" })
  @Index()
  recipientUserId!: string;

  @ManyToOne("User", { onDelete: "CASCADE" })
  @JoinColumn({ name: "recipient_user_id" })
  recipientUser!: User;

  @Column({ name: "actor_user_id", type: "uuid", nullable: true })
  @Index()
  actorUserId!: string | null;

  @ManyToOne("User", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "actor_user_id" })
  actorUser!: User | null;

  @Column({ name: "organization_id", type: "uuid", nullable: true })
  @Index()
  organizationId!: string | null;

  @ManyToOne("Organization", { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization | null;

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
