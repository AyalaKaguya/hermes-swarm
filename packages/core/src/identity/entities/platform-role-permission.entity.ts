import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Permission } from "./permission.entity.js";
import type { PlatformRole } from "./platform-role.entity.js";
import { BaseEntity } from "./base.entity.js";

@Entity({ name: "platform_role_permissions" })
@Index("UQ_platform_role_permissions", ["platformRoleId", "permissionId"], { unique: true })
export class PlatformRolePermission extends BaseEntity {
  @Column({ name: "platform_role_id", type: "uuid" })
  @Index()
  platformRoleId!: string;

  @ManyToOne("PlatformRole", { onDelete: "CASCADE" })
  @JoinColumn({ name: "platform_role_id" })
  platformRole!: PlatformRole;

  @Column({ name: "permission_id", type: "uuid" })
  @Index()
  permissionId!: string;

  @ManyToOne("Permission", { onDelete: "CASCADE" })
  @JoinColumn({ name: "permission_id" })
  permission!: Permission;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;
}
