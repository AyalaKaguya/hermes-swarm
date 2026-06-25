import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../tenancy/entities/base.entity.js";

@Entity({ name: "system_settings" })
@Index(["name"], { unique: true })
/**
 * Stores global settings that are not scoped to a single organization.
 */
export class SystemSetting extends BaseEntity {
  /**
   * Stable setting key.
   */
  @Column({ type: "varchar", length: 160 })
  name!: string;

  /**
   * Serialized setting value.
   */
  @Column({ type: "text", nullable: true })
  value!: string | null;

  /**
   * Scope marker reserved for future system setting partitions.
   */
  @Column({ type: "varchar", length: 80, default: "global" })
  scope!: string;
}
