import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { FileObject } from "../../files/entities/file-object.entity.js";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { AiMessage } from "./ai-message.entity.js";

@Entity({ name: "ai_message_files" })
@Index("UQ_ai_message_files_workspace_file", ["workspaceId", "fileObjectId"], {
  unique: true,
})
@Index("UQ_ai_message_files_workspace_message_file", [
  "workspaceId",
  "messageId",
  "fileObjectId",
], { unique: true })
@Index("UQ_ai_message_files_workspace_message_ordinal", [
  "workspaceId",
  "messageId",
  "ordinal",
], { unique: true })
@Check("CHK_ai_message_files_ordinal", `"ordinal" >= 0 AND "ordinal" < 20`)
export class AiMessageFile extends WorkspaceOwnedBaseEntity {
  @Column({ name: "message_id", type: "uuid", update: false })
  messageId!: string;

  @ManyToOne("AiMessage", { nullable: false, onDelete: "CASCADE" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "message_id", referencedColumnName: "id" },
  ])
  message!: AiMessage;

  @Column({ name: "file_object_id", type: "uuid", update: false })
  fileObjectId!: string;

  @ManyToOne("FileObject", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "file_object_id", referencedColumnName: "id" },
  ])
  fileObject!: FileObject;

  @Column({ type: "smallint", update: false })
  ordinal!: number;
}
