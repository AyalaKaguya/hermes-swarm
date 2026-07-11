import { Column, Entity, Index, JoinColumn, OneToOne } from "typeorm";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";
import type { User } from "./user.entity.js";

@Entity({ name: "email_verifications" })
/**
 * Email verification tokens issued to users for identity confirmation.
 */
export class EmailVerification extends TenantOwnedBaseEntity {
  @Column({ type: "varchar", length: 500 })
  @Index({ unique: true })
  token!: string;

  @Column({ name: "user_id", type: "uuid" })
  @Index()
  userId!: string;

  @OneToOne("User", { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ name: "valid_until", type: "timestamptz" })
  validUntil!: Date;
}
