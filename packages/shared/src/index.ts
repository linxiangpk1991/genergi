import { z } from "zod"
import {
  enhancementModeSchema,
  generationModeSchema,
  generationRouteSchema,
  planningVersionSchema,
} from "./generation-route.js"
import {
  resolvedSlotSnapshotSchema,
  taskModelOverrideSchema,
} from "./model-control.js"
import {
  blueprintStatusSchema,
  executionBlueprintSchema,
  executionModeSchema,
  projectApprovedBlueprintRecordSchema,
  projectRecordSchema,
  renderSpecSchema,
  taskBlueprintRecordSchema,
  taskBlueprintReviewRecordSchema,
  terminalPresetIdSchema,
} from "./video-blueprint.js"

export type AppId = "web" | "api" | "worker"

export const productionModeSchema = z.enum(["mass_production", "high_quality"])
export type ProductionModeId = z.infer<typeof productionModeSchema>

export const videoDurationSecSchema = z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)])
export type VideoDurationSec = z.infer<typeof videoDurationSecSchema>

export const channelProfileSchema = z.enum(["tiktok", "reels", "shorts"])
export type ChannelProfileId = z.infer<typeof channelProfileSchema>

export const taskStatusSchema = z.enum([
  "draft",
  "queued",
  "running",
  "waiting_review",
  "paused",
  "failed",
  "completed",
  "canceled",
])
export type TaskStatus = z.infer<typeof taskStatusSchema>

export const reviewStageSchema = z.enum([
  "storyboard_review",
  "keyframe_review",
  "auto_qa",
])
export type ReviewStageId = z.infer<typeof reviewStageSchema>

export const reviewDecisionStageSchema = z.enum([
  reviewStageSchema.enum.storyboard_review,
  reviewStageSchema.enum.keyframe_review,
])
export type ReviewDecisionStageId = z.infer<typeof reviewDecisionStageSchema>

export const reviewDecisionStatusSchema = z.enum(["approved", "rejected"])
export type ReviewDecisionStatus = z.infer<typeof reviewDecisionStatusSchema>

export const reviewDecisionInputSchema = z.object({
  stage: reviewDecisionStageSchema,
  sceneId: z.string().min(1),
  decision: reviewDecisionStatusSchema,
  note: z.string().trim().min(1).optional(),
})
export type ReviewDecisionInput = z.infer<typeof reviewDecisionInputSchema>

export const reviewDecisionBodySchema = z.object({
  decision: reviewDecisionStatusSchema,
  note: z.string().trim().min(1).optional(),
})
export type ReviewDecisionBody = z.infer<typeof reviewDecisionBodySchema>

export const reviewSummarySchema = z.object({
  reviewStage: reviewStageSchema.nullable().optional(),
  pendingReviewCount: z.number().int().nonnegative().optional(),
  reviewUpdatedAt: z.string().nullable().optional(),
})
export type ReviewSummary = z.infer<typeof reviewSummarySchema>

export const modelRefSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
})
export type ModelRef = z.infer<typeof modelRefSchema>

export const taskRunConfigSchema = z.object({
  projectId: z.string().min(1),
  modeId: productionModeSchema,
  executionMode: executionModeSchema.default("automated"),
  channelId: channelProfileSchema,
  terminalPresetId: terminalPresetIdSchema.default("phone_portrait"),
  renderSpecJson: renderSpecSchema,
  targetDurationSec: videoDurationSecSchema,
  generationMode: generationModeSchema,
  enhancementMode: enhancementModeSchema,
  generationRoute: generationRouteSchema,
  routeReason: z.string(),
  planningVersion: planningVersionSchema,
  blueprintVersion: z.number().int().nonnegative().default(0),
  blueprintStatus: blueprintStatusSchema.default("pending_generation"),
  textModel: modelRefSchema,
  imageModel: modelRefSchema,
  videoModel: modelRefSchema,
  ttsProvider: z.string(),
  contentLocale: z.literal("en"),
  operatorLocale: z.literal("zh-CN"),
  requireStoryboardReview: z.boolean(),
  requireKeyframeReview: z.boolean(),
  budgetLimitCny: z.number().nonnegative(),
  aspectRatio: z.string(),
  slotSnapshots: z.array(resolvedSlotSnapshotSchema).default([]),
  modelOverrides: taskModelOverrideSchema.optional(),
})
export type TaskRunConfig = z.infer<typeof taskRunConfigSchema>

export const costEstimateSchema = z.object({
  estimatedMinutes: z.number().nonnegative(),
  estimatedScenes: z.number().int().nonnegative(),
  estimatedVideoScenes: z.number().int().nonnegative(),
  estimatedCredits: z.number().nonnegative(),
  budgetUsagePct: z.number().min(0).max(100),
})
export type CostEstimate = z.infer<typeof costEstimateSchema>

