import { Column, Entity, Index } from "typeorm";
import { OrganizationBaseEntity } from "../../identity/entities/organization-base.entity.js";

@Entity({ name: "email_templates" })
@Index("UQ_email_templates_platform_name_language", ["name", "languageCode"], {
  unique: true,
  where: "\"organization_id\" IS NULL",
})
@Index(
  "UQ_email_templates_org_name_language",
  ["organizationId", "name", "languageCode"],
  {
    unique: true,
    where: "\"organization_id\" IS NOT NULL",
  },
)
/**
 * Stores customizable email template content scoped globally or to one
 * organization.
 */
export class EmailTemplate extends OrganizationBaseEntity {
  /**
   * Stable template name, such as welcome-user or password-reset.
   */
  @Column({ type: "varchar", length: 120 })
  name!: string;

  /**
   * Marks templates owned by the system. These can be edited but not deleted.
   */
  @Column({ name: "is_system", type: "boolean", default: false })
  isSystem!: boolean;

  /**
   * Optional user-facing description shown in template management screens.
   */
  @Column({ type: "varchar", length: 240, nullable: true })
  description!: string | null;

  /**
   * Language code used to select localized template content.
   */
  @Column({ name: "language_code", type: "varchar", length: 16, default: "en" })
  languageCode!: string;

  /**
   * Optional email subject template.
   */
  @Column({ type: "varchar", length: 240, nullable: true })
  subject!: string | null;

  /**
   * Optional MJML source kept for future renderer support.
   */
  @Column({ type: "text", nullable: true })
  mjml!: string | null;

  /**
   * Handlebars-compatible HTML template body.
   */
  @Column({ type: "text" })
  hbs!: string;
}
