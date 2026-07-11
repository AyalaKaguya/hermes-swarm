import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Role } from "./role.entity.js";
import type { User } from "./user.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

@Entity({ name: "user_tenant_roles" })
@Index("UQ_user_tenant_roles", ["tenantId", "userId", "roleId"], {
  unique: true,
})
export class UserTenantRole extends TenantOwnedBaseEntity {
  @Column({ name: "user_id", type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne("User", { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ name: "role_id", type: "uuid" })
  @Index()
  roleId!: string;

  @ManyToOne("Role", { onDelete: "CASCADE" })
  @JoinColumn({ name: "role_id" })
  role!: Role;
}