export const taskSummarySchema = z.object({
  id: z.string(),
  projectId: z.string().min(1),
  title: z.string(),
  modeId: productionModeSchema,
  executionMode: executionModeSchema.default("automated"),
  channelId: channelProfileSchema,
  terminalPresetId: terminalPresetIdSchema.default("phone_portrait"),
  renderSpecJson: renderSpecSchema,
  targetDurationSec: videoDurationSecSchema,
  generationMode: generationModeSchema,
  generationRoute: generationRouteSchema,
  routeReason: z.string(),
  planningVersion: planningVersionSchema,
  blueprintVersion: z.number().int().nonnegative().default(0),
  blueprintStatus: blueprintStatusSchema.default("pending_generation"),
  actualDurationSec: z.number().positive().nullable(),
  status: taskStatusSchema,
  progressPct: z.number().min(0).max(100),
  retryCount: z.number().int().nonnegative(),
  estimatedCostCny: z.number().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).extend(reviewSummarySchema.shape)
export type TaskSummary = z.infer<typeof taskSummarySchema>

export const storyboardSceneSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  title: z.string(),
  sceneGoal: z.string().optional(),
  voiceoverScript: z.string().optional(),
  startFrameDescription: z.string().optional(),
  script: z.string(),
  imagePrompt: z.string(),
  videoPrompt: z.string(),
  startFrameIntent: z.string().optional(),
  endFrameIntent: z.string().optional(),
  durationSec: z.number().positive(),
  startLabel: z.string(),
  endLabel: z.string(),
  reviewStatus: z.enum(["pending", "approved", "rejected"]),
  keyframeStatus: z.enum(["pending", "approved", "rejected"]),
  continuityConstraints: z.array(z.string()).optional(),
  reviewNote: z.string().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  keyframeReviewNote: z.string().nullable().optional(),
  keyframeReviewedAt: z.string().nullable().optional(),
})
export type StoryboardScene = z.infer<typeof storyboardSceneSchema>

export const taskDetailSchema = z.object({
  taskId: z.string(),
  projectId: z.string().min(1),
  title: z.string(),
  script: z.string(),
  taskRunConfig: taskRunConfigSchema,
  blueprintVersion: z.number().int().nonnegative().default(0),
  blueprintStatus: blueprintStatusSchema.default("pending_generation"),
  visualStyleGuide: z.string().optional(),
  ctaLine: z.string().optional(),
  actualDurationSec: z.number().positive().nullable().optional(),
  scenes: z.array(storyboardSceneSchema),
  updatedAt: z.string(),
}).extend(reviewSummarySchema.shape)
export type TaskDetail = z.infer<typeof taskDetailSchema>

export const assetRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  assetType: z.enum([
    "script",
    "source_script",
    "planning_prompt",
    "planning_response",
    "planning_audit",
    "storyboard",
    "subtitles",
    "audio",
    "keyframe_bundle",
    "keyframe_image",
    "video_bundle",
  ]),
  label: z.string(),
  status: z.enum(["ready", "pending"]),
  path: z.string(),
  createdAt: z.string(),
})
export type AssetRecord = z.infer<typeof assetRecordSchema>

export const createTaskInputSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  script: z.string().min(1),
  modeId: productionModeSchema,
  channelId: channelProfileSchema,
  terminalPresetId: terminalPresetIdSchema.default("phone_portrait"),
  aspectRatio: z.string().default("9:16"),
  targetDurationSec: videoDurationSecSchema.default(30),
  generationMode: generationModeSchema.default("user_locked"),
  modelOverrides: taskModelOverrideSchema.optional(),
})
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>

export const userStatusSchema = z.enum(["active", "disabled"])
export type UserStatus = z.infer<typeof userStatusSchema>

export const userSourceSchema = z.enum(["file", "env"])
export type UserSource = z.infer<typeof userSourceSchema>

export const storedUserSchema = z.object({
  id: z.string(),
  username: z.string().min(1),
  displayName: z.string().min(1),
  passwordHash: z.string().min(1),
  status: userStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastLoginAt: z.string().nullable(),
})
export type StoredUser = z.infer<typeof storedUserSchema>

export const publicUserSchema = storedUserSchema
  .omit({
    passwordHash: true,
    createdAt: true,
    updatedAt: true,
    lastLoginAt: true,
  })
  .extend({
    source: userSourceSchema,
  })
export type PublicUser = z.infer<typeof publicUserSchema>

export const createUserInputSchema = z.object({
  username: z.string().min(1),
  displayName: z.string().min(1).optional(),
  password: z.string().min(1),
  status: userStatusSchema.optional(),
  rememberPassword: z.boolean().optional(),
})
export type CreateUserInput = z.infer<typeof createUserInputSchema>

export const updateUserInputSchema = z.object({
  username: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  status: userStatusSchema.optional(),
})
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>

export const resetUserPasswordInputSchema = z.object({
  password: z.string().min(1),
  rememberPassword: z.boolean().optional(),
})
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordInputSchema>

export interface HealthSnapshot {
  app: AppId
  status: "ok" | "degraded"
  message: string
}

export const TASK_QUEUE_NAME = "genergi-tasks"

export * from "./task-persistence.js"
export * from "./storyboard-planner.js"
export * from "./generation-route.js"
export * from "./planning-contract.js"
export * from "./model-control.js"
export * from "./provider-model-ids.js"
export * from "./video-blueprint.js"
export * from "./blueprint-persistence.js"
