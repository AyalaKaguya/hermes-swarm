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
  | "tenant";
export type AccessAuditResult = "allowed" | "denied" | "error";

/** Append-only control-plane record of an authorization decision. */
@Entity({ name: "access_audit_logs" })
@Index("IDX_access_audit_created_at", ["createdAt"])
@Index("IDX_access_audit_tenant", ["tenantId", "createdAt"])
@Index("IDX_access_audit_actor", ["actorId", "createdAt"])
export class AccessAuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "tenant_id", type: "uuid", nullable: true })
  tenantId!: string | null;

  @Column({ name: "organization_id", type: "uuid", nullable: true })
  organizationId!: string | null;

  @Column({ name: "actor_id", type: "uuid", nullable: true })
  actorId!: string | null;

  @Column({ name: "principal_type", type: "varchar", length: 24 })
  principalType!: AccessAuditPrincipalType;

  @Column({ type: "varchar", length: 220 })
  permission!: string;

  @Column({ type: "varchar", length: 16 })
  result!: AccessAuditResult;

  @Column({ name: "target_tenant_id", type: "uuid", nullable: true })
  targetTenantId!: string | null;

  @Column({ name: "http_method", type: "varchar", length: 16, nullable: true })
  httpMethod!: string | null;

  @Column({ name: "http_path", type: "varchar", length: 500, nullable: true })
  httpPath!: string | null;

  @Column({ name: "status_code", type: "integer", nullable: true })
  statusCode!: number | null;

  @Column({ name: "error_code", type: "varchar", length: 120, nullable: true })
  errorCode!: string | null;
}
