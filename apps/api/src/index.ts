import fs from "node:fs/promises"
import path from "node:path"
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto"
import { serve } from "@hono/node-server"
import { zValidator } from "@hono/zod-validator"
import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import { z } from "zod"
import {
  BRAND,
  CHANNELS,
  GENERATION_PREFERENCES,
  MODE_MODELS,
  VIDEO_DURATION_PRESETS,
  resolveVideoModelCapability,
} from "@genergi/config"
import {
  blueprintReviewDecisionSchema,
  plannedExecutionBlueprintSchema,
  audioStrategySchema,
  createTaskInputSchema,
  createUserInputSchema,
  normalizeImageProviderModelId,
  normalizeVideoProviderModelId,
  readModelDefaults,
  readModelRecords,
  readProviderRecords,
  readRuntimeStatus,
  appendTaskRetryRequest,
  readTaskTimeline,
  readTaskRetryRequests,
  replaceModelDefaults,
  replaceModelRecords,
  replaceProviderRecords,
  resetUserPasswordInputSchema,
  updateTaskRetryRequest,
  updateRuntimeStatus,
  updateUserInputSchema,
} from "@genergi/shared"
import { clearSession, getAuthStatus, getSessionUser, loginWithPassword, requireAuth } from "./lib/auth.js"
import { assertQueueAvailable, cancelTaskJobs, enqueueTask, inspectTaskJobs, QueueUnavailableError, recoverTaskJobs } from "./lib/queue/enqueue.js"
import {
  cancelTask,
  createTask,
  deleteTask,
  deleteTaskAsset,
  deleteTaskAssetCollection,
  deleteTaskWithAssets,
  getTaskAsset,
  getTaskAssets,
  getTaskDetail,
  listTasks,
  markTaskRetryPending,
  resumeFailedTask,
  restoreTaskState,
  updateTaskAudioStrategy,
} from "./lib/task-store.js"
import {
  approveTaskBlueprint,
  createTaskBlueprintVersion,
  getCurrentTaskBlueprint,
  getTaskBlueprintByVersion,
  getLatestTaskBlueprintReview,
  listTaskBlueprints,
  recordTaskBlueprintReview,
  queueTaskBlueprintForVideo,
  rejectTaskBlueprint,
} from "./lib/blueprint-store.js"
import { createProject, listProjectApprovedBlueprints, listProjects } from "./lib/project-store.js"
import {
  createStoredUser,
  getEnvFallbackUser,
  findStoredUserById,
  listUsers,
  toPublicUser,
  updateStoredUser,
  updateStoredUserPassword,
} from "./lib/user-store.js"

export const app = new Hono()
app.use("*", cors())
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})
const createProjectInputSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  brandDirection: z.string().trim().optional(),
  defaultChannelIds: z.array(z.string().trim().min(1)).optional(),
  reusableStyleConstraints: z.array(z.string().trim().min(1)).optional(),
})
const createBlueprintInputSchema = z.object({
  blueprint: plannedExecutionBlueprintSchema.omit({
    executionMode: true,
    renderSpec: true,
  }),
  keyframeManifestPath: z.string().trim().min(1).optional(),
})
const STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000
const taskAudioStrategyBodySchema = z.object({
  audioStrategy: audioStrategySchema,
})
const retryTaskBodySchema = z.object({
  scope: z.enum(["task", "scene", "keyframe", "video"]).optional(),
  sceneId: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
})
const blueprintReviewBodySchema = z.object({
  decision: blueprintReviewDecisionSchema,
  note: z.string().trim().min(1).optional(),
})

function requireAuthNamespace(prefix: string) {
  app.use(prefix, requireAuth())
  app.use(`${prefix}/*`, requireAuth())
}

type TaskPlanningSnapshot = {
  generationPreference: "user_locked" | "system_enhanced"
  generationPreferenceLabel: string
  generationRoute: "single_shot" | "multi_scene"
  generationRouteLabel: string
  targetDurationSec: number
  sceneCount: number
  planningSummary: string
  planningKeywords: string[]
  planningSourceLabel: string
  routeReason: string
}

const taskPlanningState = new Map<string, TaskPlanningSnapshot>()

function getSceneCountHint(targetDurationSec: number) {
  if (targetDurationSec <= 15) {
    return 3
  }

  if (targetDurationSec <= 30) {
    return 5
  }

  if (targetDurationSec <= 45) {
    return 7
  }

  return 8
}

function getGenerationPreferenceMeta(generationPreference: "user_locked" | "system_enhanced") {
  return (
    GENERATION_PREFERENCES.find((item) => item.id === generationPreference) ?? GENERATION_PREFERENCES[0]
  )
}

function getGenerationRouteLabel(route: "single_shot" | "multi_scene") {
  return route === "single_shot" ? "单段直出" : "多分镜编排"
}

function buildPlanningSummary(
  generationRoute: "single_shot" | "multi_scene",
  generationPreference: "user_locked" | "system_enhanced",
  routeReason: string,
) {
  const routeSummary =
    generationRoute === "single_shot"
      ? "当前按单段直出预判，优先保证内容连贯性。"
      : "当前按多分镜编排预判，优先保证节奏展开与镜头切换。"

  const preferenceMeta = getGenerationPreferenceMeta(generationPreference)

  return `${routeSummary} · ${preferenceMeta.description} · ${routeReason}`
}

function buildPlanningSnapshot(
  targetDurationSec: number,
  sceneCount: number,
  generationPreference: "user_locked" | "system_enhanced",
  generationRoute: "single_shot" | "multi_scene",
  routeReason: string,
  sourceLabel = "任务持久化",
): TaskPlanningSnapshot {
  const generationPreferenceMeta = getGenerationPreferenceMeta(generationPreference)
  return {
    generationPreference,
    generationPreferenceLabel: generationPreferenceMeta.label,
    generationRoute,
    generationRouteLabel: getGenerationRouteLabel(generationRoute),
    targetDurationSec,
    sceneCount,
    planningSummary: buildPlanningSummary(generationRoute, generationPreference, routeReason),
    planningKeywords: generationPreferenceMeta.keywords,
    planningSourceLabel: sourceLabel,
    routeReason,
  }
}

function enrichSummary(task: Awaited<ReturnType<typeof listTasks>>[number]) {
  const cached = taskPlanningState.get(task.id)
  const planning =
    cached ??
    buildPlanningSnapshot(
      task.targetDurationSec,
      getSceneCountHint(task.targetDurationSec),
      task.generationMode,
      task.generationRoute,
      task.routeReason,
    )
  return { ...task, planning }
}

function enrichDetail(detail: NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>) {
  const cached = taskPlanningState.get(detail.taskId)
  const planning =
    cached ??
    buildPlanningSnapshot(
      detail.taskRunConfig.targetDurationSec,
      detail.scenes.length,
      detail.taskRunConfig.generationMode,
      detail.taskRunConfig.generationRoute,
      detail.taskRunConfig.routeReason,
    )
  return { ...detail, planning }
}

function getLivenessTimestamp(
  task: Awaited<ReturnType<typeof listTasks>>[number],
  detail: NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>,
) {
  const heartbeat = detail.lastHeartbeatAt ?? task.lastHeartbeatAt ?? null
  if (heartbeat) {
    return heartbeat
  }

  const timestamps = [task.updatedAt, detail.updatedAt]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort((left, right) => Date.parse(right) - Date.parse(left))
  return timestamps[0] ?? null
}

function looksLikeRunningGeneration(
  task: Awaited<ReturnType<typeof listTasks>>[number],
  detail: NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>,
) {
  if (task.status === "completed" || task.status === "failed" || task.status === "canceled") {
    return false
  }

  const statusDetail = `${task.statusDetail ?? detail.statusDetail ?? ""}`
  const currentStage = `${detail.currentStage ?? task.currentStage ?? ""}`
  return (
    task.status === "running" ||
    Boolean(currentStage && !["completed", "canceled", "failed", "waiting_review"].includes(currentStage)) ||
    statusDetail.includes("生成") ||
    statusDetail.includes("合成") ||
    statusDetail.includes("准备") ||
    statusDetail.includes("复用")
  )
}

function getStaleRunningInfo(
  task: Awaited<ReturnType<typeof listTasks>>[number],
  detail: NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>,
) {
  const sourceUpdatedAt = getLivenessTimestamp(task, detail)
  const updatedAtMs = sourceUpdatedAt ? Date.parse(sourceUpdatedAt) : Number.NaN
  const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : null
  const isStale =
    looksLikeRunningGeneration(task, detail) &&
    ageMs !== null &&
    ageMs >= STALE_RUNNING_THRESHOLD_MS

  return {
    isStale,
    thresholdMs: STALE_RUNNING_THRESHOLD_MS,
    ageMs,
    sourceUpdatedAt,
  }
}

async function buildTaskDiagnostics(
  task: Awaited<ReturnType<typeof listTasks>>[number],
  detail: NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>,
) {
  const stale = getStaleRunningInfo(task, detail)
  const assets = await getTaskAssets(task.id)
  const readyAssets = assets.filter((asset) => asset.exists && asset.status === "ready")
  const deliverableAssetTypes = new Set(["video_bundle", "subtitles", "script", "audio"])
  const deliverableReadyCount = readyAssets.filter((asset) => deliverableAssetTypes.has(asset.assetType)).length
  const expectedNextAssetType =
    !readyAssets.some((asset) => asset.assetType === "keyframe_bundle")
      ? "keyframe_bundle"
      : !readyAssets.some((asset) => asset.assetType === "video_bundle")
        ? "video_bundle"
        : !readyAssets.some((asset) => asset.assetType === "subtitles")
          ? "subtitles"
          : null

  let queue:
    | {
        available: true
        activeJobIds: string[]
        waitingJobIds: string[]
        delayedJobIds: string[]
        prioritizedJobIds: string[]
        pausedJobIds: string[]
        failedJobIds: string[]
      }
    | {
        available: false
        activeJobIds: string[]
        waitingJobIds: string[]
        delayedJobIds: string[]
        prioritizedJobIds: string[]
        pausedJobIds: string[]
        failedJobIds: string[]
        unavailableReason: string
      }

  try {
    const jobs = await inspectTaskJobs(task.id)
    queue = {
      available: true,
      activeJobIds: jobs.active,
      waitingJobIds: jobs.waiting,
      delayedJobIds: jobs.delayed,
      prioritizedJobIds: jobs.prioritized,
      pausedJobIds: jobs.paused,
      failedJobIds: jobs.failed,
    }
  } catch (error) {
    queue = {
      available: false,
      activeJobIds: [],
      waitingJobIds: [],
      delayedJobIds: [],
      prioritizedJobIds: [],
      pausedJobIds: [],
      failedJobIds: [],
      unavailableReason: error instanceof Error ? error.message : String(error),
    }
  }

  const recoveryReason =
    task.status === "failed"
      ? "failed_task"
      : stale.isStale
        ? "stale_running_task"
        : "not_recoverable"
  const recoverable = recoveryReason !== "not_recoverable"
  const runtimeTrace = {
    currentStage: detail.currentStage ?? task.currentStage ?? null,
    currentStageLabel: detail.currentStageLabel ?? task.currentStageLabel ?? null,
    currentSceneIndex: detail.currentSceneIndex ?? task.currentSceneIndex ?? null,
    currentSceneTotal: detail.currentSceneTotal ?? task.currentSceneTotal ?? null,
    stageStartedAt: detail.stageStartedAt ?? task.stageStartedAt ?? null,
    lastHeartbeatAt: detail.lastHeartbeatAt ?? task.lastHeartbeatAt ?? null,
    workerId: detail.workerId ?? task.workerId ?? null,
    activeJobId: detail.activeJobId ?? task.activeJobId ?? null,
  }
  const operatorMessage =
    task.status === "failed"
      ? `任务失败：${task.failureReason ?? detail.failureReason ?? "请查看失败原因"}`
      : stale.isStale
        ? "worker 心跳超过 10 分钟未更新，可尝试恢复卡住任务。"
        : runtimeTrace.currentStageLabel ?? task.statusDetail ?? "任务状态正常同步中。"

  return {
    taskId: task.id,
    recoverable,
    recoveryReason,
    stale,
    queue,
    runtimeTrace,
    assets: {
      readyCount: readyAssets.length,
      missingCount: Math.max(assets.length - readyAssets.length, 0),
      deliverableReadyCount,
      deliverableTotal: deliverableAssetTypes.size,
      expectedNextAssetType,
    },
    operatorMessage,
  }
}

