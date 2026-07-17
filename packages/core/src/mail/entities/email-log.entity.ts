import { Column, Entity, Index } from "typeorm";
import { TenantOwnedBaseEntity } from "../../identity/entities/tenant-owned-base.entity.js";

/**
 * Delivery states tracked for sent-email history.
 */
export type EmailDeliveryStatus = "queued" | "sent" | "failed" | "skipped";

@Entity({ name: "email_sent" })
@Index(["tenantId", "createdAt"])
/**
 * Records mail workflow attempts for audit and administration views.
 */
export class EmailLog extends TenantOwnedBaseEntity {
  /**
   * Template name used to produce the message.
   */
  @Column({ name: "template_name", type: "varchar", length: 120, nullable: true })
  templateName!: string | null;

  /**
   * Recipient email address.
   */
  @Column({ type: "varchar", length: 240 })
  email!: string;

  /**
   * Subject line captured for history display.
   */
  @Column({ type: "varchar", length: 240, nullable: true })
  subject!: string | null;

  /**
   * Rendered or submitted message content.
   */
  @Column({ type: "text", nullable: true })
  content!: string | null;

  /**
   * Current delivery status for the record.
   */
  @Column({ type: "varchar", length: 24, default: "queued" })
  status!: EmailDeliveryStatus;

  /**
   * Hides a record from default history views without deleting it.
   */
  @Column({ name: "is_archived", type: "boolean", default: false })
  isArchived!: boolean;
}
