import { Column, Entity, Index } from "typeorm";
import { OrganizationBaseEntity } from "../../identity/entities/organization-base.entity.js";

@Entity({ name: "email_templates" })
@Index(["organizationId", "name", "languageCode"], { unique: true })
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
