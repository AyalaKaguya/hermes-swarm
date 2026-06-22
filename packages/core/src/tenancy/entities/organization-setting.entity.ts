import { Column, Entity, Index } from "typeorm";
import { OrganizationBaseEntity } from "./organization-base.entity.js";

@Entity({ name: "organization_settings" })
@Index(["organizationId", "name"], { unique: true })
export class OrganizationSetting extends OrganizationBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "text", nullable: true })
  value!: string | null;
}