async function buildTaskDelivery(
  task: Awaited<ReturnType<typeof listTasks>>[number],
  detail: NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>,
) {
  const [assets, timeline, diagnostics] = await Promise.all([
    getTaskAssets(task.id),
    readTaskTimeline(task.id),
    buildTaskDiagnostics(task, detail),
  ])
  const readyAssets = assets.filter((asset) => asset.exists && asset.status === "ready")
  const readyTypes = new Set(readyAssets.map((asset) => asset.assetType))
  const expectedTypes = ["video_bundle", "subtitles", "script", "cover", "manifest"] as const
  const finalVideo = readyAssets.find((asset) => asset.assetType === "video_bundle") ?? null
  const subtitleAsset = readyAssets.find((asset) => asset.assetType === "subtitles") ?? null
  const scriptAsset =
    readyAssets.find((asset) => asset.assetType === "script") ??
    readyAssets.find((asset) => asset.assetType === "source_script") ??
    null
  const keyframeAssets = readyAssets.filter((asset) =>
    asset.assetType === "keyframe_bundle" || asset.assetType === "keyframe_image"
  )
  const sceneVideoAssets = readyAssets.filter((asset) => asset.assetType === "scene_video")
  const keyframeBundle = readyAssets.find((asset) => asset.assetType === "keyframe_bundle") ?? null
  const coverAsset = readyAssets.find((asset) => asset.assetType === "keyframe_image") ?? keyframeBundle
  const title = `${task.title} | ${task.channelId}`
  const description = detail.ctaLine?.trim()
    ? `${detail.script}\n\n${detail.ctaLine.trim()}`
    : detail.script
  const missingTypes = expectedTypes.filter((assetType) => {
    if (assetType === "cover") {
      return !coverAsset
    }
    if (assetType === "manifest") {
      return !keyframeBundle
    }
    if (assetType === "script") {
      return !scriptAsset
    }
    return !readyTypes.has(assetType)
  })
  const checks = [
    {
      key: "finalVideo",
      label: "final video / 成片",
      status: finalVideo ? "ready" : task.status === "failed" ? "failed" : "missing",
      message: finalVideo ? finalVideo.fileName : "缺少最终成片 video/final-with-audio.mp4",
      assetId: finalVideo?.id ?? null,
    },
    {
      key: "subtitles",
      label: "subtitles / 字幕",
      status: subtitleAsset ? "ready" : task.status === "failed" ? "failed" : "missing",
      message: subtitleAsset ? subtitleAsset.fileName : "缺少英文字幕文件 subtitles.srt",
      assetId: subtitleAsset?.id ?? null,
    },
    {
      key: "script",
      label: "script / 脚本",
      status: scriptAsset ? "ready" : "missing",
      message: scriptAsset ? scriptAsset.fileName : "缺少最终脚本或任务母本",
      assetId: scriptAsset?.id ?? null,
    },
    {
      key: "cover",
      label: "cover / 封面",
      status: coverAsset ? "ready" : keyframeAssets.length ? "needs_check" : "missing",
      message: coverAsset ? coverAsset.fileName : "需要从关键帧中确认发布封面",
      assetId: coverAsset?.id ?? null,
    },
    {
      key: "title",
      label: "title / 标题",
      status: title.trim() ? "ready" : "needs_check",
      message: title,
      assetId: null,
    },
    {
      key: "description",
      label: "description / 描述",
      status: description.trim() ? "ready" : "needs_check",
      message: description.trim() ? description.slice(0, 180) : "需要运营补充发布描述",
      assetId: null,
    },
    {
      key: "manifest",
      label: "manifest / 清单",
      status: keyframeBundle ? "ready" : "missing",
      message: keyframeBundle ? keyframeBundle.fileName : "缺少 keyframes/manifest.json",
      assetId: keyframeBundle?.id ?? null,
    },
  ]
  const ready = missingTypes.length === 0 && checks.every((check) => check.status === "ready")
  const failedSceneIndex = detail.currentSceneIndex ?? task.currentSceneIndex ?? null
  const failureText = `${task.failureReason ?? detail.failureReason ?? ""} ${task.statusDetail ?? detail.statusDetail ?? ""}`.toLowerCase()
  const sceneMatrix = detail.scenes.map((scene) => {
    const sceneKeyframe =
      keyframeAssets.find((asset) => asset.id.includes(scene.id) || asset.label.includes(String(scene.index + 1))) ??
      (keyframeBundle ? keyframeBundle : null)
    const sceneVideo = sceneVideoAssets.find((asset) =>
      asset.id.includes(scene.id) ||
      asset.id.includes(`scene_${scene.index + 1}`) ||
      asset.label.includes(String(scene.index + 1)) ||
      asset.fileName?.includes(`scene-${scene.index + 1}.`)
    ) ?? null
    const sceneMayBeFailed =
      task.status === "failed" &&
      (failedSceneIndex === scene.index ||
        failureText.includes(scene.id.toLowerCase()) ||
        failureText.includes(`scene ${scene.index + 1}`) ||
        failureText.includes(`scene_${scene.index + 1}`))

    return {
      sceneId: scene.id,
      index: scene.index,
      title: scene.title,
      durationSec: scene.durationSec,
      keyframe: {
        status: scene.keyframeStatus === "approved" || sceneKeyframe ? "ready" : scene.keyframeStatus === "rejected" ? "failed" : "pending",
        label: scene.keyframeStatus === "approved" || sceneKeyframe ? "关键帧就绪" : scene.keyframeStatus === "rejected" ? "关键帧驳回" : "关键帧待确认",
        message: sceneKeyframe ? sceneKeyframe.fileName : scene.keyframeReviewNote ?? "",
      },
      video: {
        status: finalVideo || sceneVideo ? "ready" : sceneMayBeFailed ? "failed" : task.status === "running" ? "pending" : "unknown",
        label: finalVideo ? "视频已合成" : sceneVideo ? "分段视频就绪" : sceneMayBeFailed ? "该段疑似失败" : task.status === "running" ? "生成中" : "待确认",
        message: sceneVideo ? sceneVideo.fileName : sceneMayBeFailed ? task.failureReason ?? detail.failureReason ?? "查看 timeline 定位失败段" : "",
      },
      review: {
        status: scene.reviewStatus === "approved" ? "ready" : scene.reviewStatus === "rejected" ? "failed" : "needs_check",
        label: scene.reviewStatus === "approved" ? "蓝图已审" : scene.reviewStatus === "rejected" ? "蓝图驳回" : "待审核",
        message: scene.reviewNote ?? "",
      },
    }
  })
  const recommendedActions = [
    ...(task.status === "failed"
      ? [
          {
            id: "retry_failed_scene",
            label: "发起局部重试",
            description: failedSceneIndex == null ? "任务失败但未定位 scene，先从 timeline 判断 keyframe/video/scene 范围。" : `优先处理 scene ${failedSceneIndex + 1} 的失败段。`,
            retryKind: "scene",
            sceneId: failedSceneIndex == null ? undefined : detail.scenes[failedSceneIndex]?.id,
          },
        ]
      : []),
    ...(missingTypes.length
      ? [
          {
            id: "inspect_missing_assets",
            label: "补齐缺失交付物",
            description: `缺少 ${missingTypes.join(", ")}，先确认资产路径是否存在，再决定恢复或重试。`,
          },
        ]
      : []),
    ...(ready
      ? [
          {
            id: "publish_ready",
            label: "进入发布复核",
            description: "交付物齐全，复制标题/描述并下载交付清单后可交给运营发布。",
          },
        ]
      : []),
  ]

  return {
    taskId: task.id,
    projectId: task.projectId,
    title: task.title,
    status: task.status,
    channelId: task.channelId,
    targetDurationSec: task.targetDurationSec,
    actualDurationSec: detail.actualDurationSec ?? task.actualDurationSec,
    renderSpecJson: detail.taskRunConfig.renderSpecJson,
    ready,
    readiness: ready ? "ready" : task.status === "failed" ? "blocked" : "pending",
    checks,
    sceneMatrix,
    recommendedActions,
    publishCopy: {
      title,
      description,
      channelId: task.channelId,
    },
    operatorMessage: ready
      ? "交付物已齐全，建议下载交付清单并做最终发布复核。"
      : task.status === "failed"
        ? diagnostics.operatorMessage
        : missingTypes.length
          ? `仍缺少 ${missingTypes.join(", ")}。`
          : "仍有待检查项，请确认发布字段和 scene 矩阵。",
    manifestUrl: `/api/tasks/${task.id}/delivery/manifest`,
    finalVideoAssetId: finalVideo?.id ?? null,
    subtitleAssetId: subtitleAsset?.id ?? null,
    scriptAssetId: scriptAsset?.id ?? null,
    keyframeAssetIds: keyframeAssets.map((asset) => asset.id),
    assetSummary: {
      readyCount: readyAssets.length,
      totalCount: assets.length,
      expectedTypes: [...expectedTypes],
      missingTypes,
    },
    scenes: detail.scenes.map((scene) => ({
      id: scene.id,
      index: scene.index,
      title: scene.title,
      durationSec: scene.durationSec,
      reviewStatus: scene.reviewStatus,
      keyframeStatus: scene.keyframeStatus,
    })),
    diagnostics,
    timelineTail: timeline.slice(-10),
    retryEndpoints: {
      keyframe: `/api/tasks/${task.id}/retry`,
      video: `/api/tasks/${task.id}/retry`,
      scene: `/api/tasks/${task.id}/retry`,
    },
    updatedAt: detail.updatedAt,
  }
}

function buildProductionLane(status: Awaited<ReturnType<typeof listTasks>>[number]["status"]) {
  if (status === "queued" || status === "draft") {
    return "queued"
  }
  if (status === "running" || status === "waiting_review" || status === "paused") {
    return "active"
  }
  return status
}

async function buildProductionSchedule() {
  const tasks = await listTasks()
  const items = await Promise.all(tasks.map(async (task) => {
    const detail = await getTaskDetail(task.id)
    const assets = await getTaskAssets(task.id)
    const readyAssets = assets.filter((asset) => asset.exists && asset.status === "ready")
    const hasFinalVideo = readyAssets.some((asset) => asset.assetType === "video_bundle")
    const hasSubtitles = readyAssets.some((asset) => asset.assetType === "subtitles")
    const hasScript = readyAssets.some((asset) => asset.assetType === "script")
    const deliveryReady = hasFinalVideo && hasSubtitles && hasScript

    return {
      taskId: task.id,
      projectId: task.projectId,
      title: task.title,
      lane: buildProductionLane(task.status),
      status: task.status,
      channelId: task.channelId,
      targetDurationSec: task.targetDurationSec,
      actualDurationSec: detail?.actualDurationSec ?? task.actualDurationSec,
      sceneCount: detail?.scenes.length ?? 0,
      progressPct: task.progressPct,
      deliveryReady,
      expectedNextAssetType:
        !readyAssets.some((asset) => asset.assetType === "keyframe_bundle")
          ? "keyframe_bundle"
          : !hasFinalVideo
            ? "video_bundle"
            : !hasSubtitles
              ? "subtitles"
              : null,
      updatedAt: task.updatedAt,
      createdAt: task.createdAt,
    }
  }))

  const lanes = items.reduce<Record<string, number>>((counts, item) => {
    counts[item.lane] = (counts[item.lane] ?? 0) + 1
    counts[item.status] = (counts[item.status] ?? 0) + 1
    return counts
  }, {
    queued: 0,
    active: 0,
    failed: 0,
    completed: 0,
    canceled: 0,
  })

  return {
    generatedAt: new Date().toISOString(),
    lanes,
    items,
  }
}

