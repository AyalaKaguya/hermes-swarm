import { Column, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Workspace } from "./workspace.entity.js";
import { BaseEntity } from "./base.entity.js";

/** Base for every record that belongs to exactly one workspace data plane. */
export abstract class WorkspaceOwnedBaseEntity extends BaseEntity {
  @Column({ name: "workspace_id", type: "uuid" })
  @Index()
  workspaceId!: string;

  @ManyToOne("Workspace", {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace;
}
