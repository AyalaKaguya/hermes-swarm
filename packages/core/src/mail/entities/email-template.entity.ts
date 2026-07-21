import { Column, Entity, Index } from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";

@Entity({ name: "email_templates" })
@Index("UQ_email_templates_workspace_name_language", ["workspaceId", "name", "languageCode"], {
  unique: true,
})
/**
 * Stores customizable email template content scoped globally or to one
 * workspace.
 */
export class EmailTemplate extends WorkspaceOwnedBaseEntity {
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
