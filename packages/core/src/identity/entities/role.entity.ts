import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import type { RolePermission } from "./role-permission.entity.js";
import type { Workspace } from "./workspace.entity.js";
import { BaseEntity } from "./base.entity.js";

export type RoleScope = "platform" | "workspace";

@Entity({ name: "roles" })
@Index("UQ_roles_platform_name", ["name"], {
  unique: true,
  where: `"scope" = 'platform'`,
})
@Index("UQ_roles_workspace_name", ["workspaceId", "name"], {
  unique: true,
  where: `"scope" = 'workspace'`,
})
@Check(
  "CHK_roles_scope_workspace",
  `(scope = 'platform' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL)`,
)
export class Role extends BaseEntity {
  @Column({ name: "workspace_id", type: "uuid", nullable: true })
  @Index()
  workspaceId!: string | null;

  @ManyToOne("Workspace", { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace | null;

  @Column({ type: "varchar", length: 24, default: "workspace" })
  scope!: RoleScope;

  @Column({ type: "varchar", length: 80 })
  name!: string;

  @Column({ type: "varchar", length: 120 })
  label!: string;

  @Column({ name: "display_name", type: "varchar", length: 120, nullable: true })
  displayName!: string | null;

  @Column({ type: "varchar", length: 40, nullable: true })
  color!: string | null;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ name: "is_system", type: "boolean", default: false })
  isSystem!: boolean;

  @OneToMany("RolePermission", "role")
  rolePermissions!: RolePermission[];

}
