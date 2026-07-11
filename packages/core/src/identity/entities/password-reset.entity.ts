import { Column, Entity, Index } from "typeorm";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

@Entity({ name: "password_reset" })
@Index(["token"])
@Index(["tenantId", "email"])
/**
 * Tracks password reset requests with a time-limited token so callers can
 * exchange a token for a new password.
 */
export class PasswordReset extends TenantOwnedBaseEntity {
  /**
   * Target email address for the reset request.
   */
  @Column({ type: "varchar", length: 240 })
  email!: string;

  /**
   * Single-use token generated for this reset request.
   */
  @Column({ type: "varchar", length: 500 })
  token!: string;

  /**
   * Computed expiry flag that returns true when the record is older than
   * 10 minutes. Not persisted — consumers should check this before accepting.
   */
  get expired(): boolean {
    const createdAt = this.createdAt;
    if (!createdAt) return true;
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;
    return now - createdAt.getTime() > tenMinutes;
  }
}
