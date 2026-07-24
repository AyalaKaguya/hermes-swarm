import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import type { FileObject } from "../../files/entities/file-object.entity.js";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { ConversationMessage } from "./conversation-message.entity.js";

@Entity({ name: "conversation_message_files" })
@Index(
  "UQ_conversation_message_files_object",
  ["workspaceId", "messageId", "fileObjectId"],
  { unique: true },
)
@Index(
  "UQ_conversation_message_files_ordinal",
  ["workspaceId", "messageId", "ordinal"],
  { unique: true },
)
export class ConversationMessageFile extends WorkspaceOwnedBaseEntity {
  @Column({ name: "message_id", type: "uuid" })
  messageId!: string;

  @ManyToOne("ConversationMessage", { onDelete: "CASCADE" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "message_id", referencedColumnName: "id" },
  ])
  message!: ConversationMessage;

  @Column({ name: "file_object_id", type: "uuid" })
  fileObjectId!: string;

  @ManyToOne("FileObject", { onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "file_object_id", referencedColumnName: "id" },
  ])
  fileObject!: FileObject;

  @Column({ type: "smallint" })
  ordinal!: number;
}
