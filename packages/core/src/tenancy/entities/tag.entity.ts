import { Column, Entity, Index } from "typeorm";
import { OrganizationBaseEntity } from "./organization-base.entity.js";

@Entity({ name: "tags" })
@Index(["organizationId", "name", "category"], { unique: true })
/**
 * Organization-scoped tag records migrated from Xpert's tag module.
 */
export class Tag extends OrganizationBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  category!: string | null;

  @Column({ type: "jsonb", nullable: true })
  label!: Record<string, unknown> | null;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "varchar", length: 40, nullable: true })
  color!: string | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  icon!: string | null;

  @Column({ name: "is_system", type: "boolean", default: false })
  isSystem!: boolean;
}
