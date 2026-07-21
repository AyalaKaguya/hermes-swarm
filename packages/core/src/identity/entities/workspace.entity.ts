import { Column, DeleteDateColumn, Entity, Index, OneToMany } from "typeorm";
import type { WorkspaceMembership } from "./workspace-membership.entity.js";
import { BaseEntity } from "./base.entity.js";

export type WorkspaceStatus =
  | "provisioning"
  | "active"
  | "suspended"
  | "archived";

@Entity({ name: "workspaces" })
@Index("UQ_workspaces_active_slug", ["slug"], {
  unique: true,
  where: "deleted_at IS NULL",
})
@Index("UQ_workspaces_active_subdomain", ["subdomain"], {
  unique: true,
  where: "subdomain IS NOT NULL AND deleted_at IS NULL",
})
export class Workspace extends BaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 80 })
  slug!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  subdomain!: string | null;

  @Column({ type: "varchar", length: 24, default: "provisioning" })
  status!: WorkspaceStatus;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @OneToMany("WorkspaceMembership", "workspace")
  memberships!: WorkspaceMembership[];

}
