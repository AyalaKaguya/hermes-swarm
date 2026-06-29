import { Column, Entity, Index } from "typeorm";
import { OrganizationBaseEntity } from "../../identity/entities/organization-base.entity.js";

@Entity({ name: "notification_destinations" })
@Index(["organizationId", "type", "name"])
/**
 */
export class NotificationDestination extends OrganizationBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 80 })
  type!: string;

  @Column({ type: "jsonb", nullable: true })
  options!: Record<string, unknown> | null;
}
