import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type AccessAuditPrincipalType =
  | "anonymous"
  | "integration"
  | "platform"
  | "workspace";
export type AccessAuditResult = "allowed" | "denied" | "error";
export type AccessAuditScopeType =
  | "own"
  | "platform"
  | "workspace";

/** Append-only control-plane record of an authorization decision. */
@Entity({ name: "access_audit_logs" })
@Index("IDX_access_audit_created_at", ["createdAt"])
@Index("IDX_access_audit_workspace", ["workspaceId", "createdAt"])
@Index("IDX_access_audit_actor", ["actorId", "createdAt"])
export class AccessAuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "workspace_id", type: "uuid", nullable: true })
  workspaceId!: string | null;

  @Column({ name: "actor_id", type: "uuid", nullable: true })
  actorId!: string | null;

  @Column({ name: "principal_type", type: "varchar", length: 24 })
  principalType!: AccessAuditPrincipalType;

  @Column({ name: "scope_type", type: "varchar", length: 24 })
  scopeType!: AccessAuditScopeType;

  @Column({ name: "session_id", type: "uuid", nullable: true })
  sessionId!: string | null;

  @Column({ type: "varchar", length: 220 })
  permission!: string;

  @Column({ type: "varchar", length: 16 })
  result!: AccessAuditResult;

  @Column({ name: "target_workspace_id", type: "uuid", nullable: true })
  targetWorkspaceId!: string | null;

  @Column({ name: "http_method", type: "varchar", length: 16, nullable: true })
  httpMethod!: string | null;

  @Column({ name: "http_path", type: "varchar", length: 500, nullable: true })
  httpPath!: string | null;

  @Column({ name: "status_code", type: "integer", nullable: true })
  statusCode!: number | null;

  @Column({ name: "error_code", type: "varchar", length: 120, nullable: true })
  errorCode!: string | null;

  @Column({ name: "ip_address", type: "varchar", length: 64, nullable: true })
  ipAddress!: string | null;

  @Column({ name: "user_agent", type: "varchar", length: 500, nullable: true })
  userAgent!: string | null;
}
