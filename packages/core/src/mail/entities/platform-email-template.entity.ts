import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";

@Entity({ name: "platform_email_templates" })
@Index("UQ_platform_email_templates_name_language", ["name", "languageCode"], {
  unique: true,
})
export class PlatformEmailTemplate extends BaseEntity {
  @Column({ type: "varchar", length: 120 }) name!: string;
  @Column({ name: "is_system", type: "boolean", default: false }) isSystem!: boolean;
  @Column({ type: "varchar", length: 240, nullable: true }) description!: string | null;
  @Column({ name: "language_code", type: "varchar", length: 16, default: "en" }) languageCode!: string;
  @Column({ type: "varchar", length: 240, nullable: true }) subject!: string | null;
  @Column({ type: "text", nullable: true }) mjml!: string | null;
  @Column({ type: "text" }) hbs!: string;
}