function inferRetryContinueExecution(
  task: Awaited<ReturnType<typeof listTasks>>[number],
  detail: NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>,
) {
  const recoverableFailureText = `${task.failureReason ?? detail.failureReason ?? ""} ${task.statusDetail ?? detail.statusDetail ?? ""}`
  return (
    /scene|video|keyframe|subtitle|audio|timeout|成片|视频|画面|关键帧|字幕|音频/i.test(recoverableFailureText) ||
    task.blueprintStatus === "approved" ||
    task.blueprintStatus === "queued_for_video" ||
    task.blueprintStatus === "video_generating" ||
    task.blueprintStatus === "completed" ||
    detail.blueprintStatus === "approved" ||
    detail.blueprintStatus === "queued_for_video" ||
    detail.blueprintStatus === "video_generating" ||
    detail.blueprintStatus === "completed" ||
    detail.taskRunConfig.blueprintStatus === "approved" ||
    detail.taskRunConfig.blueprintStatus === "queued_for_video" ||
    detail.taskRunConfig.blueprintStatus === "video_generating" ||
    detail.taskRunConfig.blueprintStatus === "completed"
  )
}

const modelControlSlotSchema = z.enum([
  "textModel",
  "imageModel",
  "videoModel",
  "ttsProvider",
])
type ModelControlSlot = z.infer<typeof modelControlSlotSchema>

const modelControlModeSchema = z.enum(["mass_production", "high_quality"])
type ModelControlMode = z.infer<typeof modelControlModeSchema>

const providerStatusSchema = z.enum([
  "draft",
  "validating",
  "available",
  "invalid",
  "disabled",
  "deprecated",
])
type ProviderStatus = z.infer<typeof providerStatusSchema>

const providerAuthTypeSchema = z.enum(["bearer_token", "api_key_header", "x_api_key", "custom_header", "none"])
type ProviderAuthType = z.infer<typeof providerAuthTypeSchema>

const modelLifecycleStatusSchema = z.enum([
  "draft",
  "validating",
  "available",
  "invalid",
  "disabled",
  "deprecated",
])
type ModelLifecycleStatus = z.infer<typeof modelLifecycleStatusSchema>

type SlotAssignments = Partial<Record<ModelControlSlot, string | null>>

type ModelControlProviderRecord = {
  id: string
  providerKey: string
  providerType: string
  displayName: string
  endpointUrl: string
  authType: ProviderAuthType
  encryptedSecret: string | null
  secretPreview: string | null
  status: ProviderStatus
  lastValidatedAt: string | null
  lastValidationError: string | null
  createdAt: string
  updatedAt: string
}

type ModelControlModelRecord = {
  id: string
  modelKey: string
  providerId: string
  slotType: ModelControlSlot
  providerModelId: string
  displayName: string
  capabilityJson: Record<string, unknown>
  lifecycleStatus: ModelLifecycleStatus
  lastValidatedAt: string | null
  lastValidationError: string | null
  createdAt: string
  updatedAt: string
}

type ModelControlDefaultsDocument = {
  globalDefaults: SlotAssignments
  modeDefaults: Partial<Record<ModelControlMode, SlotAssignments>>
  updatedAt: string | null
}

const slotAssignmentsSchema = z.object({
  textModel: z.string().trim().min(1).nullable().optional(),
  imageModel: z.string().trim().min(1).nullable().optional(),
  videoModel: z.string().trim().min(1).nullable().optional(),
  ttsProvider: z.string().trim().min(1).nullable().optional(),
})

const modeAssignmentsSchema = z.object({
  mass_production: slotAssignmentsSchema.optional(),
  high_quality: slotAssignmentsSchema.optional(),
})

const createProviderInputSchema = z.object({
  providerKey: z.string().trim().min(1),
  providerType: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  endpointUrl: z.string().trim().optional().default(""),
  authType: providerAuthTypeSchema,
  secret: z.string().min(1).optional(),
})

const updateProviderInputSchema = z.object({
  providerKey: z.string().trim().min(1).optional(),
  providerType: z.string().trim().min(1).optional(),
  displayName: z.string().trim().min(1).optional(),
  endpointUrl: z.string().trim().optional(),
  authType: providerAuthTypeSchema.optional(),
  secret: z.string().min(1).optional(),
  status: providerStatusSchema.optional(),
})

const createModelInputSchema = z.object({
  modelKey: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  slotType: modelControlSlotSchema,
  providerModelId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  capabilityJson: z.record(z.string(), z.unknown()).optional().default({}),
})

const updateModelInputSchema = z.object({
  modelKey: z.string().trim().min(1).optional(),
  providerId: z.string().trim().min(1).optional(),
  slotType: modelControlSlotSchema.optional(),
  providerModelId: z.string().trim().min(1).optional(),
  displayName: z.string().trim().min(1).optional(),
  capabilityJson: z.record(z.string(), z.unknown()).optional(),
  lifecycleStatus: modelLifecycleStatusSchema.optional(),
})

const updateDefaultsInputSchema = z.object({
  global: slotAssignmentsSchema.optional(),
  modes: modeAssignmentsSchema.optional(),
})

const MODEL_CONTROL_SLOTS = modelControlSlotSchema.options
const MODEL_CONTROL_MODES = modelControlModeSchema.options
const TTS_PROVIDER_TYPES = new Set(["edge-tts", "azure-tts"])

function createEmptySlotAssignments(): Record<ModelControlSlot, string | null> {
  return {
    textModel: null,
    imageModel: null,
    videoModel: null,
    ttsProvider: null,
  }
}

function createEmptyModeDefaults(): Record<ModelControlMode, Record<ModelControlSlot, string | null>> {
  return {
    mass_production: createEmptySlotAssignments(),
    high_quality: createEmptySlotAssignments(),
  }
}

function slugifyModelControlValue(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "default"
}

function nowIso() {
  return new Date().toISOString()
}

function maskSecretPreview(secret: string) {
  const tail = secret.slice(-4)
  return `${"*".repeat(Math.max(secret.length - tail.length, 4))}${tail}`
}

function getModelControlMasterKey() {
  const source = process.env.GENERGI_MODEL_CONTROL_MASTER_KEY ?? "genergi-model-control-dev-key"
  return createHash("sha256").update(source).digest()
}

