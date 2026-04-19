import fs from "node:fs/promises"
import path from "node:path"
import { buildDefaultTaskRunConfig, estimateCost, resolveVideoModelCapability } from "@genergi/config"
import {
  buildStoryboardScenes,
  createDefaultReviewSummary,
  deleteTaskAssets,
  deleteTaskDetail,
  normalizeStoryboardScene,
  normalizeTaskDetailRecord,
  readTaskAssets,
  readTaskDetail,
  readTaskSummaries,
  upsertTaskDetail,
  writeTaskSummaries,
} from "@genergi/shared"
import type {
  CreateTaskInput,
  ReviewDecisionInput,
  ReviewStageId,
  ReviewSummary,
  StoryboardScene,
  TaskDetail,
  TaskRunConfig,
  TaskSummary,
  TaskStatus,
} from "@genergi/shared"
import { resolveEffectiveSlots } from "./model-control/resolver.js"

function now() {
  return new Date().toISOString()
}

export type AssetPreviewKind = "text" | "json" | "media" | "directory" | "binary"

export type ResolvedAssetRecord = {
  fileName: string
  directoryName: string | null
  displayPath: string
  extension: string | null
  mimeType: string
  sizeBytes: number | null
  sizeLabel: string
  exists: boolean
  isDirectory: boolean
  previewable: boolean
  previewKind: AssetPreviewKind
  modifiedAt: string | null
  downloadFileName: string
}

const terminalTaskStatuses = new Set<TaskStatus>(["failed", "completed", "canceled"])

