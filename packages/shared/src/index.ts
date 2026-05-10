import { z } from "zod"
import {
  enhancementModeSchema,
  generationModeSchema,
  generationRouteSchema,
  planningVersionSchema,
} from "./generation-route.js"
import {
  modelSlotTypeSchema,
  resolvedSlotSnapshotSchema,
  taskModelOverrideSchema,
} from "./model-control.js"
import {
  blueprintStatusSchema,
  executionBlueprintSchema,
  executionModeSchema,
  projectApprovedBlueprintRecordSchema,
  blueprintQualityFeedbackSlotSchema,
  blueprintQualityIssueCategorySchema,
  projectRecordSchema,
  renderSpecSchema,
  taskBlueprintQualityFeedbackRecordSchema,
  taskBlueprintRecordSchema,
  taskBlueprintReviewRecordSchema,
  terminalPresetIdSchema,
} from "./video-blueprint.js"
import {
  bilingualUnderstandingPreviewSchema,
  englishExecutionBriefSchema,
} from "./understanding-preview.js"

export type AppId = "web" | "api" | "worker"

export const productionModeSchema = z.enum(["mass_production", "high_quality"])
export type ProductionModeId = z.infer<typeof productionModeSchema>

export const videoDurationSecSchema = z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)])
export type VideoDurationSec = z.infer<typeof videoDurationSecSchema>

export const channelProfileSchema = z.enum(["tiktok", "reels", "shorts"])
export type ChannelProfileId = z.infer<typeof channelProfileSchema>

export const audioStrategySchema = z.enum(["tts_only", "native_plus_tts_ducked"])
export type AudioStrategy = z.infer<typeof audioStrategySchema>

export const subtitleStrategySchema = z.enum(["tts_aligned", "whisper_cpp"])
export type SubtitleStrategy = z.infer<typeof subtitleStrategySchema>

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

export const retryRequestScopeSchema = z.enum(["task", "scene", "keyframe", "video"])
export type RetryRequestScope = z.infer<typeof retryRequestScopeSchema>

export const retryRequestStatusSchema = z.enum(["pending", "accepted", "enqueue_failed", "rejected"])
export type RetryRequestStatus = z.infer<typeof retryRequestStatusSchema>

export const retryRequestQueueMetadataSchema = z.object({
  queued: z.boolean(),
  jobId: z.string().nullable(),
  reason: z.string(),
  continueExecution: z.boolean(),
  blueprintVersion: z.number().int().nonnegative().nullable(),
  stage: z.string().nullable(),
  resumeFrom: z.string().nullable(),
})
export type RetryRequestQueueMetadata = z.infer<typeof retryRequestQueueMetadataSchema>

export const retryRequestSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  scope: retryRequestScopeSchema,
  sceneId: z.string().nullable(),
  sceneIndex: z.number().int().nonnegative().nullable(),
  sceneTitle: z.string().nullable(),
  reason: z.string().nullable(),
  status: retryRequestStatusSchema,
  statusDetail: z.string().nullable(),
  taskStatusAtRequest: taskStatusSchema,
  queue: retryRequestQueueMetadataSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type RetryRequest = z.infer<typeof retryRequestSchema>
export type RetryRequestInput = Omit<RetryRequest, "id" | "taskId">

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

export const taskRuntimeTraceSchema = z.object({
  currentStage: z.string().nullable().optional(),
  currentStageLabel: z.string().nullable().optional(),
  currentSceneIndex: z.number().int().nonnegative().nullable().optional(),
  currentSceneTotal: z.number().int().nonnegative().nullable().optional(),
  stageStartedAt: z.string().nullable().optional(),
  lastHeartbeatAt: z.string().nullable().optional(),
  workerId: z.string().nullable().optional(),
  activeJobId: z.string().nullable().optional(),
})
export type TaskRuntimeTrace = z.infer<typeof taskRuntimeTraceSchema>

export const taskArchiveStateSchema = z.object({
  archivedAt: z.string().nullable().optional(),
  archivedBy: z.string().nullable().optional(),
  archiveReason: z.string().nullable().optional(),
  archiveOperationId: z.string().nullable().optional(),
})
export type TaskArchiveState = z.infer<typeof taskArchiveStateSchema>