function encryptSecret(secret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getModelControlMasterKey(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`
}

function normalizeProviderRecord(raw: unknown): ModelControlProviderRecord | null {
  if (!raw || typeof raw !== "object") {
    return null
  }

  const record = raw as Partial<ModelControlProviderRecord>
  const now = nowIso()
  const authType = providerAuthTypeSchema.safeParse(record.authType).success
    ? providerAuthTypeSchema.parse(record.authType)
    : "none"
  const status = providerStatusSchema.safeParse(record.status).success
    ? providerStatusSchema.parse(record.status)
    : "draft"

  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : randomUUID(),
    providerKey:
      typeof record.providerKey === "string" && record.providerKey.trim()
        ? record.providerKey.trim()
        : `provider-${slugifyModelControlValue(String(record.providerType ?? "unknown"))}`,
    providerType: typeof record.providerType === "string" && record.providerType.trim() ? record.providerType.trim() : "unknown",
    displayName:
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName.trim()
        : typeof record.providerType === "string" && record.providerType.trim()
          ? record.providerType.trim()
          : "Unknown Provider",
    endpointUrl: typeof record.endpointUrl === "string" ? record.endpointUrl.trim() : "",
    authType,
    encryptedSecret: typeof record.encryptedSecret === "string" && record.encryptedSecret.trim() ? record.encryptedSecret : null,
    secretPreview: typeof record.secretPreview === "string" && record.secretPreview.trim() ? record.secretPreview : null,
    status,
    lastValidatedAt: typeof record.lastValidatedAt === "string" && record.lastValidatedAt.trim() ? record.lastValidatedAt : null,
    lastValidationError:
      typeof record.lastValidationError === "string" && record.lastValidationError.trim() ? record.lastValidationError : null,
    createdAt: typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt : now,
  }
}

function normalizeModelSlotType(rawSlotType: unknown): ModelControlSlot | null {
  switch (rawSlotType) {
    case "textModel":
    case "imageModel":
    case "videoModel":
    case "ttsProvider":
      return rawSlotType
    case "imageDraftModel":
    case "imageFinalModel":
      return "imageModel"
    case "videoDraftModel":
    case "videoFinalModel":
      return "videoModel"
    default:
      return null
  }
}

function normalizeModelRecord(raw: unknown): ModelControlModelRecord | null {
  if (!raw || typeof raw !== "object") {
    return null
  }

  const record = raw as Partial<ModelControlModelRecord>
  const slotType = normalizeModelSlotType(record.slotType)
  if (!slotType) {
    return null
  }

  const lifecycleStatus = modelLifecycleStatusSchema.safeParse(record.lifecycleStatus).success
    ? modelLifecycleStatusSchema.parse(record.lifecycleStatus)
    : "draft"
  const rawProviderModelId = typeof record.providerModelId === "string" ? record.providerModelId.trim() : ""
  const providerModelId =
    slotType === "imageModel"
      ? normalizeImageProviderModelId(rawProviderModelId)
      : slotType === "videoModel"
        ? normalizeVideoProviderModelId(rawProviderModelId)
        : rawProviderModelId
  const now = nowIso()
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : randomUUID(),
    modelKey:
      typeof record.modelKey === "string" && record.modelKey.trim()
        ? record.modelKey.trim()
        : `${slotType}-${slugifyModelControlValue(String(record.providerModelId ?? "model"))}`,
    providerId: typeof record.providerId === "string" ? record.providerId.trim() : "",
    slotType,
    providerModelId,
    displayName:
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName.trim()
        : typeof record.providerModelId === "string" && record.providerModelId.trim()
          ? record.providerModelId.trim()
          : "Unknown Model",
    capabilityJson:
      record.capabilityJson && typeof record.capabilityJson === "object" && !Array.isArray(record.capabilityJson)
        ? { ...(record.capabilityJson as Record<string, unknown>) }
        : {},
    lifecycleStatus,
    lastValidatedAt: typeof record.lastValidatedAt === "string" && record.lastValidatedAt.trim() ? record.lastValidatedAt : null,
    lastValidationError:
      typeof record.lastValidationError === "string" && record.lastValidationError.trim() ? record.lastValidationError : null,
    createdAt: typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt : now,
  }
}

function normalizeSlotAssignments(raw: unknown): Record<ModelControlSlot, string | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createEmptySlotAssignments()
  }

  const normalized = createEmptySlotAssignments()
  for (const slotType of MODEL_CONTROL_SLOTS) {
    const value = (raw as Record<string, unknown>)[slotType]
    if (typeof value === "string" && value.trim()) {
      normalized[slotType] = value.trim()
      continue
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const modelId = (value as { modelId?: unknown }).modelId
      if (typeof modelId === "string" && modelId.trim()) {
        normalized[slotType] = modelId.trim()
      }
    }
  }

  return normalized
}

function normalizeDefaultsDocument(raw: unknown): ModelControlDefaultsDocument {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const normalizedModeDefaults = createEmptyModeDefaults()

  if (record.modeDefaults && typeof record.modeDefaults === "object" && !Array.isArray(record.modeDefaults)) {
    for (const modeId of MODEL_CONTROL_MODES) {
      normalizedModeDefaults[modeId] = normalizeSlotAssignments(
        (record.modeDefaults as Record<string, unknown>)[modeId],
      )
    }
  } else if (Array.isArray(record.modeDefaults)) {
    for (const entry of record.modeDefaults) {
      if (!entry || typeof entry !== "object") {
        continue
      }
      const modeId = modelControlModeSchema.safeParse((entry as { modeId?: unknown }).modeId)
      if (!modeId.success) {
        continue
      }
      normalizedModeDefaults[modeId.data] = normalizeSlotAssignments((entry as { slots?: unknown }).slots ?? entry)
    }
  }

  return {
    globalDefaults: normalizeSlotAssignments(record.globalDefaults ?? record.global ?? {}),
    modeDefaults: normalizedModeDefaults,
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt : null,
  }
}

function buildProviderSeedDisplayName(providerType: string) {
  const normalized = providerType.trim().toLowerCase()
  if (normalized === "anthropic-compatible") {
    return "Anthropic Compatible Seed"
  }
  if (normalized === "openai-compatible") {
    return "OpenAI Compatible Seed"
  }
  if (normalized === "edge-tts") {
    return "Edge TTS Seed"
  }
  if (normalized === "azure-tts") {
    return "Azure TTS Seed"
  }

  return providerType
}

function buildModelControlSeedState(): {
  providers: ModelControlProviderRecord[]
  models: ModelControlModelRecord[]
  defaults: ModelControlDefaultsDocument
} {
  const now = nowIso()
  const providerMap = new Map<string, ModelControlProviderRecord>()

  const ensureProvider = (providerType: string) => {
    const normalizedType = providerType.trim()
    const existing = providerMap.get(normalizedType)
    if (existing) {
      return existing
    }

    const record: ModelControlProviderRecord = {
      id: `seed-provider-${slugifyModelControlValue(normalizedType)}`,
      providerKey: `seed-${slugifyModelControlValue(normalizedType)}`,
      providerType: normalizedType,
      displayName: buildProviderSeedDisplayName(normalizedType),
      endpointUrl: "",
      authType: TTS_PROVIDER_TYPES.has(normalizedType.toLowerCase()) ? "none" : "bearer_token",
      encryptedSecret: null,
      secretPreview: null,
      status: "available",
      lastValidatedAt: now,
      lastValidationError: null,
      createdAt: now,
      updatedAt: now,
    }
    providerMap.set(normalizedType, record)
    return record
  }

  const models: ModelControlModelRecord[] = []
  const defaults = createEmptyModeDefaults()
  const seenSlotModels = new Map<string, string>()

  const registerSeedModel = (slotType: Exclude<ModelControlSlot, "ttsProvider">, modelRef: { id: string; label: string; provider: string }) => {
    const key = `${slotType}:${modelRef.id}`
    const existingId = seenSlotModels.get(key)
    if (existingId) {
      return existingId
    }

    const provider = ensureProvider(modelRef.provider)
    const modelId = `seed-model-${slugifyModelControlValue(slotType)}-${slugifyModelControlValue(modelRef.id)}`
    models.push({
      id: modelId,
      modelKey: `${slotType}-${slugifyModelControlValue(modelRef.id)}`,
      providerId: provider.id,
      slotType,
      providerModelId:
        slotType === "imageModel"
          ? normalizeImageProviderModelId(modelRef.id)
          : slotType === "videoModel"
            ? normalizeVideoProviderModelId(modelRef.id)
            : modelRef.id,
      displayName: modelRef.label,
      capabilityJson: slotType.startsWith("video")
        ? { ...resolveVideoModelCapability(normalizeVideoProviderModelId(modelRef.id)) }
        : { provider: modelRef.provider },
      lifecycleStatus: "available",
      lastValidatedAt: now,
      lastValidationError: null,
      createdAt: now,
      updatedAt: now,
    })
    seenSlotModels.set(key, modelId)
    return modelId
  }

  for (const modeId of MODEL_CONTROL_MODES) {
    const mode = MODE_MODELS[modeId]
    defaults[modeId].textModel = registerSeedModel("textModel", mode.textModel)
    defaults[modeId].imageModel = registerSeedModel("imageModel", mode.imageModel)
    defaults[modeId].videoModel = registerSeedModel("videoModel", mode.videoModel)
    defaults[modeId].ttsProvider = ensureProvider(mode.ttsProvider).id
  }

  return {
    providers: Array.from(providerMap.values()),
    models,
    defaults: {
      globalDefaults: createEmptySlotAssignments(),
      modeDefaults: defaults,
      updatedAt: now,
    },
  }
}

function hasPersistedModelControlState(state: {
  providers: ModelControlProviderRecord[]
  models: ModelControlModelRecord[]
  defaults: ModelControlDefaultsDocument
}) {
  const hasDefaults = MODEL_CONTROL_SLOTS.some(
    (slot) =>
      state.defaults.globalDefaults[slot] ||
      state.defaults.modeDefaults.mass_production?.[slot] ||
      state.defaults.modeDefaults.high_quality?.[slot],
  )

  return (state.providers.length > 0 && state.models.length > 0) || hasDefaults
}

let modelControlStatePromise:
  | Promise<{
      providers: ModelControlProviderRecord[]
      models: ModelControlModelRecord[]
      defaults: ModelControlDefaultsDocument
    }>
  | null = null

async function ensureModelControlState() {
  if (!modelControlStatePromise) {
    modelControlStatePromise = (async () => {
      const rawProviders = await readProviderRecords()
      const rawModels = await readModelRecords()
      const rawDefaults = await readModelDefaults()

      const state = {
        providers: (rawProviders as unknown[])
          .map(normalizeProviderRecord)
          .filter(Boolean) as ModelControlProviderRecord[],
        models: (rawModels as unknown[]).map(normalizeModelRecord).filter(Boolean) as ModelControlModelRecord[],
        defaults: normalizeDefaultsDocument(rawDefaults),
      }

      const hasDefaults = MODEL_CONTROL_SLOTS.some(
        (slot) =>
          state.defaults.globalDefaults[slot] ||
          state.defaults.modeDefaults.mass_production?.[slot] ||
          state.defaults.modeDefaults.high_quality?.[slot],
      )

      if (state.providers.length === 0 && state.models.length === 0 && !hasDefaults) {
        const seeded = buildModelControlSeedState()
        await replaceProviderRecords(seeded.providers as never[])
        await replaceModelRecords(seeded.models as never[])
        await replaceModelDefaults(seeded.defaults as never)
        return seeded
      }

      if (state.providers.length > 0 && state.models.length > 0 && !hasDefaults) {
        const seeded = buildModelControlSeedState()
        const nextDefaults: ModelControlDefaultsDocument = {
          ...state.defaults,
          modeDefaults: seeded.defaults.modeDefaults,
          updatedAt: seeded.defaults.updatedAt,
        }
        await replaceModelDefaults(nextDefaults as never)
        return {
          ...state,
          defaults: nextDefaults,
        }
      }

      if (hasPersistedModelControlState(state)) {
        return state
      }

      const seeded = buildModelControlSeedState()
      await replaceProviderRecords(seeded.providers as never[])
      await replaceModelRecords(seeded.models as never[])
      await replaceModelDefaults(seeded.defaults as never)
      return seeded
    })().finally(() => {
      modelControlStatePromise = null
    })
  }

  return modelControlStatePromise
}

function sanitizeProviderRecord(provider: ModelControlProviderRecord) {
  return {
    id: provider.id,
    providerKey: provider.providerKey,
    providerType: provider.providerType,
    displayName: provider.displayName,
    endpointUrl: provider.endpointUrl,
    authType: provider.authType,
    status: provider.status,
    lastValidatedAt: provider.lastValidatedAt,
    lastValidationError: provider.lastValidationError,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    secretConfigured: Boolean(provider.encryptedSecret),
    secretPreview: provider.secretPreview,
  }
}

function sanitizeModelRecord(model: ModelControlModelRecord, providers: ModelControlProviderRecord[]) {
  const provider = providers.find((item) => item.id === model.providerId) ?? null
  return {
    id: model.id,
    modelKey: model.modelKey,
    providerId: model.providerId,
    slotType: model.slotType,
    providerModelId: model.providerModelId,
    displayName: model.displayName,
    capabilityJson: model.capabilityJson,
    lifecycleStatus: model.lifecycleStatus,
    lastValidatedAt: model.lastValidatedAt,
    lastValidationError: model.lastValidationError,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    provider: provider
      ? {
          id: provider.id,
          displayName: provider.displayName,
          providerType: provider.providerType,
          status: provider.status,
        }
      : null,
  }
}

function validateProviderForAvailability(provider: ModelControlProviderRecord) {
  const normalizedProviderType = provider.providerType.trim().toLowerCase()
  const normalizedEndpoint = provider.endpointUrl.trim()

  if (!provider.providerKey.trim()) {
    return { ok: false as const, error: "providerKey is required" }
  }

  if (!provider.displayName.trim()) {
    return { ok: false as const, error: "displayName is required" }
  }

  if (!normalizedProviderType) {
    return { ok: false as const, error: "providerType is required" }
  }

  if (provider.authType !== "none" && !provider.encryptedSecret) {
    return { ok: false as const, error: "provider secret is required for authenticated providers" }
  }

  if (normalizedEndpoint && !/^https?:\/\//i.test(normalizedEndpoint)) {
    return { ok: false as const, error: "endpointUrl must start with http:// or https://" }
  }

  if (!normalizedEndpoint && !TTS_PROVIDER_TYPES.has(normalizedProviderType)) {
    return { ok: false as const, error: "endpointUrl is required for non-TTS providers" }
  }

  return { ok: true as const }
}

function validateModelForAvailability(model: ModelControlModelRecord, providers: ModelControlProviderRecord[]) {
  const provider = providers.find((item) => item.id === model.providerId) ?? null
  if (!provider) {
    return { ok: false as const, error: "linked provider does not exist" }
  }

  if (provider.status !== "available") {
    return { ok: false as const, error: "linked provider must be available before model validation" }
  }

  if (!model.modelKey.trim()) {
    return { ok: false as const, error: "modelKey is required" }
  }

  if (!model.providerModelId.trim()) {
    return { ok: false as const, error: "providerModelId is required" }
  }

  if (model.slotType === "ttsProvider") {
    return { ok: false as const, error: "ttsProvider defaults must point to provider records, not model records" }
  }

  if (TTS_PROVIDER_TYPES.has(provider.providerType.trim().toLowerCase())) {
    return { ok: false as const, error: "TTS providers cannot validate non-TTS model slots" }
  }

  return { ok: true as const }
}

function buildSelectablePools(state: {
  providers: ModelControlProviderRecord[]
  models: ModelControlModelRecord[]
}) {
  const slots = Object.fromEntries(
    MODEL_CONTROL_SLOTS.map((slotType) => [slotType, [] as Array<Record<string, unknown>>]),
  ) as Record<ModelControlSlot, Array<Record<string, unknown>>>

  for (const model of state.models) {
    const provider = state.providers.find((item) => item.id === model.providerId)
    if (!provider || provider.status !== "available" || model.lifecycleStatus !== "available") {
      continue
    }

    slots[model.slotType].push({
      slotType: model.slotType,
      sourceType: "model",
      valueId: model.id,
      modelId: model.id,
      displayName: model.displayName,
      providerId: provider.id,
      providerType: provider.providerType,
      providerModelId: model.providerModelId,
      capabilityJson: model.capabilityJson,
    })
  }

  for (const provider of state.providers) {
    if (provider.status !== "available" || !TTS_PROVIDER_TYPES.has(provider.providerType.trim().toLowerCase())) {
      continue
    }

    slots.ttsProvider.push({
      slotType: "ttsProvider",
      sourceType: "provider",
      valueId: provider.id,
      providerId: provider.id,
      displayName: provider.displayName,
      providerType: provider.providerType,
    })
  }

  return slots
}

function toModelControlSelection(
  valueId: string | null | undefined,
  slotType: ModelControlSlot,
  selectable: ReturnType<typeof buildSelectablePools>,
) {
  if (!valueId) {
    return null
  }

  const matched = selectable[slotType].find((entry) => entry.valueId === valueId) ?? null
  if (!matched) {
    return {
      recordId: valueId,
      displayName: null,
      providerDisplayName: null,
    }
  }

  return {
    valueId,
    recordId: valueId,
    displayName: typeof matched.displayName === "string" ? matched.displayName : null,
    providerDisplayName:
      typeof matched.providerDisplayName === "string"
        ? matched.providerDisplayName
        : typeof matched.providerType === "string"
          ? matched.providerType
          : null,
  }
}

function resolveEffectiveSelections(
  defaults: ModelControlDefaultsDocument,
  state: {
    providers: ModelControlProviderRecord[]
    models: ModelControlModelRecord[]
  },
  modeId: ModelControlMode,
) {
  const selectable = buildSelectablePools(state)
  return Object.fromEntries(
    MODEL_CONTROL_SLOTS.map((slotType) => {
      const modeValue = defaults.modeDefaults[modeId]?.[slotType] ?? null
      const globalValue = defaults.globalDefaults[slotType] ?? null
      const source = modeValue ? "mode" : globalValue ? "global" : "unconfigured"
      const valueId = modeValue ?? globalValue
      const matched = valueId ? selectable[slotType].find((entry) => entry.valueId === valueId) ?? null : null
      return [
        slotType,
        matched
          ? {
              ...matched,
              source,
            }
          : valueId
            ? {
                valueId,
                source,
              }
            : null,
      ]
    }),
  ) as Record<ModelControlSlot, Record<string, unknown> | null>
}

function buildDefaultsResponse(
  defaults: ModelControlDefaultsDocument,
  state: {
    providers: ModelControlProviderRecord[]
    models: ModelControlModelRecord[]
  },
) {
  const selectable = buildSelectablePools(state)
  const selectionView = {
    global: Object.fromEntries(
      MODEL_CONTROL_SLOTS.map((slotType) => [
        slotType,
        toModelControlSelection(defaults.globalDefaults[slotType], slotType, selectable),
      ]),
    ),
    modes: Object.fromEntries(
      MODEL_CONTROL_MODES.map((modeId) => [
        modeId,
        Object.fromEntries(
          MODEL_CONTROL_SLOTS.map((slotType) => [
            slotType,
            toModelControlSelection(defaults.modeDefaults[modeId]?.[slotType], slotType, selectable),
          ]),
        ),
      ]),
    ),
  }

  const effective = Object.fromEntries(
    MODEL_CONTROL_MODES.map((modeId) => [modeId, resolveEffectiveSelections(defaults, state, modeId)]),
  )

  return {
    ...selectionView,
    updatedAt: defaults.updatedAt,
    defaults: {
      global: { ...defaults.globalDefaults },
      modes: Object.fromEntries(
        MODEL_CONTROL_MODES.map((modeId) => [modeId, { ...defaults.modeDefaults[modeId] }]),
      ),
    },
    effective,
  }
}

function isSelectableTarget(
  slotType: ModelControlSlot,
  valueId: string,
  state: {
    providers: ModelControlProviderRecord[]
    models: ModelControlModelRecord[]
  },
) {
  const selectable = buildSelectablePools(state)
  return selectable[slotType].some((entry) => entry.valueId === valueId)
}

type ReleaseMetadata = {
  id: string | null
  gitSha: string | null
  deployedAt: string | null
}

async function readReleaseMetadata(): Promise<ReleaseMetadata> {
  const fromEnv: ReleaseMetadata = {
    id: process.env.GENERGI_RELEASE_ID ?? null,
    gitSha: process.env.GENERGI_GIT_SHA ?? null,
    deployedAt: process.env.GENERGI_DEPLOYED_AT ?? null,
  }

  if (fromEnv.id || fromEnv.gitSha || fromEnv.deployedAt) {
    return fromEnv
  }

  let currentDir = process.cwd()
  try {
    for (let depth = 0; depth < 5; depth += 1) {
      try {
        const raw = await fs.readFile(path.join(currentDir, "release.json"), "utf8")
        const parsed = JSON.parse(raw) as Partial<ReleaseMetadata>
        return {
          id: typeof parsed.id === "string" ? parsed.id : null,
          gitSha: typeof parsed.gitSha === "string" ? parsed.gitSha : null,
          deployedAt: typeof parsed.deployedAt === "string" ? parsed.deployedAt : null,
        }
      } catch {
        const nextDir = path.dirname(currentDir)
        if (nextDir === currentDir) {
          break
        }
        currentDir = nextDir
      }
    }
  } catch {
    // Ignore malformed cwd/path state and fall back to explicit env metadata.
  }

  return fromEnv
}

app.get("/api/health", async (c) => {
  return c.json({
    status: "ok",
    service: "genergi-api",
    version: "0.1.0",
    release: await readReleaseMetadata(),
  })
})

app.get("/api/system/status", async (c) => {
  const runtime = await readRuntimeStatus()
  const next = await updateRuntimeStatus((current) => ({
    ...current,
    api: {
      name: "api",
      status: "healthy",
      updatedAt: new Date().toISOString(),
      message: "API online",
    },
  }))

  return c.json({ runtime: next })
})

app.get("/api/auth/session", async (c) => {
  const user = await getSessionUser(c)
  return c.json({
    authenticated: Boolean(user),
    operator: user?.username ?? null,
    user: user ?? null,
    auth: getAuthStatus(),
  })
})

app.post("/api/auth/login", zValidator("json", loginSchema), async (c) => {
  const payload = c.req.valid("json")
  const result = await loginWithPassword(c, payload.username, payload.password)
  if (!result.ok) {
    return c.json({ message: result.reason }, result.reason === "AUTH_NOT_CONFIGURED" ? 503 : 401)
  }

  return c.json({
    authenticated: true,
    operator: result.user.username,
    user: result.user,
  })
})

app.post("/api/auth/logout", (c) => {
  clearSession(c)
  return c.json({ authenticated: false })
})

requireAuthNamespace("/api/users")

app.get("/api/users", async (c) => {
  const users = await listUsers()
  return c.json({ users })
})

app.post("/api/users", zValidator("json", createUserInputSchema), async (c) => {
  const payload = c.req.valid("json")
  try {
    const user = await createStoredUser(payload)
    return c.json({ user: toPublicUser(user, "file") }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR"
    if (message === "USERNAME_TAKEN") {
      return c.json({ message }, 409)
    }

    throw error
  }
})

app.patch("/api/users/:userId", zValidator("json", updateUserInputSchema), async (c) => {
  const payload = c.req.valid("json")
  const userId = c.req.param("userId")
  const currentUser = await findStoredUserById(userId)
  if (!currentUser) {
    const envUser = getEnvFallbackUser()
    if (envUser?.id === userId) {
      return c.json({ message: "USER_READ_ONLY" }, 409)
    }

    return c.json({ message: "USER_NOT_FOUND" }, 404)
  }

  try {
    const user = await updateStoredUser(userId, payload)
    if (!user) {
      return c.json({ message: "USER_NOT_FOUND" }, 404)
    }

    return c.json({ user: toPublicUser(user, "file") })
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR"
    if (message === "USERNAME_TAKEN") {
      return c.json({ message }, 409)
    }

    throw error
  }
})

app.post("/api/users/:userId/reset-password", zValidator("json", resetUserPasswordInputSchema), async (c) => {
  const userId = c.req.param("userId")
  const payload = c.req.valid("json")
  const user = await updateStoredUserPassword(userId, payload.password)
  if (!user) {
    const envUser = getEnvFallbackUser()
    if (envUser?.id === userId) {
      return c.json({ message: "USER_READ_ONLY" }, 409)
    }

    return c.json({ message: "USER_NOT_FOUND" }, 404)
  }

  return c.json({ user: toPublicUser(user, "file") })
})

app.get("/api/bootstrap", (c) => {
  return c.json({
    brand: BRAND,
    durationOptions: VIDEO_DURATION_PRESETS,
  })
})

requireAuthNamespace("/api/projects")

app.get("/api/projects", async (c) => {
  const projects = await listProjects()
  return c.json({ projects })
})

app.post("/api/projects", zValidator("json", createProjectInputSchema), async (c) => {
  const payload = c.req.valid("json")
  const project = await createProject(payload)
  return c.json({ project }, 201)
})

app.get("/api/projects/:projectId/library", async (c) => {
  const entries = await listProjectApprovedBlueprints(c.req.param("projectId"))
  return c.json({ entries })
})

requireAuthNamespace("/api/model-control")

app.get("/api/model-control/providers", async (c) => {
  const state = await ensureModelControlState()
  return c.json({
    providers: state.providers.map(sanitizeProviderRecord),
  })
})

app.post("/api/model-control/providers", zValidator("json", createProviderInputSchema), async (c) => {
  const payload = c.req.valid("json")
  const state = await ensureModelControlState()
  const now = nowIso()
  const record: ModelControlProviderRecord = {
    id: randomUUID(),
    providerKey: payload.providerKey,
    providerType: payload.providerType,
    displayName: payload.displayName,
    endpointUrl: payload.endpointUrl.trim(),
    authType: payload.authType,
    encryptedSecret: payload.secret ? encryptSecret(payload.secret) : null,
    secretPreview: payload.secret ? maskSecretPreview(payload.secret) : null,
    status: "draft",
    lastValidatedAt: null,
    lastValidationError: null,
    createdAt: now,
    updatedAt: now,
  }
  const providers = [...state.providers, record]
  await replaceProviderRecords(providers as never[])
  return c.json({ provider: sanitizeProviderRecord(record) }, 201)
})

app.patch("/api/model-control/providers/:providerId", zValidator("json", updateProviderInputSchema), async (c) => {
  const providerId = c.req.param("providerId")
  const payload = c.req.valid("json")
  const state = await ensureModelControlState()
  const index = state.providers.findIndex((item) => item.id === providerId)
  if (index < 0) {
    return c.json({ message: "PROVIDER_NOT_FOUND" }, 404)
  }

  const current = state.providers[index]
  const next: ModelControlProviderRecord = {
    ...current,
    providerKey: payload.providerKey ?? current.providerKey,
    providerType: payload.providerType ?? current.providerType,
    displayName: payload.displayName ?? current.displayName,
    endpointUrl: payload.endpointUrl ?? current.endpointUrl,
    authType: payload.authType ?? current.authType,
    encryptedSecret: payload.secret ? encryptSecret(payload.secret) : current.encryptedSecret,
    secretPreview: payload.secret ? maskSecretPreview(payload.secret) : current.secretPreview,
    status: payload.status ?? "draft",
    lastValidatedAt: payload.status && payload.status !== "available" ? current.lastValidatedAt : null,
    lastValidationError: payload.status && payload.status !== "available" ? current.lastValidationError : null,
    updatedAt: nowIso(),
  }
  const providers = [...state.providers]
  providers[index] = next
  await replaceProviderRecords(providers as never[])
  return c.json({ provider: sanitizeProviderRecord(next) })
})

app.get("/api/model-control/models", async (c) => {
  const state = await ensureModelControlState()
  return c.json({
    models: state.models.map((model) => sanitizeModelRecord(model, state.providers)),
  })
})

app.post("/api/model-control/models", zValidator("json", createModelInputSchema), async (c) => {
  const payload = c.req.valid("json")
  const state = await ensureModelControlState()
  const now = nowIso()
  const record: ModelControlModelRecord = {
    id: randomUUID(),
    modelKey: payload.modelKey,
    providerId: payload.providerId,
    slotType: payload.slotType,
    providerModelId: payload.providerModelId,
    displayName: payload.displayName,
    capabilityJson: payload.capabilityJson,
    lifecycleStatus: "draft",
    lastValidatedAt: null,
    lastValidationError: null,
    createdAt: now,
    updatedAt: now,
  }
  const models = [...state.models, record]
  await replaceModelRecords(models as never[])
  return c.json({ model: sanitizeModelRecord(record, state.providers) }, 201)
})

app.patch("/api/model-control/models/:modelId", zValidator("json", updateModelInputSchema), async (c) => {
  const modelId = c.req.param("modelId")
  const payload = c.req.valid("json")
  const state = await ensureModelControlState()
  const index = state.models.findIndex((item) => item.id === modelId)
  if (index < 0) {
    return c.json({ message: "MODEL_NOT_FOUND" }, 404)
  }

  const current = state.models[index]
  const next: ModelControlModelRecord = {
    ...current,
    modelKey: payload.modelKey ?? current.modelKey,
    providerId: payload.providerId ?? current.providerId,
    slotType: payload.slotType ?? current.slotType,
    providerModelId: payload.providerModelId ?? current.providerModelId,
    displayName: payload.displayName ?? current.displayName,
    capabilityJson: payload.capabilityJson ?? current.capabilityJson,
    lifecycleStatus: payload.lifecycleStatus ?? "draft",
    lastValidatedAt: payload.lifecycleStatus && payload.lifecycleStatus !== "available" ? current.lastValidatedAt : null,
    lastValidationError:
      payload.lifecycleStatus && payload.lifecycleStatus !== "available" ? current.lastValidationError : null,
    updatedAt: nowIso(),
  }
  const models = [...state.models]
  models[index] = next
  await replaceModelRecords(models as never[])
  return c.json({ model: sanitizeModelRecord(next, state.providers) })
})

app.get("/api/model-control/defaults", async (c) => {
  const state = await ensureModelControlState()
  return c.json(buildDefaultsResponse(state.defaults, state))
})

app.put("/api/model-control/defaults", zValidator("json", updateDefaultsInputSchema), async (c) => {
  const payload = c.req.valid("json")
  const state = await ensureModelControlState()
  const globalDefaults = {
    ...state.defaults.globalDefaults,
    ...(payload.global ?? {}),
  }
  const modeDefaults = {
    ...state.defaults.modeDefaults,
    mass_production: {
      ...state.defaults.modeDefaults.mass_production,
      ...(payload.modes?.mass_production ?? {}),
    },
    high_quality: {
      ...state.defaults.modeDefaults.high_quality,
      ...(payload.modes?.high_quality ?? {}),
    },
  }

  for (const slotType of MODEL_CONTROL_SLOTS) {
    const globalValue = globalDefaults[slotType]
    if (globalValue && !isSelectableTarget(slotType, globalValue, state)) {
      return c.json({ message: `DEFAULT_TARGET_NOT_SELECTABLE:${slotType}:${globalValue}` }, 400)
    }

    for (const modeId of MODEL_CONTROL_MODES) {
      const modeValue = modeDefaults[modeId][slotType]
      if (modeValue && !isSelectableTarget(slotType, modeValue, state)) {
        return c.json({ message: `DEFAULT_TARGET_NOT_SELECTABLE:${slotType}:${modeValue}` }, 400)
      }
    }
  }

  const nextDefaults: ModelControlDefaultsDocument = {
    globalDefaults,
    modeDefaults,
    updatedAt: nowIso(),
  }
  await replaceModelDefaults(nextDefaults as never)
  return c.json(buildDefaultsResponse(nextDefaults, state))
})

app.put("/api/model-control/defaults/global", zValidator("json", z.object({
  assignments: slotAssignmentsSchema,
})), async (c) => {
  const payload = c.req.valid("json")
  const state = await ensureModelControlState()
  const globalDefaults = {
    ...state.defaults.globalDefaults,
    ...payload.assignments,
  }

  for (const slotType of MODEL_CONTROL_SLOTS) {
    const valueId = globalDefaults[slotType]
    if (valueId && !isSelectableTarget(slotType, valueId, state)) {
      return c.json({ message: `DEFAULT_TARGET_NOT_SELECTABLE:${slotType}:${valueId}` }, 400)
    }
  }

  const nextDefaults: ModelControlDefaultsDocument = {
    ...state.defaults,
    globalDefaults,
    updatedAt: nowIso(),
  }
  await replaceModelDefaults(nextDefaults as never)
  return c.json(buildDefaultsResponse(nextDefaults, state))
})

app.put("/api/model-control/defaults/modes/:modeId", zValidator("json", z.object({
  assignments: slotAssignmentsSchema,
})), async (c) => {
  const modeId = modelControlModeSchema.safeParse(c.req.param("modeId"))
  if (!modeId.success) {
    return c.json({ message: "MODE_NOT_FOUND" }, 404)
  }

  const payload = c.req.valid("json")
  const state = await ensureModelControlState()
  const nextModeDefaults = {
    ...state.defaults.modeDefaults,
    [modeId.data]: {
      ...state.defaults.modeDefaults[modeId.data],
      ...payload.assignments,
    },
  }

  for (const slotType of MODEL_CONTROL_SLOTS) {
    const valueId = nextModeDefaults[modeId.data]?.[slotType]
    if (valueId && !isSelectableTarget(slotType, valueId, state)) {
      return c.json({ message: `DEFAULT_TARGET_NOT_SELECTABLE:${slotType}:${valueId}` }, 400)
    }
  }

  const nextDefaults: ModelControlDefaultsDocument = {
    ...state.defaults,
    modeDefaults: nextModeDefaults,
    updatedAt: nowIso(),
  }
  await replaceModelDefaults(nextDefaults as never)
  return c.json(buildDefaultsResponse(nextDefaults, state))
})

app.post("/api/model-control/validation/providers/:providerId", async (c) => {
  const providerId = c.req.param("providerId")
  const state = await ensureModelControlState()
  const index = state.providers.findIndex((item) => item.id === providerId)
  if (index < 0) {
    return c.json({ message: "PROVIDER_NOT_FOUND" }, 404)
  }

  const current = state.providers[index]
  const validation = validateProviderForAvailability(current)
  const next: ModelControlProviderRecord = {
    ...current,
    status: validation.ok ? "available" : "invalid",
    lastValidatedAt: nowIso(),
    lastValidationError: validation.ok ? null : validation.error,
    updatedAt: nowIso(),
  }
  const providers = [...state.providers]
  providers[index] = next
  await replaceProviderRecords(providers as never[])
  return c.json({ provider: sanitizeProviderRecord(next) })
})

app.post("/api/model-control/validation/models/:modelId", async (c) => {
  const modelId = c.req.param("modelId")
  const state = await ensureModelControlState()
  const index = state.models.findIndex((item) => item.id === modelId)
  if (index < 0) {
    return c.json({ message: "MODEL_NOT_FOUND" }, 404)
  }

  const current = state.models[index]
  const validation = validateModelForAvailability(current, state.providers)
  const next: ModelControlModelRecord = {
    ...current,
    lifecycleStatus: validation.ok ? "available" : "invalid",
    lastValidatedAt: nowIso(),
    lastValidationError: validation.ok ? null : validation.error,
    updatedAt: nowIso(),
  }
  const models = [...state.models]
  models[index] = next
  await replaceModelRecords(models as never[])
  return c.json({ model: sanitizeModelRecord(next, state.providers) })
})

app.get("/api/model-control/selectable", async (c) => {
  const state = await ensureModelControlState()
  const slotTypeQuery = c.req.query("slotType")
  const modeIdQuery = c.req.query("modeId")
  const selectable = buildSelectablePools(state)
  const selectedMode = modelControlModeSchema.safeParse(modeIdQuery).success ? (modeIdQuery as ModelControlMode) : "high_quality"
  const selectedSlot = modelControlSlotSchema.safeParse(slotTypeQuery).success
    ? (slotTypeQuery as ModelControlSlot)
    : null
  const slotOrder = selectedSlot ? [selectedSlot] : MODEL_CONTROL_SLOTS
  const slots = Object.fromEntries(
    slotOrder.map((slotType) => [
      slotType,
      selectable[slotType].map((entry) => ({
        ...entry,
        recordId: entry.valueId,
      })),
    ]),
  ) as Partial<Record<ModelControlSlot, Array<Record<string, unknown>>>> 
  const effective = Object.fromEntries(
    slotOrder.map((slotType) => {
      const modeValue = state.defaults.modeDefaults[selectedMode]?.[slotType] ?? null
      const globalValue = state.defaults.globalDefaults[slotType] ?? null
      const valueId = modeValue ?? globalValue
      const matched = valueId ? selectable[slotType].find((entry) => entry.valueId === valueId) ?? null : null
      return [
        slotType,
        matched
          ? {
              ...matched,
              recordId: matched.valueId,
            }
          : valueId
            ? { valueId }
            : null,
      ]
    }),
  )

  return c.json({
    modeId: selectedMode,
    slots,
    effective,
    pools: Object.fromEntries(
      slotOrder.map((slotType) => [
        slotType,
        {
          slotType,
          options: (slots[slotType] ?? []).map((entry) => {
            const record = entry as {
              valueId: string
              displayName?: string | null
              providerDisplayName?: string | null
              providerType?: string | null
              providerId?: string
              capabilityJson?: Record<string, unknown>
              description?: string | null
            }
            return {
              recordId: record.valueId,
              valueId: record.valueId,
              displayName: record.displayName ?? "",
              providerDisplayName:
                typeof record.providerDisplayName === "string"
                  ? record.providerDisplayName
                  : typeof record.providerType === "string"
                    ? record.providerType
                    : null,
              providerId: record.providerId,
            slotType,
              capabilityJson: record.capabilityJson,
              description: record.description ?? null,
            }
          }),
          globalDefaultId: state.defaults.globalDefaults[slotType] ?? null,
          modeDefaultId: state.defaults.modeDefaults[selectedMode]?.[slotType] ?? null,
          effectiveId:
            state.defaults.modeDefaults[selectedMode]?.[slotType] ??
            state.defaults.globalDefaults[slotType] ??
            null,
        },
      ]),
    ),
  })
})

requireAuthNamespace("/api/production")

app.get("/api/production/schedule", async (c) => {
  return c.json({ schedule: await buildProductionSchedule() })
})

requireAuthNamespace("/api/tasks")

app.get("/api/tasks", async (c) => {
  const tasks = await listTasks()
  return c.json({ tasks: tasks.map(enrichSummary) })
})

app.get("/api/tasks/:taskId", async (c) => {
  const detail = await getTaskDetail(c.req.param("taskId"))
  if (!detail) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  return c.json({ detail: enrichDetail(detail) })
})

app.get("/api/tasks/:taskId/diagnostics", async (c) => {
  const taskId = c.req.param("taskId")
  const [tasks, detail] = await Promise.all([listTasks(), getTaskDetail(taskId)])
  const task = tasks.find((entry) => entry.id === taskId) ?? null
  if (!task || !detail) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  return c.json({ diagnostics: await buildTaskDiagnostics(task, detail) })
})

app.get("/api/tasks/:taskId/timeline", async (c) => {
  const taskId = c.req.param("taskId")
  const [tasks, detail] = await Promise.all([listTasks(), getTaskDetail(taskId)])
  const task = tasks.find((entry) => entry.id === taskId) ?? null
  if (!task || !detail) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  return c.json({ timeline: await readTaskTimeline(taskId) })
})

app.get("/api/tasks/:taskId/retry-requests", async (c) => {
  const taskId = c.req.param("taskId")
  const [tasks, detail] = await Promise.all([listTasks(), getTaskDetail(taskId)])
  const task = tasks.find((entry) => entry.id === taskId) ?? null
  if (!task || !detail) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  return c.json({ retryRequests: await readTaskRetryRequests(taskId) })
})

app.get("/api/tasks/:taskId/delivery", async (c) => {
  const taskId = c.req.param("taskId")
  const [tasks, detail] = await Promise.all([listTasks(), getTaskDetail(taskId)])
  const task = tasks.find((entry) => entry.id === taskId) ?? null
  if (!task || !detail) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  return c.json({ delivery: await buildTaskDelivery(task, detail) })
})

app.get("/api/tasks/:taskId/delivery/manifest", async (c) => {
  const taskId = c.req.param("taskId")
  const [tasks, detail] = await Promise.all([listTasks(), getTaskDetail(taskId)])
  const task = tasks.find((entry) => entry.id === taskId) ?? null
  if (!task || !detail) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  const delivery = await buildTaskDelivery(task, detail)
  const manifest = {
    generatedAt: new Date().toISOString(),
    delivery,
  }
  c.header("Content-Type", "application/json; charset=utf-8")
  c.header("Content-Disposition", `attachment; filename="${taskId}-delivery-manifest.json"`)
  return c.body(JSON.stringify(manifest, null, 2))
})

app.post(
  "/api/tasks/:taskId/retry",
  zValidator("json", retryTaskBodySchema),
  async (c) => {
    const taskId = c.req.param("taskId")
    const payload = c.req.valid("json")
    const [tasks, detail] = await Promise.all([listTasks(), getTaskDetail(taskId)])
    const task = tasks.find((entry) => entry.id === taskId) ?? null
    if (!task || !detail) {
      return c.json({ message: "TASK_NOT_FOUND" }, 404)
    }

    const scene = payload.sceneId
      ? detail.scenes.find((item) => item.id === payload.sceneId) ?? null
      : null
    if (payload.sceneId && !scene) {
      return c.json({
        message: "RETRY_SCENE_NOT_FOUND",
        sceneId: payload.sceneId,
        validSceneIds: detail.scenes.map((item) => item.id),
      }, 400)
    }

    let queueJobs
    try {
      queueJobs = await inspectTaskJobs(taskId)
    } catch (error) {
      return toQueueUnavailableResponse(c, error)
    }

    const activeJobIds = queueJobs.active.length > 0
      ? queueJobs.active
      : task.activeJobId
        ? [task.activeJobId]
        : []
    if (task.status === "running" && activeJobIds.length > 0) {
      return c.json({
        message: "TASK_RUNNING_ACTIVE_JOB",
        activeJobIds,
      }, 409)
    }

    if (task.status !== "failed") {
      return c.json({
        message: "TASK_RETRY_NOT_RECOVERABLE",
        status: task.status,
      }, 409)
    }

    const scope = payload.scope ?? (scene ? "scene" : "task")
    const retryRequest = await appendTaskRetryRequest(taskId, {
      scope,
      sceneId: scene?.id ?? null,
      sceneIndex: scene?.index ?? null,
      sceneTitle: scene?.title ?? null,
      reason: payload.reason ?? null,
      status: "pending",
      statusDetail: "等待 worker 局部重试",
      taskStatusAtRequest: task.status,
      queue: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const marked = await markTaskRetryPending(taskId)
    if (!marked) {
      return c.json({ message: "TASK_NOT_FOUND" }, 404)
    }

    const continueExecution = inferRetryContinueExecution(task, detail)
    const queueOptions = {
      reason: scope === "task" ? "retry_failed_task" : `retry_failed_${scope}`,
      continueExecution,
      blueprintVersion: detail.blueprintVersion,
      stage: `retry_${scope}`,
      resumeFrom: scene?.id ?? "failed_task",
    }

    let queue
    try {
      queue = await enqueueTask(taskId, queueOptions)
    } catch (error) {
      await restoreTaskState(task, detail)
      await updateTaskRetryRequest(taskId, retryRequest.id, (request) => ({
        ...request,
        status: "enqueue_failed",
        statusDetail: error instanceof Error ? error.message : "TASK_QUEUE_UNAVAILABLE",
        updatedAt: new Date().toISOString(),
      }))
      return toQueueUnavailableResponse(c, error)
    }

    const acceptedRequest = await updateTaskRetryRequest(taskId, retryRequest.id, (request) => ({
      ...request,
      status: "accepted",
      statusDetail: "已入队等待 worker 局部重试",
      queue: {
        queued: queue.queued,
        jobId: queue.jobId,
        reason: queue.reason,
        continueExecution: queue.continueExecution,
        blueprintVersion: queue.blueprintVersion,
        stage: queue.stage,
        resumeFrom: queue.resumeFrom,
      },
      updatedAt: new Date().toISOString(),
    }))

    return c.json({
      retryRequest: acceptedRequest,
      task: marked.summary,
      detail: marked.detail,
      queue,
    }, 202)
  },
)

app.get("/api/tasks/:taskId/blueprints", async (c) => {
  const blueprints = await listTaskBlueprints(c.req.param("taskId"))
  return c.json({ blueprints })
})

app.post(
  "/api/tasks/:taskId/blueprints",
  zValidator("json", createBlueprintInputSchema),
  async (c) => {
    const taskId = c.req.param("taskId")
    const payload = c.req.valid("json")
    const blueprint = await createTaskBlueprintVersion({
      taskId,
      blueprint: payload.blueprint,
      keyframeManifestPath: payload.keyframeManifestPath ?? null,
    })

    if (!blueprint) {
      return c.json({ message: "TASK_NOT_FOUND" }, 404)
    }

    return c.json(
      {
        blueprint,
        review: null,
        nextStage: buildBlueprintNextStage(taskId, blueprint.status),
      },
      201,
    )
  },
)

app.get("/api/tasks/:taskId/blueprints/current", async (c) => {
  const taskId = c.req.param("taskId")
  const blueprint = await getCurrentTaskBlueprint(taskId)
  if (!blueprint) {
    return c.json({ message: "TASK_BLUEPRINT_NOT_FOUND" }, 404)
  }

  const review = await getLatestTaskBlueprintReview(taskId, blueprint.version)

  return c.json({
    blueprint,
    review,
    nextStage: buildBlueprintNextStage(taskId, blueprint.status),
  })
})

app.get("/api/tasks/:taskId/assets", async (c) => {
  const assets = await getTaskAssets(c.req.param("taskId"))
  return c.json({ assets })
})

app.delete("/api/tasks/:taskId", async (c) => {
  const taskId = c.req.param("taskId")
  const result = await deleteTaskWithAssets(taskId)
  if (!result.deleted) {
    if (result.reason === "TASK_NOT_FOUND") {
      return c.json({ message: result.reason }, 404)
    }
    if (result.reason === "TASK_ASSET_TASK_ID_FORBIDDEN" || result.reason === "ASSET_DELETE_PATH_FORBIDDEN") {
      return c.json({ message: result.reason }, 403)
    }
    if (result.reason === "TASK_ASSETS_LOCKED") {
      return c.json({ message: result.reason, status: result.status }, 409)
    }
    return c.json({ message: result.reason }, 400)
  }
  return c.json({ deleted: true, taskId })
})

app.delete("/api/tasks/:taskId/assets", async (c) => {
  const taskId = c.req.param("taskId")
  const result = await deleteTaskAssetCollection(taskId)
  if (!result.deleted) {
    if (result.reason === "TASK_NOT_FOUND") {
      return c.json({ message: result.reason }, 404)
    }
    if (result.reason === "TASK_ASSET_TASK_ID_FORBIDDEN" || result.reason === "ASSET_DELETE_PATH_FORBIDDEN") {
      return c.json({ message: result.reason }, 403)
    }
    if (result.reason === "TASK_ASSETS_LOCKED") {
      return c.json({ message: result.reason, status: result.status }, 409)
    }
    return c.json({ message: result.reason }, 400)
  }
  return c.json({ deleted: true, taskId })
})

async function sendAssetFile(
  c: Context,
  asset: Awaited<ReturnType<typeof getTaskAsset>>,
  disposition: "attachment" | "inline",
) {
  if (!asset) {
    return c.json({ message: "ASSET_NOT_FOUND" }, 404)
  }

  if (!asset.exists) {
    return c.json({ message: "ASSET_FILE_NOT_FOUND" }, 404)
  }

  if (asset.isDirectory) {
    return c.json({ message: "ASSET_IS_DIRECTORY", path: asset.displayPath }, 409)
  }

  try {
    const file = await fs.readFile(asset.path)
    c.header("Content-Type", asset.mimeType)
    c.header("Content-Disposition", `${disposition}; filename="${asset.downloadFileName.replace(/"/g, '\\"')}"`)
    if (asset.sizeBytes != null) {
      c.header("Content-Length", String(asset.sizeBytes))
    }
    return c.body(file)
  } catch {
    return c.json({ message: "ASSET_FILE_NOT_FOUND" }, 404)
  }
}

function getInlineFileMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".png") {
    return "image/png"
  }
  if (extension === ".webp") {
    return "image/webp"
  }
  return "image/jpeg"
}

function toQueueUnavailableResponse(c: Context, error: unknown) {
  const queueError =
    error instanceof QueueUnavailableError
      ? error
      : new QueueUnavailableError(error instanceof Error ? error.message : "QUEUE_UNAVAILABLE")

  return c.json(
    {
      message: queueError.code,
      reason: queueError.message,
    },
    503,
  )
}

function buildBlueprintNextStage(taskId: string, status: string) {
  const canResumeExecution = status === "approved"
  return {
    stage: "video_generation",
    canResumeExecution,
    resumePath: canResumeExecution ? `/api/tasks/${taskId}/blueprints/current/resume` : null,
  }
}

app.get("/api/tasks/:taskId/assets/:assetId/download", async (c) => {
  const asset = await getTaskAsset(c.req.param("taskId"), c.req.param("assetId"))
  return sendAssetFile(c, asset, "attachment")
})

app.delete("/api/tasks/:taskId/assets/:assetId", async (c) => {
  const taskId = c.req.param("taskId")
  const assetId = c.req.param("assetId")
  const result = await deleteTaskAsset(taskId, assetId)

  if (result.deleted) {
    return c.json({ deleted: true, taskId, assetId })
  }

  if (result.reason === "ASSET_DELETE_PATH_FORBIDDEN") {
    return c.json({ message: result.reason }, 403)
  }
  if (result.reason === "TASK_ASSET_TASK_ID_FORBIDDEN") {
    return c.json({ message: result.reason }, 403)
  }
  if (result.reason === "TASK_NOT_FOUND") {
    return c.json({ message: result.reason }, 404)
  }
  if (result.reason === "TASK_ASSETS_LOCKED") {
    return c.json({ message: result.reason, status: result.status }, 409)
  }

  return c.json({ message: result.reason }, 404)
})

