import { z } from "zod";
import { AnalysisQuerySchema } from "./query.js";
import { AnalyticsSourceKeySchema } from "./primitives.js";
import { VisualizationSpecSchema } from "./visualization.js";

export const AnalysisViewIdSchema = z.uuid();
export const AnalysisViewRevisionSchema = z.number().int().positive();
export const AnalysisViewNameSchema = z.string().trim().min(1).max(120);

const analysisViewDefinitionShape = {
  datasetId: AnalyticsSourceKeySchema,
  name: AnalysisViewNameSchema,
  query: AnalysisQuerySchema,
  visualization: VisualizationSpecSchema,
} as const;

function requireMatchingDatasetId(
  value: { datasetId: string; query: { sourceKey: string } },
  context: z.RefinementCtx,
) {
  if (value.datasetId !== value.query.sourceKey) {
    context.addIssue({
      code: "custom",
      message: "datasetId must match query.sourceKey",
      path: ["datasetId"],
    });
  }
}

export const AnalysisViewSchema = z
  .strictObject({
    ...analysisViewDefinitionShape,
    createdAt: z.iso.datetime({ offset: true }),
    id: AnalysisViewIdSchema,
    revision: AnalysisViewRevisionSchema,
    updatedAt: z.iso.datetime({ offset: true }),
    workspaceId: z.uuid(),
  })
  .superRefine(requireMatchingDatasetId);
export type AnalysisView = z.infer<typeof AnalysisViewSchema>;
export const AnalysisViewListSchema = z.array(AnalysisViewSchema);

export const CreateAnalysisViewRequestSchema = z
  .strictObject(analysisViewDefinitionShape)
  .superRefine(requireMatchingDatasetId);
export type CreateAnalysisViewRequest = z.infer<
  typeof CreateAnalysisViewRequestSchema
>;

export const UpdateAnalysisViewRequestSchema = z
  .strictObject({
    datasetId: AnalyticsSourceKeySchema.optional(),
    expectedRevision: AnalysisViewRevisionSchema,
    name: AnalysisViewNameSchema.optional(),
    query: AnalysisQuerySchema.optional(),
    visualization: VisualizationSpecSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.datasetId === undefined &&
      value.name === undefined &&
      value.query === undefined &&
      value.visualization === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "an update must change at least one view field",
        path: [],
      });
    }
    if (
      value.datasetId !== undefined &&
      value.query !== undefined &&
      value.datasetId !== value.query.sourceKey
    ) {
      context.addIssue({
        code: "custom",
        message: "datasetId must match query.sourceKey",
        path: ["datasetId"],
      });
    }
  });
export type UpdateAnalysisViewRequest = z.infer<
  typeof UpdateAnalysisViewRequestSchema
>;

export const DeleteAnalysisViewRequestSchema = z.strictObject({
  expectedRevision: AnalysisViewRevisionSchema,
});
export type DeleteAnalysisViewRequest = z.infer<
  typeof DeleteAnalysisViewRequestSchema
>;

export const AnalysisViewParamsSchema = z.strictObject({
  viewId: AnalysisViewIdSchema,
});
