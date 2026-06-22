import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "menus" })
@Index(["code"], { unique: true })
export class Menu {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "parent_id", type: "uuid", nullable: true })
  parentId!: string | null;

  @ManyToOne(() => Menu, (menu) => menu.children, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "parent_id" })
  parent!: Menu | null;

  @OneToMany(() => Menu, (menu) => menu.parent)
  children!: Menu[];

  @Column({ type: "varchar", length: 80 })
  code!: string;

  @Column({ type: "varchar", length: 120 })
  label!: string;

  @Column({ type: "varchar", length: 180 })
  path!: string;

  @Column({ name: "sort_order", type: "integer", default: 0 })
  sortOrder!: number;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamp with time zone" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp with time zone" })
  updatedAt!: Date;
}