app.get("/api/tasks/:taskId/assets/:assetId/preview", async (c) => {
  const asset = await getTaskAsset(c.req.param("taskId"), c.req.param("assetId"))
  if (asset && !asset.previewable) {
    return c.json({ message: "ASSET_PREVIEW_UNAVAILABLE", previewKind: asset.previewKind }, 409)
  }

  return sendAssetFile(c, asset, "inline")
})

app.post("/api/tasks/:taskId/cancel", async (c) => {
  const taskId = c.req.param("taskId")
  let queue
  try {
    queue = await cancelTaskJobs(taskId)
  } catch (error) {
    return toQueueUnavailableResponse(c, error)
  }

  const canceled = await cancelTask(taskId, queue)
  if (!canceled) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  return c.json({
    task: canceled.summary,
    detail: canceled.detail,
    queue,
  })
})

app.post("/api/tasks/:taskId/resume", async (c) => {
  const taskId = c.req.param("taskId")
  const tasks = await listTasks()
  const task = tasks.find((entry) => entry.id === taskId)
  if (!task) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  const detail = await getTaskDetail(taskId)
  if (!detail) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  const staleRunningThresholdMs = STALE_RUNNING_THRESHOLD_MS
  const stale = getStaleRunningInfo(task, detail)
  const statusDetail = `${task.statusDetail ?? detail.statusDetail ?? ""}`
  const isStaleRunningTask = stale.isStale

  if (task.status !== "failed" && !isStaleRunningTask) {
    return c.json({ message: "TASK_NOT_RECOVERABLE", status: task.status }, 409)
  }

  const recoverableFailureText = `${task.failureReason ?? detail.failureReason ?? ""} ${statusDetail}`
  const failedAfterPlanning =
    /scene|video|keyframe|subtitle|audio|timeout|成片|视频|画面|关键帧|字幕|音频/i.test(recoverableFailureText)
  const continueExecution =
    failedAfterPlanning ||
    task.blueprintStatus === "approved" ||
    task.blueprintStatus === "queued_for_video" ||
    task.blueprintStatus === "video_generating" ||
    task.blueprintStatus === "completed" ||
    detail.blueprintStatus === "approved" ||
    detail.blueprintStatus === "queued_for_video" ||
    detail.blueprintStatus === "video_generating" ||
    detail.blueprintStatus === "completed" ||
    detail.taskRunConfig.blueprintStatus === "approved" ||
    detail.taskRunConfig.blueprintStatus === "queued_for_video" ||
    detail.taskRunConfig.blueprintStatus === "video_generating" ||
    detail.taskRunConfig.blueprintStatus === "completed"

  try {
    if (isStaleRunningTask) {
      const recovered = await recoverTaskJobs(taskId, { minActiveAgeMs: staleRunningThresholdMs })
      if (recovered.hasActiveJob) {
        return c.json({
          message: "TASK_STALE_ACTIVE_JOB_STILL_HELD",
          activeJobIds: recovered.activeJobIds,
          staleActiveJobIds: recovered.staleActiveJobIds,
          diagnostics: await buildTaskDiagnostics(task, detail),
        }, 409)
      }
    }
  } catch (error) {
    return toQueueUnavailableResponse(c, error)
  }

  const resumed = await resumeFailedTask(taskId)
  if (!resumed) {
    return c.json({ message: "TASK_NOT_FOUND" }, 404)
  }

  let queue
  try {
    if (isStaleRunningTask) {
      queue = await enqueueTask(taskId, {
        reason: "resume_stale_running_task",
        continueExecution,
        blueprintVersion: detail.blueprintVersion,
        stage: "resume_after_stale_running",
        resumeFrom: "stale_running_task",
      })
    } else {
      queue = await enqueueTask(taskId, {
        reason: "resume_failed_task",
        continueExecution,
        blueprintVersion: detail.blueprintVersion,
        stage: "resume_after_failure",
        resumeFrom: "failed_task",
      })
    }
  } catch (error) {
    await restoreTaskState(task, detail)
    return toQueueUnavailableResponse(c, error)
  }

  return c.json({
    task: resumed.summary,
    detail: resumed.detail,
    queue,
    diagnostics: await buildTaskDiagnostics(resumed.summary, resumed.detail),
  }, 202)
})

