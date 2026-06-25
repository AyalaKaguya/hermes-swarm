import { Column, Entity, Index } from "typeorm";
import { OrganizationBaseEntity } from "../../tenancy/entities/organization-base.entity.js";

@Entity({ name: "email_templates" })
@Index(["organizationId", "name", "languageCode"], { unique: true })
export class EmailTemplate extends OrganizationBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ name: "language_code", type: "varchar", length: 16, default: "en" })
  languageCode!: string;

  @Column({ type: "varchar", length: 240, nullable: true })
  subject!: string | null;

  @Column({ type: "text", nullable: true })
  mjml!: string | null;

  @Column({ type: "text" })
  hbs!: string;
}
