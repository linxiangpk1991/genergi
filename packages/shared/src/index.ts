import { z } from "zod"

export type AppId = "web" | "api" | "worker"

export const productionModeSchema = z.enum(["mass_production", "high_quality"])
export type ProductionModeId = z.infer<typeof productionModeSchema>

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

export const modelRefSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
})
export type ModelRef = z.infer<typeof modelRefSchema>

export const taskRunConfigSchema = z.object({
  modeId: productionModeSchema,
  channelId: channelProfileSchema,
  textModel: modelRefSchema,
  imageDraftModel: modelRefSchema,
  imageFinalModel: modelRefSchema,
  videoDraftModel: modelRefSchema,
  videoFinalModel: modelRefSchema,
  ttsProvider: z.string(),
  contentLocale: z.literal("en"),
  operatorLocale: z.literal("zh-CN"),
  requireStoryboardReview: z.boolean(),
  requireKeyframeReview: z.boolean(),
  budgetLimitCny: z.number().nonnegative(),
  aspectRatio: z.string(),
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
  title: z.string(),
  modeId: productionModeSchema,
  channelId: channelProfileSchema,
  status: taskStatusSchema,
  progressPct: z.number().min(0).max(100),
  retryCount: z.number().int().nonnegative(),
  estimatedCostCny: z.number().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type TaskSummary = z.infer<typeof taskSummarySchema>

export const storyboardSceneSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  title: z.string(),
  script: z.string(),
  imagePrompt: z.string(),
  videoPrompt: z.string(),
  durationSec: z.number().positive(),
  startLabel: z.string(),
  endLabel: z.string(),
  reviewStatus: z.enum(["pending", "approved", "rejected"]),
  keyframeStatus: z.enum(["pending", "approved", "rejected"]),
})
export type StoryboardScene = z.infer<typeof storyboardSceneSchema>

export const taskDetailSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  script: z.string(),
  taskRunConfig: taskRunConfigSchema,
  scenes: z.array(storyboardSceneSchema),
  updatedAt: z.string(),
})
export type TaskDetail = z.infer<typeof taskDetailSchema>

export const assetRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  assetType: z.enum(["script", "storyboard", "subtitles", "audio", "keyframe_bundle", "video_bundle"]),
  label: z.string(),
  status: z.enum(["ready", "pending"]),
  path: z.string(),
  createdAt: z.string(),
})
export type AssetRecord = z.infer<typeof assetRecordSchema>

export const createTaskInputSchema = z.object({
  title: z.string().min(1),
  script: z.string().min(1),
  modeId: productionModeSchema,
  channelId: channelProfileSchema,
  aspectRatio: z.string().default("9:16"),
})
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>

export interface HealthSnapshot {
  app: AppId
  status: "ok" | "degraded"
  message: string
}

export const TASK_QUEUE_NAME = "genergi-tasks"

export * from "./task-persistence.js"