app.patch(
  "/api/tasks/:taskId/audio-strategy",
  zValidator("json", taskAudioStrategyBodySchema),
  async (c) => {
    const taskId = c.req.param("taskId")
    const payload = c.req.valid("json")
    const updated = await updateTaskAudioStrategy(taskId, payload.audioStrategy)

    if (!updated.ok) {
      if (updated.code === "TASK_NOT_FOUND") {
        return c.json({ message: updated.code }, 404)
      }

      return c.json({ message: updated.code }, 409)
    }

    return c.json({
      task: updated.summary,
      detail: updated.detail,
    })
  },
)

app.post(
  "/api/tasks/:taskId/blueprints/:version/review",
  requireAuth(),
  zValidator("json", blueprintReviewBodySchema),
  async (c) => {
    const taskId = c.req.param("taskId")
    const version = Number(c.req.param("version"))
    if (!Number.isInteger(version) || version <= 0) {
      return c.json({ message: "INVALID_BLUEPRINT_VERSION" }, 400)
    }

    const current = await getCurrentTaskBlueprint(taskId)
    if (!current) {
      return c.json({ message: "TASK_BLUEPRINT_NOT_FOUND" }, 404)
    }

    if (current.version !== version) {
      return c.json({ message: "BLUEPRINT_VERSION_MISMATCH" }, 409)
    }

    const payload = c.req.valid("json")
    const review = await recordTaskBlueprintReview({
      taskId,
      blueprintVersion: version,
      decision: payload.decision,
      note: payload.note,
    })

    if (payload.decision === "approved") {
      const projectLibraryEntry = await approveTaskBlueprint({
        taskId,
        projectId: current.blueprint.projectId,
        blueprintVersion: version,
      })
      const approved = await getTaskBlueprintByVersion(taskId, version)
      if (!approved) {
        return c.json({ message: "TASK_BLUEPRINT_NOT_FOUND" }, 404)
      }

      return c.json({
        review,
        blueprint: approved,
        projectLibraryEntry,
        nextStage: buildBlueprintNextStage(taskId, approved.status),
      })
    }

    const rejected = await rejectTaskBlueprint({
      taskId,
      blueprintVersion: version,
    })
    return c.json({
      review,
      blueprint: rejected,
      projectLibraryEntry: null,
      nextStage: buildBlueprintNextStage(taskId, rejected?.status ?? "rejected"),
    })
  },
)

