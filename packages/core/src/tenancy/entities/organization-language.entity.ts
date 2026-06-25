import { Column, Entity, Index } from "typeorm";
import { OrganizationBaseEntity } from "./organization-base.entity.js";

@Entity({ name: "organization_languages" })
@Index(["organizationId", "languageCode"], { unique: true })
/**
 * Supported languages for an organization, including proficiency levels.
 */
export class OrganizationLanguage extends OrganizationBaseEntity {
  @Column({ name: "language_code", type: "varchar", length: 16 })
  languageCode!: string;

  @Column({ type: "varchar", length: 80 })
  name!: string;

  @Column({ type: "varchar", length: 40, default: "intermediate" })
  level!: string;
}
