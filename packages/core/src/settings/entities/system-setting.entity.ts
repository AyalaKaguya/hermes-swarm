import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../tenancy/entities/base.entity.js";

@Entity({ name: "system_settings" })
@Index(["name"], { unique: true })
export class SystemSetting extends BaseEntity {
  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "text", nullable: true })
  value!: string | null;

  @Column({ type: "varchar", length: 80, default: "global" })
  scope!: string;
}
