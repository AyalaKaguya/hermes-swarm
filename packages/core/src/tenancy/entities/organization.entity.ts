import {
  Column,
  Entity,
  Index,
  OneToMany,
} from "typeorm";
import type { UserOrganization } from "./user-organization.entity.js";
import { TenantBaseEntity } from "./tenant-base.entity.js";

export type OrganizationStatus = "active" | "suspended";

@Entity({ name: "organizations" })
@Index(["tenantId", "slug"], { unique: true })
export class Organization extends TenantBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 80 })
  slug!: string;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: OrganizationStatus;

  @OneToMany("UserOrganization", "organization")
  members!: UserOrganization[];
}
