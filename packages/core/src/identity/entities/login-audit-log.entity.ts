import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type LoginAuditResult = "failed" | "success";
export type LoginAuditScopeType = "platform" | "workspace";

/** Append-only record of a platform or workspace interactive login attempt. */
@Entity({ name: "login_audit_logs" })
@Index("IDX_login_audit_scope", ["scopeType", "createdAt"])
@Index("IDX_login_audit_workspace", ["workspaceId", "createdAt"])
@Index("IDX_login_audit_actor", ["actorId", "createdAt"])
@Index("IDX_login_audit_email", ["attemptedEmail", "createdAt"])
export class LoginAuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "scope_type", type: "varchar", length: 24 })
  scopeType!: LoginAuditScopeType;

  @Column({ name: "workspace_id", type: "uuid", nullable: true })
  workspaceId!: string | null;

  @Column({ name: "actor_id", type: "uuid", nullable: true })
  actorId!: string | null;

  @Column({ name: "attempted_email", type: "varchar", length: 160 })
  attemptedEmail!: string;

  @Column({ type: "varchar", length: 16 })
  result!: LoginAuditResult;

  @Column({ name: "failure_code", type: "varchar", length: 120, nullable: true })
  failureCode!: string | null;

  @Column({ name: "session_id", type: "uuid", nullable: true })
  sessionId!: string | null;

  @Column({ name: "ip_address", type: "varchar", length: 64, nullable: true })
  ipAddress!: string | null;

  @Column({ name: "user_agent", type: "varchar", length: 500, nullable: true })
  userAgent!: string | null;

  @Column({ name: "device_label", type: "varchar", length: 160, nullable: true })
  deviceLabel!: string | null;
}