app.post("/api/tasks/:taskId/blueprints/current/resume", async (c) => {
  const taskId = c.req.param("taskId")
  const blueprint = await getCurrentTaskBlueprint(taskId)
  if (!blueprint) {
    return c.json({ message: "TASK_BLUEPRINT_NOT_FOUND" }, 404)
  }

  if (blueprint.status !== "approved") {
    return c.json({ message: "BLUEPRINT_NOT_READY_FOR_RESUME", blueprintStatus: blueprint.status }, 409)
  }

  let queue
  try {
    queue = await enqueueTask(taskId, {
      reason: "resume_after_blueprint_approval",
      continueExecution: true,
      blueprintVersion: blueprint.version,
      stage: "video_generation",
    })
  } catch (error) {
    return toQueueUnavailableResponse(c, error)
  }

  const queuedBlueprint = await queueTaskBlueprintForVideo({
    taskId,
    blueprintVersion: blueprint.version,
  })

  if (!queuedBlueprint) {
    return c.json({ message: "TASK_BLUEPRINT_NOT_FOUND" }, 404)
  }

  return c.json(
    {
      blueprint: queuedBlueprint,
      queue,
      nextStage: buildBlueprintNextStage(taskId, queuedBlueprint.status),
    },
    202,
  )
})

app.get("/api/tasks/:taskId/keyframes/:sceneId/preview", async (c) => {
  const taskId = c.req.param("taskId")
  const sceneId = c.req.param("sceneId")
  const assets = await getTaskAssets(taskId)
  const keyframeAsset = assets.find((asset) => asset.assetType === "keyframe_bundle" && asset.exists) ?? null
  if (!keyframeAsset) {
    return c.json({ message: "KEYFRAME_BUNDLE_NOT_FOUND" }, 404)
  }

  if (keyframeAsset.isDirectory) {
    return c.json({ message: "KEYFRAME_BUNDLE_INVALID", path: keyframeAsset.displayPath }, 409)
  }

  try {
    const rawManifest = await fs.readFile(keyframeAsset.path, "utf8")
    const manifest = JSON.parse(rawManifest) as {
      frames?: Array<{ sceneId?: string; sceneIndex?: number; fileName?: string }>
    }
    const frame = manifest.frames?.find((item) => item.sceneId === sceneId) ?? null
    if (!frame?.fileName) {
      return c.json({ message: "KEYFRAME_FRAME_NOT_FOUND", sceneId }, 404)
    }

    const imagePath = path.join(path.dirname(keyframeAsset.path), frame.fileName)
    const imageBytes = await fs.readFile(imagePath)
    const extension = path.extname(frame.fileName).toLowerCase()
    const mimeType =
      extension === ".png"
        ? "image/png"
        : extension === ".webp"
          ? "image/webp"
          : "image/jpeg"
    c.header("Content-Type", mimeType)
    c.header("Cache-Control", "no-store")
    return c.body(imageBytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR"
    if (message.includes("ENOENT")) {
      return c.json({ message: "KEYFRAME_IMAGE_FILE_NOT_FOUND", sceneId }, 404)
    }

    return c.json({ message: "KEYFRAME_PREVIEW_UNAVAILABLE", sceneId }, 409)
  }
})

app.post("/api/tasks", async (c) => {
  const rawBody = await c.req.json().catch(() => null)
  const normalizedBody =
    rawBody && typeof rawBody === "object"
      ? {
          ...rawBody,
          projectId: (rawBody as Record<string, unknown>).projectId ?? "project_default",
          terminalPresetId: (rawBody as Record<string, unknown>).terminalPresetId ?? "phone_portrait",
          generationMode:
            (rawBody as Record<string, unknown>).generationMode ??
            (rawBody as Record<string, unknown>).generationPreference,
        }
      : rawBody
  const parsed = createTaskInputSchema.safeParse(normalizedBody)
  if (!parsed.success) {
    return c.json({ message: "INVALID_TASK_PAYLOAD" }, 400)
  }

  try {
    await assertQueueAvailable()
  } catch (error) {
    return toQueueUnavailableResponse(c, error)
  }

  let result
  try {
    result = await createTask(parsed.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR"
    if (message === "PROJECT_NOT_FOUND") {
      return c.json({ message }, 404)
    }
    throw error
  }
  let queue
  try {
    queue = await enqueueTask(result.task.id, { reason: "initial_create" })
  } catch (error) {
    await deleteTask(result.task.id)
    return toQueueUnavailableResponse(c, error)
  }
  const createdDetail = await getTaskDetail(result.task.id)
  const planning = buildPlanningSnapshot(
    result.task.targetDurationSec,
    createdDetail?.scenes.length ?? getSceneCountHint(result.task.targetDurationSec),
    result.task.generationMode,
    result.task.generationRoute,
    result.task.routeReason,
    "任务持久化",
  )
  taskPlanningState.set(result.task.id, planning)

  return c.json({ ...result, task: { ...result.task, planning }, queue }, 201)
})

const port = Number(process.env.PORT || 8787)
if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port })
  console.log(`GENERGI API listening on http://localhost:${port}`)
}