export const taskOperationTypeSchema = z.enum([
  "bulk_archive",
  "bulk_restore",
  "bulk_delete_task_with_assets",
  "bulk_delete_assets_only",
  "bulk_cancel",
  "bulk_resume",
])
export type TaskOperationType = z.infer<typeof taskOperationTypeSchema>

export const taskOperationAuditRecordSchema = z.object({
  id: z.string(),
  operationId: z.string(),
  operationType: taskOperationTypeSchema,
  actorId: z.string(),
  resourceType: z.literal("task"),
  resourceId: z.string(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  result: z.enum(["success", "skipped", "failed"]),
  reason: z.string().nullable(),
  message: z.string().nullable(),
  createdAt: z.string(),
})
export type TaskOperationAuditRecord = z.infer<typeof taskOperationAuditRecordSchema>

export const taskTimelineLevelSchema = z.enum(["info", "warning", "error"])
export type TaskTimelineLevel = z.infer<typeof taskTimelineLevelSchema>

export const taskTimelineTypeSchema = z.enum(["stage", "provider", "error"])
export type TaskTimelineType = z.infer<typeof taskTimelineTypeSchema>

export const taskTimelineProviderAuditSchema = z.object({
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  request: z.record(z.string(), z.unknown()).optional(),
  response: z.record(z.string(), z.unknown()).optional(),
  error: z.string().nullable().optional(),
})
export type TaskTimelineProviderAudit = z.infer<typeof taskTimelineProviderAuditSchema>

export const taskTimelineEventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  sequence: z.number().int().positive(),
  type: taskTimelineTypeSchema,
  stage: z.string(),
  label: z.string(),
  level: taskTimelineLevelSchema.default("info"),
  summary: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  provider: taskTimelineProviderAuditSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
})
export type TaskTimelineEvent = z.infer<typeof taskTimelineEventSchema>
export type TaskTimelineEventInput = Omit<TaskTimelineEvent, "id" | "taskId" | "sequence" | "createdAt">

export const modelSmokeModeSchema = z.enum(["config", "connectivity", "minimal_generation"])
export type ModelSmokeMode = z.infer<typeof modelSmokeModeSchema>

export const modelDiagnosticStatusSchema = z.enum(["success", "failed", "skipped"])
export type ModelDiagnosticStatus = z.infer<typeof modelDiagnosticStatusSchema>

export const modelDiagnosticErrorCategorySchema = z.enum([
  "auth_error",
  "quota_exceeded",
  "model_not_found",
  "request_format_incompatible",
  "timeout",
  "empty_result",
  "safety_refusal",
  "provider_error",
  "worker_local_failure",
  "config_error",
  "unknown",
])
export type ModelDiagnosticErrorCategory = z.infer<typeof modelDiagnosticErrorCategorySchema>

export const modelDiagnosticRecordSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  providerDisplayName: z.string(),
  providerType: z.string(),
  modelId: z.string().nullable(),
  modelDisplayName: z.string().nullable(),
  slotType: modelSlotTypeSchema.nullable(),
  providerModelId: z.string().nullable(),
  transport: z.string(),
  wireApi: z.string(),
  requestPath: z.string(),
  smokeMode: modelSmokeModeSchema,
  status: modelDiagnosticStatusSchema,
  statusCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  errorCategory: modelDiagnosticErrorCategorySchema.nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
})
export type ModelDiagnosticRecord = z.infer<typeof modelDiagnosticRecordSchema>
export type ModelDiagnosticRecordInput = Omit<ModelDiagnosticRecord, "id" | "createdAt">

export const modelRefSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
})
export type ModelRef = z.infer<typeof modelRefSchema>

export const keyframeGenerationModeSchema = z.enum(["batch", "single"])
export type KeyframeGenerationMode = z.infer<typeof keyframeGenerationModeSchema>

