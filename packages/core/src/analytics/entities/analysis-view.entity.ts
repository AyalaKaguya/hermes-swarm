import { Check, Column, Entity, Index } from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";

@Entity({ name: "analysis_views" })
@Index("UQ_analysis_views_workspace_name", ["workspaceId", "name"], {
  unique: true,
})
@Index("UQ_analysis_views_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index("IDX_analysis_views_workspace_updated", ["workspaceId", "updatedAt"])
@Check("CHK_analysis_views_revision", `"revision" > 0`)
@Check("CHK_analysis_views_query_object", `jsonb_typeof("query") = 'object'`)
@Check(
  "CHK_analysis_views_visualization_object",
  `jsonb_typeof("visualization") = 'object'`,
)
export class AnalysisView extends WorkspaceOwnedBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ name: "dataset_id", type: "varchar", length: 128 })
  datasetId!: string;

  @Column({ type: "jsonb" })
  query!: object;

  @Column({ type: "jsonb" })
  visualization!: object;

  @Column({ type: "integer", default: 1 })
  revision!: number;
}
