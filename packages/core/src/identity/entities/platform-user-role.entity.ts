import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { PlatformRole } from "./platform-role.entity.js";
import type { PlatformUser } from "./platform-user.entity.js";
import { BaseEntity } from "./base.entity.js";

@Entity({ name: "platform_user_roles" })
@Index("UQ_platform_user_roles", ["platformUserId", "platformRoleId"], { unique: true })
export class PlatformUserRole extends BaseEntity {
  @Column({ name: "platform_user_id", type: "uuid" })
  @Index()
  platformUserId!: string;

  @ManyToOne("PlatformUser", { onDelete: "CASCADE" })
  @JoinColumn({ name: "platform_user_id" })
  platformUser!: PlatformUser;

  @Column({ name: "platform_role_id", type: "uuid" })
  @Index()
  platformRoleId!: string;

  @ManyToOne("PlatformRole", { onDelete: "CASCADE" })
  @JoinColumn({ name: "platform_role_id" })
  platformRole!: PlatformRole;
}