function formatBytes(sizeBytes: number | null) {
  if (sizeBytes == null) {
    return "未知大小"
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }

  const units = ["KB", "MB", "GB", "TB"]
  let value = sizeBytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function normalizeAssetPath(assetPath: string) {
  const trimmed = assetPath.trim()
  return trimmed.length ? trimmed : "."
}

function getAssetFileName(assetPath: string) {
  const resolved = normalizeAssetPath(assetPath)
  const fileName = path.basename(resolved)
  return fileName.length ? fileName : resolved
}

function getAssetDirectoryName(assetPath: string, isDirectory: boolean) {
  if (!isDirectory) {
    return path.dirname(normalizeAssetPath(assetPath))
  }

  const resolved = normalizeAssetPath(assetPath)
  const parentDirectory = path.dirname(resolved)
  return parentDirectory === resolved ? null : parentDirectory
}

function getAssetExtension(assetType: string, fileName: string, isDirectory: boolean) {
  if (isDirectory) {
    return null
  }

  const ext = path.extname(fileName).toLowerCase()
  if (ext) {
    return ext
  }

  if (assetType === "audio") {
    return ".mp3"
  }

  if (assetType === "video_bundle") {
    return ".mp4"
  }

  if (assetType === "storyboard") {
    return ".json"
  }

  if (assetType === "subtitles") {
    return ".srt"
  }

  if (assetType === "script") {
    return ".txt"
  }

  return null
}

function getAssetMimeType(assetType: string, extension: string | null, isDirectory: boolean) {
  if (isDirectory) {
    return "application/x-directory"
  }

  switch (assetType) {
    case "script":
      return "text/plain; charset=utf-8"
    case "storyboard":
      return "application/json"
    case "subtitles":
      return "application/x-subrip; charset=utf-8"
    case "audio":
      return "audio/mpeg"
    case "video_bundle":
      return "video/mp4"
    case "keyframe_bundle":
      return "application/octet-stream"
    default:
      break
  }

  switch (extension) {
    case ".json":
      return "application/json"
    case ".srt":
      return "application/x-subrip; charset=utf-8"
    case ".txt":
    case ".md":
    case ".csv":
    case ".log":
      return "text/plain; charset=utf-8"
    case ".mp4":
      return "video/mp4"
    case ".mp3":
      return "audio/mpeg"
    case ".wav":
      return "audio/wav"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    default:
      return "application/octet-stream"
  }
}

function getPreviewKind(assetType: string, extension: string | null, isDirectory: boolean): AssetPreviewKind {
  if (isDirectory) {
    return "directory"
  }

  if (assetType === "storyboard" || extension === ".json") {
    return "json"
  }

  if (assetType === "audio" || assetType === "video_bundle" || [".mp4", ".mp3", ".wav", ".m4a", ".aac", ".webm"].includes(extension ?? "")) {
    return "media"
  }

  if (
    assetType === "script" ||
    assetType === "subtitles" ||
    [".txt", ".md", ".csv", ".log", ".srt", ".vtt"].includes(extension ?? "")
  ) {
    return "text"
  }

  return "binary"
}

async function resolveAssetRecord(asset: any): Promise<ResolvedAssetRecord & typeof asset> {
  const normalizedPath = normalizeAssetPath(asset.path ?? "")
  const fileName = getAssetFileName(normalizedPath)
  let exists = false
  let isDirectory = false
  let sizeBytes: number | null = null
  let modifiedAt: string | null = null

  try {
    const stats = await fs.stat(normalizedPath)
    exists = true
    isDirectory = stats.isDirectory()
    sizeBytes = isDirectory ? null : stats.size
    modifiedAt = stats.mtime.toISOString()
  } catch {
    exists = false
  }

  const extension = getAssetExtension(asset.assetType ?? "script", fileName, isDirectory)
  const mimeType = getAssetMimeType(asset.assetType ?? "script", extension, isDirectory)
  const previewKind = getPreviewKind(asset.assetType ?? "script", extension, isDirectory)

  return {
    ...asset,
    path: normalizedPath,
    fileName,
    directoryName: getAssetDirectoryName(normalizedPath, isDirectory),
    displayPath: path.normalize(normalizedPath),
    extension,
    mimeType,
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
    exists,
    isDirectory,
    previewable: exists && !isDirectory && previewKind !== "binary",
    previewKind,
    modifiedAt,
    downloadFileName: fileName,
  }
}

export function normalizeSceneReviewMetadata(scene: StoryboardScene) {
  return normalizeStoryboardScene(scene)
}

function mergeSceneReviewMetadata(
  existingScenes: StoryboardScene[],
  nextScenes: StoryboardScene[],
): StoryboardScene[] {
  const normalizedExisting = existingScenes.map((scene) => normalizeSceneReviewMetadata(scene))
  const byId = new Map(normalizedExisting.map((scene) => [scene.id, scene]))

  return nextScenes.map((scene, index) => {
    const preserved = byId.get(scene.id) ?? normalizedExisting[index]
    if (!preserved) {
      return normalizeSceneReviewMetadata(scene)
    }

    return normalizeSceneReviewMetadata({
      ...scene,
      reviewStatus: preserved.reviewStatus,
      reviewNote: preserved.reviewNote,
      reviewedAt: preserved.reviewedAt,
      keyframeStatus: preserved.keyframeStatus,
      keyframeReviewNote: preserved.keyframeReviewNote,
      keyframeReviewedAt: preserved.keyframeReviewedAt,
    })
  })
}

function findLatestReviewTimestamp(scenes: StoryboardScene[]) {
  const timestamps = scenes.flatMap((scene) =>
    [scene.reviewedAt, scene.keyframeReviewedAt].filter((value): value is string => Boolean(value)),
  )

  if (timestamps.length === 0) {
    return null
  }

  return timestamps.reduce((latest, value) => (value > latest ? value : latest))
}

export function deriveReviewSummary(detail: Pick<TaskDetail, "scenes" | "taskRunConfig">): ReviewSummary {
  const scenes = detail.scenes.map((scene) => normalizeSceneReviewMetadata(scene))
  if (scenes.length === 0) {
    return {
      reviewStage: null,
      pendingReviewCount: 0,
      reviewUpdatedAt: null,
    }
  }

  const latestReviewUpdatedAt = findLatestReviewTimestamp(scenes)
  const requireStoryboardReview = detail.taskRunConfig.requireStoryboardReview
  const requireKeyframeReview = detail.taskRunConfig.requireKeyframeReview

  const storyboardPendingCount = requireStoryboardReview
    ? scenes.filter((scene) => scene.reviewStatus === "pending").length
    : 0
  const storyboardApproved = !requireStoryboardReview || scenes.every((scene) => scene.reviewStatus === "approved")
  if (requireStoryboardReview && !storyboardApproved) {
    return {
      reviewStage: "storyboard_review",
      pendingReviewCount: storyboardPendingCount,
      reviewUpdatedAt: latestReviewUpdatedAt,
    }
  }

  const keyframePendingCount = requireKeyframeReview
    ? scenes.filter((scene) => scene.keyframeStatus === "pending").length
    : 0
  const keyframeApproved = !requireKeyframeReview || scenes.every((scene) => scene.keyframeStatus === "approved")
  if (requireKeyframeReview && !keyframeApproved) {
    return {
      reviewStage: "keyframe_review",
      pendingReviewCount: keyframePendingCount,
      reviewUpdatedAt: latestReviewUpdatedAt,
    }
  }

  return {
    reviewStage: "auto_qa",
    pendingReviewCount: 0,
    reviewUpdatedAt: latestReviewUpdatedAt,
  }
}

function resolveReviewStageForTaskStatus(
  currentStatus: TaskStatus,
  reviewSummary: ReviewSummary,
): ReviewStageId | null {
  if (reviewSummary.reviewStage !== "auto_qa") {
    return reviewSummary.reviewStage ?? null
  }

  return terminalTaskStatuses.has(currentStatus) ? null : reviewSummary.reviewStage
}

function resolveTaskStatusForReview(
  currentStatus: TaskStatus,
  reviewStage: ReviewStageId | null,
): TaskStatus {
  if (reviewStage === "storyboard_review" || reviewStage === "keyframe_review") {
    return terminalTaskStatuses.has(currentStatus) ? currentStatus : "waiting_review"
  }

  if (reviewStage === "auto_qa") {
    if (currentStatus === "waiting_review" || currentStatus === "queued" || currentStatus === "draft" || currentStatus === "paused") {
      return "running"
    }

    return currentStatus
  }

  return currentStatus
}

function applyDerivedReviewState(detail: TaskDetail, currentStatus: TaskStatus) {
  const reviewSummary = deriveReviewSummary(detail)
  const resolvedReviewStage = resolveReviewStageForTaskStatus(currentStatus, reviewSummary)
  return {
    detail: normalizeTaskDetailRecord({
      ...detail,
      reviewStage: resolvedReviewStage,
      pendingReviewCount: reviewSummary.pendingReviewCount,
      reviewUpdatedAt: reviewSummary.reviewUpdatedAt,
    }),
    reviewSummary: {
      reviewStage: resolvedReviewStage,
      pendingReviewCount: reviewSummary.pendingReviewCount,
      reviewUpdatedAt: reviewSummary.reviewUpdatedAt,
    } satisfies ReviewSummary,
    status: resolveTaskStatusForReview(currentStatus, resolvedReviewStage),
  }
}

function buildSceneReviewRequirements(taskRunConfig: TaskRunConfig) {
  return {
    requireStoryboardReview: taskRunConfig.requireStoryboardReview,
    requireKeyframeReview: taskRunConfig.requireKeyframeReview,
  }
}

function mapResolvedSlotsToTaskConfig(
  taskRunConfig: TaskRunConfig,
  slotSnapshots: TaskRunConfig["slotSnapshots"],
): TaskRunConfig {
  const bySlot = new Map(slotSnapshots.map((slot) => [slot.slotType, slot]))

  const textModel = bySlot.get("textModel")
  const imageDraftModel = bySlot.get("imageDraftModel")
  const imageFinalModel = bySlot.get("imageFinalModel")
  const videoDraftModel = bySlot.get("videoDraftModel")
  const videoFinalModel = bySlot.get("videoFinalModel")
  const ttsProvider = bySlot.get("ttsProvider")

  return {
    ...taskRunConfig,
    textModel: textModel
      ? { id: textModel.modelKey, label: textModel.displayName, provider: textModel.providerType }
      : taskRunConfig.textModel,
    imageDraftModel: imageDraftModel
      ? { id: imageDraftModel.modelKey, label: imageDraftModel.displayName, provider: imageDraftModel.providerType }
      : taskRunConfig.imageDraftModel,
    imageFinalModel: imageFinalModel
      ? { id: imageFinalModel.modelKey, label: imageFinalModel.displayName, provider: imageFinalModel.providerType }
      : taskRunConfig.imageFinalModel,
    videoDraftModel: videoDraftModel
      ? { id: videoDraftModel.modelKey, label: videoDraftModel.displayName, provider: videoDraftModel.providerType }
      : taskRunConfig.videoDraftModel,
    videoFinalModel: videoFinalModel
      ? { id: videoFinalModel.modelKey, label: videoFinalModel.displayName, provider: videoFinalModel.providerType }
      : taskRunConfig.videoFinalModel,
    ttsProvider: ttsProvider?.providerModelId ?? taskRunConfig.ttsProvider,
    slotSnapshots,
  }
}

async function syncTaskSummaryFromDetail(
  task: TaskSummary,
  detail: TaskDetail,
  updatedAt: string,
) {
  const tasks = await readTaskSummaries()
  let nextSummary: TaskSummary | null = null

  const nextTasks = tasks.map((entry) => {
    if (entry.id !== task.id) {
      return entry
    }

    const derived = applyDerivedReviewState(detail, entry.status)
    nextSummary = {
      ...entry,
      status: derived.status,
      reviewStage: derived.reviewSummary.reviewStage,
      pendingReviewCount: derived.reviewSummary.pendingReviewCount,
      reviewUpdatedAt: derived.reviewSummary.reviewUpdatedAt,
      updatedAt,
    }
    return nextSummary
  })

  if (nextSummary) {
    await writeTaskSummaries(nextTasks)
  }

  return nextSummary
}

export async function listTasks(): Promise<TaskSummary[]> {
  return readTaskSummaries()
}

export async function getTaskDetail(taskId: string) {
  const existing = await readTaskDetail(taskId)
  const tasks = await listTasks()
  const task = tasks.find((item) => item.id === taskId)
  if (!task) {
    return null
  }

  const taskRunConfig = buildDefaultTaskRunConfig(
    task.modeId,
    task.channelId,
    task.targetDurationSec,
    task.generationMode,
  )
  if (existing) {
    const normalizedExisting = normalizeTaskDetailRecord(existing)
    const totalSceneDuration = normalizedExisting.scenes.reduce((total, scene) => total + scene.durationSec, 0)
    const hasExpectedDuration = existing.taskRunConfig.targetDurationSec === task.targetDurationSec
    const hasExpectedRoute = existing.taskRunConfig.generationRoute === task.generationRoute
    if (hasExpectedDuration && hasExpectedRoute && totalSceneDuration === task.targetDurationSec) {
      const derived = applyDerivedReviewState(
        {
          ...normalizedExisting,
          actualDurationSec: normalizedExisting.actualDurationSec ?? task.actualDurationSec,
        },
        task.status,
      )
      const summaryChanged =
        task.reviewStage !== derived.reviewSummary.reviewStage ||
        task.pendingReviewCount !== derived.reviewSummary.pendingReviewCount ||
        task.reviewUpdatedAt !== derived.reviewSummary.reviewUpdatedAt ||
        task.status !== derived.status
      const detailChanged =
        normalizedExisting.reviewStage !== derived.detail.reviewStage ||
        normalizedExisting.pendingReviewCount !== derived.detail.pendingReviewCount ||
        normalizedExisting.reviewUpdatedAt !== derived.detail.reviewUpdatedAt

      if (detailChanged) {
        await upsertTaskDetail(derived.detail)
      }
      if (summaryChanged) {
        await syncTaskSummaryFromDetail(task, derived.detail, normalizedExisting.updatedAt)
      }

      return derived.detail
    }

    const rebuiltScenes = mergeSceneReviewMetadata(
      normalizedExisting.scenes,
      buildStoryboardScenes({
        script: normalizedExisting.script,
        targetDurationSec: task.targetDurationSec,
        maxSceneDurationSec: resolveVideoModelCapability(taskRunConfig.videoDraftModel.id).maxSingleShotSec,
        aspectRatio: taskRunConfig.aspectRatio,
        reviewRequirements: buildSceneReviewRequirements(taskRunConfig),
      }),
    )
    const normalized = applyDerivedReviewState(
      {
        ...normalizedExisting,
        taskRunConfig,
        actualDurationSec: normalizedExisting.actualDurationSec ?? task.actualDurationSec,
        scenes: rebuiltScenes,
        updatedAt: now(),
      },
      task.status,
    ).detail
    await upsertTaskDetail(normalized)
    await syncTaskSummaryFromDetail(task, normalized, normalized.updatedAt)
    return normalized
  }

  const script = `${task.title}. Keep the tone native-English, product-forward, and optimized for short-form social video.`
  const synthesized = applyDerivedReviewState(
    {
      taskId: task.id,
      title: task.title,
      script,
      taskRunConfig,
      actualDurationSec: task.actualDurationSec,
      scenes: buildStoryboardScenes({
        script,
        targetDurationSec: task.targetDurationSec,
        maxSceneDurationSec: resolveVideoModelCapability(taskRunConfig.videoDraftModel.id).maxSingleShotSec,
        aspectRatio: taskRunConfig.aspectRatio,
        reviewRequirements: buildSceneReviewRequirements(taskRunConfig),
      }),
      updatedAt: task.updatedAt,
    },
    task.status,
  ).detail

  await upsertTaskDetail(synthesized)
  await syncTaskSummaryFromDetail(task, synthesized, synthesized.updatedAt)
  return synthesized
}

export async function getTaskAssets(taskId: string) {
  const assets = await readTaskAssets(taskId)
  return Promise.all(assets.map((asset) => resolveAssetRecord(asset)))
}

export async function getTaskAsset(taskId: string, assetId: string) {
  const assets = await readTaskAssets(taskId)
  const asset = assets.find((item) => item.id === assetId) ?? null
  return asset ? resolveAssetRecord(asset) : null
}

export async function createTask(input: CreateTaskInput): Promise<{ task: TaskSummary; taskRunConfig: unknown }> {
  const tasks = await listTasks()
  const estimate = estimateCost(input.modeId)
  const timestamp = now()
  let taskRunConfig = buildDefaultTaskRunConfig(
    input.modeId,
    input.channelId,
    input.targetDurationSec,
    input.generationMode,
  )
  const resolvedSlots = await resolveEffectiveSlots({
    modeId: input.modeId,
    taskOverrides: input.modelOverrides,
  })
  taskRunConfig = mapResolvedSlotsToTaskConfig(
    {
      ...taskRunConfig,
      modelOverrides: input.modelOverrides,
    },
    resolvedSlots,
  )
  const taskId = `task_${Date.now()}`
  const detail = applyDerivedReviewState(
    {
      taskId,
      title: input.title,
      script: input.script,
      taskRunConfig,
      actualDurationSec: null,
      scenes: buildStoryboardScenes({
        script: input.script,
        targetDurationSec: input.targetDurationSec,
        maxSceneDurationSec: resolveVideoModelCapability(taskRunConfig.videoDraftModel.id).maxSingleShotSec,
        aspectRatio: taskRunConfig.aspectRatio,
        reviewRequirements: buildSceneReviewRequirements(taskRunConfig),
      }),
      updatedAt: timestamp,
      ...createDefaultReviewSummary(),
    },
    "queued",
  ).detail
  const task: TaskSummary = {
    id: taskId,
    title: input.title,
    modeId: input.modeId,
    channelId: input.channelId,
    targetDurationSec: input.targetDurationSec,
    generationMode: input.generationMode,
    generationRoute: taskRunConfig.generationRoute,
    routeReason: taskRunConfig.routeReason,
    planningVersion: taskRunConfig.planningVersion,
    actualDurationSec: null,
    status: resolveTaskStatusForReview("queued", detail.reviewStage ?? null),
    progressPct: 0,
    retryCount: 0,
    estimatedCostCny: estimate.budgetUsagePct / 100 * taskRunConfig.budgetLimitCny,
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewStage: detail.reviewStage,
    pendingReviewCount: detail.pendingReviewCount,
    reviewUpdatedAt: detail.reviewUpdatedAt,
  }

  tasks.unshift(task)
  await writeTaskSummaries(tasks)
  await upsertTaskDetail(detail)

  return {
    task,
    taskRunConfig,
  }
}

export async function deleteTask(taskId: string) {
  const tasks = await listTasks()
  const nextTasks = tasks.filter((task) => task.id !== taskId)
  if (nextTasks.length !== tasks.length) {
    await writeTaskSummaries(nextTasks)
  }

  await deleteTaskDetail(taskId)
  await deleteTaskAssets(taskId)
}

export async function applySceneReviewDecision(
  taskId: string,
  input: ReviewDecisionInput,
): Promise<{ summary: TaskSummary; detail: TaskDetail } | null> {
  const tasks = await listTasks()
  const task = tasks.find((entry) => entry.id === taskId)
  if (!task) {
    return null
  }

  const existingDetail = await getTaskDetail(taskId)
  if (!existingDetail) {
    return null
  }

  const sceneIndex = existingDetail.scenes.findIndex((scene) => scene.id === input.sceneId)
  if (sceneIndex < 0) {
    return null
  }

  const decisionAt = now()
  const nextScenes = existingDetail.scenes.map((scene, index) => {
    const normalizedScene = normalizeSceneReviewMetadata(scene)
    if (index !== sceneIndex) {
      return normalizedScene
    }

    if (input.stage === "storyboard_review") {
      return normalizeSceneReviewMetadata({
        ...normalizedScene,
        reviewStatus: input.decision,
        reviewNote: input.note ?? null,
        reviewedAt: decisionAt,
      })
    }

    return normalizeSceneReviewMetadata({
      ...normalizedScene,
      keyframeStatus: input.decision,
      keyframeReviewNote: input.note ?? null,
      keyframeReviewedAt: decisionAt,
    })
  })

  const nextDetail = applyDerivedReviewState(
    {
      ...existingDetail,
      scenes: nextScenes,
      updatedAt: decisionAt,
    },
    task.status,
  ).detail
  await upsertTaskDetail(nextDetail)

  const summary = await syncTaskSummaryFromDetail(task, nextDetail, decisionAt)
  if (!summary) {
    return null
  }

  return {
    summary,
    detail: nextDetail,
  }
}
