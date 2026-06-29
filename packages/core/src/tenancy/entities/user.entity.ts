import { Column, DeleteDateColumn, Entity, Index } from "typeorm";

export type UserStatus = "active" | "disabled";
export type UserType = "service" | "user";
export type PreferredLanguage = "en" | "zh-CN" | "zh-Hans" | "zh-Hant";

@Entity({ name: "users" })
@Index(["email"], { unique: true })
export class User {
  @Column({ type: "uuid", primary: true, default: () => "uuid_generate_v4()" })
  id!: string;

  @Column({ type: "varchar", length: 24, default: "user" })
  type!: UserType;

  @Column({ name: "display_name", type: "varchar", length: 120 })
  displayName!: string;

  @Column({ type: "varchar", length: 120, nullable: true })
  nickname!: string | null;

  @Column({ name: "first_name", type: "varchar", length: 80, nullable: true })
  firstName!: string | null;

  @Column({ name: "last_name", type: "varchar", length: 80, nullable: true })
  lastName!: string | null;

  @Column({ type: "varchar", length: 160 })
  @Index()
  email!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  @Index()
  username!: string | null;

  @Column({ name: "password_hash", type: "varchar", length: 240, nullable: true })
  passwordHash!: string | null;

  @Column({ name: "refresh_token", type: "varchar", length: 240, nullable: true })
  refreshToken!: string | null;

  @Column({ name: "image_url", type: "varchar", length: 500, nullable: true })
  imageUrl!: string | null;

  @Column({ name: "avatar_url", type: "varchar", length: 500, nullable: true })
  avatarUrl!: string | null;

  @Column({ name: "preferred_language", type: "varchar", length: 16, default: "zh-CN" })
  preferredLanguage!: PreferredLanguage;

  @Column({ name: "email_verified", type: "boolean", default: false })
  emailVerified!: boolean;

  @Column({ name: "mobile", type: "varchar", length: 32, nullable: true })
  mobile!: string | null;

  @Column({ name: "time_zone", type: "varchar", length: 40, nullable: true })
  timeZone!: string | null;

  @Column({ name: "third_party_id", type: "varchar", length: 120, nullable: true })
  thirdPartyId!: string | null;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: UserStatus;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;
}