export const taskRunConfigSchema = z.object({
  projectId: z.string().min(1),
  modeId: productionModeSchema,
  executionMode: executionModeSchema.default("automated"),
  channelId: channelProfileSchema,
  terminalPresetId: terminalPresetIdSchema.default("phone_portrait"),
  renderSpecJson: renderSpecSchema,
  targetDurationSec: videoDurationSecSchema,
  generationMode: generationModeSchema,
  visualSeedInput: z.string().trim().max(4000).nullable().default(null),
  keepCharacterConsistent: z.boolean().default(true),
  keyframeGenerationMode: keyframeGenerationModeSchema.default("batch"),
  keyframeCount: z.number().int().positive().default(2),
  understandingPreview: bilingualUnderstandingPreviewSchema.nullable().default(null),
  executionBrief: englishExecutionBriefSchema.nullable().default(null),
  executionBriefVersion: z.literal("execution-brief-v1").default("execution-brief-v1"),
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
  audioStrategy: audioStrategySchema.default("tts_only"),
  subtitleStrategy: subtitleStrategySchema.default("tts_aligned"),
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
  visualSeedInput: z.string().trim().max(4000).nullable().default(null),
  keepCharacterConsistent: z.boolean().default(true),
  keyframeGenerationMode: keyframeGenerationModeSchema.default("batch"),
  keyframeCount: z.number().int().positive().default(2),
  understandingPreview: bilingualUnderstandingPreviewSchema.nullable().default(null),
  executionBrief: englishExecutionBriefSchema.nullable().default(null),
  executionBriefVersion: z.literal("execution-brief-v1").default("execution-brief-v1"),
  generationRoute: generationRouteSchema,
  routeReason: z.string(),
  planningVersion: planningVersionSchema,
  blueprintVersion: z.number().int().nonnegative().default(0),
  blueprintStatus: blueprintStatusSchema.default("pending_generation"),
  audioStrategy: audioStrategySchema.default("tts_only"),
  subtitleStrategy: subtitleStrategySchema.default("tts_aligned"),
  actualDurationSec: z.number().positive().nullable(),
  failureReason: z.string().nullable().optional(),
  statusDetail: z.string().nullable().optional(),
  cancelRequestedAt: z.string().nullable().optional(),
  status: taskStatusSchema,
  progressPct: z.number().min(0).max(100),
  retryCount: z.number().int().nonnegative(),
  estimatedCostCny: z.number().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).extend(reviewSummarySchema.shape).extend(taskRuntimeTraceSchema.shape).extend(taskArchiveStateSchema.shape)
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
  failureReason: z.string().nullable().optional(),
  statusDetail: z.string().nullable().optional(),
  cancelRequestedAt: z.string().nullable().optional(),
  scenes: z.array(storyboardSceneSchema),
  updatedAt: z.string(),
}).extend(reviewSummarySchema.shape).extend(taskRuntimeTraceSchema.shape).extend(taskArchiveStateSchema.shape)
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
    "visual_plan",
    "keyframe_prompt_summary",
    "storyboard",
    "subtitles",
    "audio",
    "keyframe_bundle",
    "keyframe_image",
    "scene_video",
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
  modeId: productionModeSchema.default("high_quality"),
  channelId: channelProfileSchema.default("tiktok"),
  terminalPresetId: terminalPresetIdSchema.default("phone_portrait"),
  aspectRatio: z.string().default("9:16"),
  targetDurationSec: videoDurationSecSchema.default(30),
  generationMode: generationModeSchema.default("user_locked"),
  visualSeedInput: z.string().trim().max(4000).nullable().optional(),
  keepCharacterConsistent: z.boolean().default(true),
  keyframeGenerationMode: keyframeGenerationModeSchema.default("batch"),
  keyframeCount: z.number().int().positive().optional(),
  understandingPreview: bilingualUnderstandingPreviewSchema.nullable().optional(),
  executionBrief: englishExecutionBriefSchema.nullable().optional(),
  audioStrategy: audioStrategySchema.default("tts_only"),
  subtitleStrategy: subtitleStrategySchema.default("tts_aligned"),
  modelOverrides: taskModelOverrideSchema.optional(),
})
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>

export const userStatusSchema = z.enum(["active", "disabled"])
export type UserStatus = z.infer<typeof userStatusSchema>

export const userSourceSchema = z.enum(["file", "env"])
export type UserSource = z.infer<typeof userSourceSchema>

export const userPurposeSchema = z.enum(["operator", "test_operator"])
export type UserPurpose = z.infer<typeof userPurposeSchema>

export const storedUserSchema = z.object({
  id: z.string(),
  username: z.string().min(1),
  displayName: z.string().min(1),
  passwordHash: z.string().min(1),
  status: userStatusSchema,
  purpose: userPurposeSchema.optional(),
  expiresAt: z.string().nullable().optional(),
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
export * from "./model-routing.js"
export * from "./provider-model-ids.js"
export * from "./understanding-preview.js"
export * from "./video-blueprint.js"
export * from "./blueprint-persistence.js"
