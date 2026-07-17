import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Role } from "./role.entity.js";
import type { UserOrganization } from "./user-organization.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

@Entity({ name: "user_organization_roles" })
@Index("UQ_user_organization_roles_membership", ["tenantId", "membershipId"], {
  unique: true,
})
export class UserOrganizationRole extends TenantOwnedBaseEntity {
  @Column({ name: "organization_id", type: "uuid" })
  @Index()
  organizationId!: string;

  @Column({ name: "membership_id", type: "uuid" })
  @Index()
  membershipId!: string;

  @ManyToOne("UserOrganization", { onDelete: "CASCADE" })
  @JoinColumn({ name: "membership_id" })
  membership!: UserOrganization;

  @Column({ name: "role_id", type: "uuid" })
  @Index()
  roleId!: string;

  @ManyToOne("Role", { onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "tenant_id", referencedColumnName: "tenantId" },
    { name: "organization_id", referencedColumnName: "organizationId" },
    { name: "role_id", referencedColumnName: "id" },
  ])
  role!: Role;
}
