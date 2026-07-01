import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Role } from "./role.entity.js";
import type { User } from "./user.entity.js";
import { BaseEntity } from "./base.entity.js";

export type PlatformMemberStatus = "active" | "disabled";

@Entity({ name: "platform_members" })
@Index(["userId"], { unique: true })
export class PlatformMember extends BaseEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne("User", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ name: "role_id", type: "uuid", nullable: true })
  @Index()
  roleId!: string | null;

  @ManyToOne("Role", "platformMembers", {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "role_id" })
  role!: Role | null;

  @Column({ name: "display_name", type: "varchar", length: 120, nullable: true })
  displayName!: string | null;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: PlatformMemberStatus;
}
