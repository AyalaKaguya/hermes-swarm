import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Role } from "./role.entity.js";
import type { UserDepartment } from "./user-department.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

@Entity({ name: "user_department_roles" })
@Index("UQ_user_department_roles", ["tenantId", "userDepartmentId", "roleId"], {
  unique: true,
})
export class UserDepartmentRole extends TenantOwnedBaseEntity {
  @Column({ name: "organization_id", type: "uuid" })
  @Index()
  organizationId!: string;

  @Column({ name: "department_id", type: "uuid" })
  @Index()
  departmentId!: string;

  @Column({ name: "user_department_id", type: "uuid" })
  @Index()
  userDepartmentId!: string;

  @ManyToOne("UserDepartment", { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_department_id" })
  userDepartment!: UserDepartment;

  @Column({ name: "role_id", type: "uuid" })
  @Index()
  roleId!: string;

  @ManyToOne("Role", { onDelete: "CASCADE" })
  @JoinColumn({ name: "role_id" })
  role!: Role;
}
