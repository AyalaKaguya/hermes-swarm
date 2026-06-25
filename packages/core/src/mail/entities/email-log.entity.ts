import { Column, Entity, Index } from "typeorm";
import { OrganizationBaseEntity } from "../../tenancy/entities/organization-base.entity.js";

export type EmailDeliveryStatus = "queued" | "sent" | "failed" | "skipped";

@Entity({ name: "email_sent" })
@Index(["organizationId", "createdAt"])
export class EmailLog extends OrganizationBaseEntity {
  @Column({ name: "template_name", type: "varchar", length: 120, nullable: true })
  templateName!: string | null;

  @Column({ type: "varchar", length: 240 })
  email!: string;

  @Column({ type: "varchar", length: 240, nullable: true })
  subject!: string | null;

  @Column({ type: "text", nullable: true })
  content!: string | null;

  @Column({ type: "varchar", length: 24, default: "queued" })
  status!: EmailDeliveryStatus;

  @Column({ name: "is_archived", type: "boolean", default: false })
  isArchived!: boolean;
}
