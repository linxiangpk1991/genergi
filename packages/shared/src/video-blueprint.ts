import { z } from "zod"

export const executionModeSchema = z.enum(["automated", "review_required"])
export type ExecutionMode = z.infer<typeof executionModeSchema>

export const terminalPresetIdSchema = z.enum([
  "phone_portrait",
  "phone_landscape",
  "tablet_portrait",
  "tablet_landscape",
])
export type TerminalPresetId = z.infer<typeof terminalPresetIdSchema>

export const safeAreaSchema = z.object({
  topPct: z.number().min(0).max(100),
  rightPct: z.number().min(0).max(100),
  bottomPct: z.number().min(0).max(100),
  leftPct: z.number().min(0).max(100),
})
export type SafeArea = z.infer<typeof safeAreaSchema>

export const renderSpecSchema = z.object({
  terminalPresetId: terminalPresetIdSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.string().min(1),
  safeArea: safeAreaSchema,
  compositionGuideline: z.string().min(1),
  motionGuideline: z.string().min(1),
})
export type RenderSpec = z.infer<typeof renderSpecSchema>

export const blueprintSceneContractSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  sceneGoal: z.string().min(1),
  voiceoverScript: z.string().min(1),
  startFrameDescription: z.string().min(1),
  imagePrompt: z.string().min(1),
  videoPrompt: z.string().min(1),
  startFrameIntent: z.string().min(1),
  endFrameIntent: z.string().min(1),
  durationSec: z.number().positive(),
  transitionHint: z.string().min(1),
  continuityConstraints: z.array(z.string().min(1)).default([]),
})
export type BlueprintSceneContract = z.infer<typeof blueprintSceneContractSchema>

export const blueprintStatusSchema = z.enum([
  "pending_generation",
  "ready_for_review",
  "rejected",
  "approved",
  "queued_for_video",
  "video_generating",
  "completed",
])
export type BlueprintStatus = z.infer<typeof blueprintStatusSchema>

export const executionBlueprintSchema = z.object({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  executionMode: executionModeSchema,
  renderSpec: renderSpecSchema,
  globalTheme: z.string().min(1),
  visualStyleGuide: z.string().min(1),
  subjectProfile: z.string().min(1),
  productProfile: z.string().min(1),
  backgroundConstraints: z.array(z.string().min(1)).default([]),
  negativeConstraints: z.array(z.string().min(1)).default([]),
  totalVoiceoverScript: z.string().min(1),
  sceneContracts: z.array(blueprintSceneContractSchema).min(1),
})
export type ExecutionBlueprint = z.infer<typeof executionBlueprintSchema>

export const taskBlueprintRecordSchema = z.object({
  taskId: z.string().min(1),
  version: z.number().int().positive(),
  status: blueprintStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  blueprint: executionBlueprintSchema,
  keyframeManifestPath: z.string().nullable().optional(),
})
export type TaskBlueprintRecord = z.infer<typeof taskBlueprintRecordSchema>

export const blueprintReviewDecisionSchema = z.enum(["approved", "rejected"])
export type BlueprintReviewDecision = z.infer<typeof blueprintReviewDecisionSchema>

export const taskBlueprintReviewRecordSchema = z.object({
  taskId: z.string().min(1),
  blueprintVersion: z.number().int().positive(),
  decision: blueprintReviewDecisionSchema,
  note: z.string().trim().min(1).nullable().optional(),
  decidedAt: z.string().min(1),
})
export type TaskBlueprintReviewRecord = z.infer<typeof taskBlueprintReviewRecordSchema>

export const projectRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().trim().nullable().optional(),
  brandDirection: z.string().trim().nullable().optional(),
  defaultChannelIds: z.array(z.string().min(1)).default([]),
  reusableStyleConstraints: z.array(z.string().min(1)).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})
export type ProjectRecord = z.infer<typeof projectRecordSchema>

export const projectApprovedBlueprintRecordSchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  blueprintVersion: z.number().int().positive(),
  approvedAt: z.string().min(1),
  blueprint: executionBlueprintSchema,
})
export type ProjectApprovedBlueprintRecord = z.infer<typeof projectApprovedBlueprintRecordSchema>
