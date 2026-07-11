import { Column, Entity } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";

@Entity({ name: "platform_smtp" })
export class PlatformSmtp extends BaseEntity {
  @Column({ name: "from_address", type: "varchar", length: 240, nullable: true }) fromAddress!: string | null;
  @Column({ type: "varchar", length: 240 }) host!: string;
  @Column({ type: "integer", default: 587 }) port!: number;
  @Column({ type: "boolean", default: false }) secure!: boolean;
  @Column({ type: "varchar", length: 240, nullable: true }) username!: string | null;
  @Column({ type: "varchar", length: 500, nullable: true }) password!: string | null;
  @Column({ name: "is_validated", type: "boolean", default: false }) isValidated!: boolean;
}
