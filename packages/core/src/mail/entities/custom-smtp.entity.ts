import { Column, Entity } from "typeorm";
import { TenantOwnedBaseEntity } from "../../identity/entities/tenant-owned-base.entity.js";

@Entity({ name: "custom_smtp" })
/**
 * Stores SMTP settings that override the default mail transport for an
 * organization.
 */
export class CustomSmtp extends TenantOwnedBaseEntity {
  /**
   * Sender address used when composing outbound mail.
   */
  @Column({ name: "from_address", type: "varchar", length: 240, nullable: true })
  fromAddress!: string | null;

  /**
   * SMTP server hostname.
   */
  @Column({ type: "varchar", length: 240 })
  host!: string;

  /**
   * SMTP server port.
   */
  @Column({ type: "integer", default: 587 })
  port!: number;

  /**
   * Whether the transport should use implicit TLS.
   */
  @Column({ type: "boolean", default: false })
  secure!: boolean;

  /**
   * Optional SMTP authentication username.
   */
  @Column({ type: "varchar", length: 240, nullable: true })
  username!: string | null;

  /**
   * Optional SMTP authentication password.
   */
  @Column({ type: "varchar", length: 500, nullable: true })
  password!: string | null;

  /**
   * Marks whether the current SMTP settings passed validation.
   */
  @Column({ name: "is_validated", type: "boolean", default: false })
  isValidated!: boolean;
}
