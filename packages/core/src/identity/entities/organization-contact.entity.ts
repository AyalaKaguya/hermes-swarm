import { Column, Entity, Index } from "typeorm";
import { OrganizationBaseEntity } from "./organization-base.entity.js";

@Entity({ name: "organization_contacts" })
@Index(["organizationId", "email"])
/**
 * Contact records for an organization, used by invite flows and external
 * communication management.
 */
export class OrganizationContact extends OrganizationBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ name: "primary_email", type: "varchar", length: 240 })
  @Index()
  email!: string;

  @Column({ name: "primary_phone", type: "varchar", length: 80, nullable: true })
  phone!: string | null;

  @Column({ name: "contact_type", type: "varchar", length: 40, default: "client" })
  contactType!: string;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ name: "image_url", type: "varchar", length: 500, nullable: true })
  imageUrl!: string | null;

  @Column({ name: "invite_status", type: "varchar", length: 40, nullable: true })
  inviteStatus!: string | null;
}
