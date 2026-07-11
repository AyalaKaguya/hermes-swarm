import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Department } from "./department.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

export type DepartmentDispatchType =
  | "handoff"
  | "escalation"
  | "collaboration"
  | "fallback";

@Entity({ name: "department_dispatch_relations" })
@Index("UQ_department_dispatch_edge", ["tenantId", "sourceDepartmentId", "targetDepartmentId", "type"], {
  unique: true,
})
@Check("CHK_department_dispatch_not_self", "source_department_id <> target_department_id")
export class DepartmentDispatchRelation extends TenantOwnedBaseEntity {
  @Column({ name: "source_department_id", type: "uuid" })
  @Index()
  sourceDepartmentId!: string;

  @ManyToOne("Department", {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "source_department_id" })
  sourceDepartment!: Department;

  @Column({ name: "target_department_id", type: "uuid" })
  @Index()
  targetDepartmentId!: string;

  @ManyToOne("Department", {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "target_department_id" })
  targetDepartment!: Department;

  @Column({ type: "varchar", length: 24 })
  type!: DepartmentDispatchType;

  @Column({ type: "integer", default: 100 })
  priority!: number;

  @Column({ name: "is_enabled", type: "boolean", default: true })
  isEnabled!: boolean;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  policy!: Record<string, unknown>;
}
