import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import type { Account } from "../../identity/entities/account.entity.js";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Workspace } from "../../identity/entities/workspace.entity.js";

export type FileObjectScope = "account" | "platform" | "workspace";
export type FileObjectStatus = "deleted" | "failed" | "pending" | "ready";
export type FileObjectRetention = "persistent" | "temporary";
export type FileObjectPurpose =
  | "artifact"
  | "avatar"
  | "dashboard_asset"
  | "document"
  | "generic"
  | "ticket_attachment";

@Entity({ name: "file_objects" })
@Check(
  "CHK_file_objects_scope_workspace",
  `("scope_type" = 'workspace' AND "workspace_id" IS NOT NULL) OR ("scope_type" IN ('account', 'platform') AND "workspace_id" IS NULL)`,
)
@Index("UQ_file_objects_bucket_key", ["bucket", "objectKey"], { unique: true })
@Index("UQ_file_objects_workspace_id_id", ["workspaceId", "id"], {
  unique: true,
})
@Index("IDX_file_objects_scope_status_created", [
  "scopeType",
  "workspaceId",
  "status",
  "createdAt",
])
@Index("IDX_file_objects_expiration", ["status", "expiresAt"])
export class FileObject extends BaseEntity {
  @Column({ name: "scope_type", type: "varchar", length: 24 })
  scopeType!: FileObjectScope;

  @Column({ name: "workspace_id", type: "uuid", nullable: true })
  workspaceId!: string | null;

  @ManyToOne("Workspace", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace | null;

  @Column({ name: "created_by_account_id", type: "uuid", nullable: true })
  createdByAccountId!: string | null;

  @ManyToOne("Account", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_account_id" })
  createdByAccount!: Account | null;

  @Column({ type: "varchar", length: 48 })
  purpose!: FileObjectPurpose;

  @Column({ type: "varchar", length: 24, default: "pending" })
  status!: FileObjectStatus;

  @Column({ type: "varchar", length: 24, default: "temporary" })
  retention!: FileObjectRetention;

  @Column({ name: "storage_backend", type: "varchar", length: 24, default: "s3" })
  storageBackend!: "s3";

  @Column({ type: "varchar", length: 160 })
  bucket!: string;

  @Column({ name: "object_key", type: "varchar", length: 500 })
  objectKey!: string;

  @Column({ name: "original_name", type: "varchar", length: 240 })
  originalName!: string;

  @Column({ name: "mime_type", type: "varchar", length: 160 })
  mimeType!: string;

  @Column({ name: "byte_size", type: "integer" })
  byteSize!: number;

  @Column({ type: "varchar", length: 64, nullable: true })
  sha256!: string | null;

  @Column({ type: "varchar", length: 200, nullable: true })
  etag!: string | null;

  @Column({ name: "failure_code", type: "varchar", length: 120, nullable: true })
  failureCode!: string | null;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;
}
