import fs from "node:fs/promises"
import path from "node:path"
import { buildDefaultTaskRunConfig, estimateCost, resolveVideoModelCapability } from "@genergi/config"
import {
  appendTaskOperationAuditRecord,
  buildStoryboardScenes,
  createDefaultReviewSummary,
  deleteTaskAssets as deletePersistedTaskAssets,
  deleteTaskDetail,
  deleteTaskTimeline,
  normalizeTaskSummaryRecord,
  normalizeStoryboardScene,
  normalizeTaskDetailRecord,
  readTaskAssets,
  readTaskBlueprintRecords,
  readTaskDetail,
  readTaskDetails,
  readTaskOperationAuditRecords,
  readTaskSummaries,
  upsertTaskAssets,
  upsertTaskDetail,
  writeTaskSummaries,
} from "@genergi/shared"
import type {
  AssetRecord,
  CreateTaskInput,
  ReviewDecisionInput,
  ReviewStageId,
  ReviewSummary,
  StoryboardScene,
  TaskDetail,
  TaskOperationAuditRecord,
  TaskOperationType,
  TaskRunConfig,
  TaskSummary,
  TaskStatus,
} from "@genergi/shared"
import { createInitialTaskBlueprintRecord } from "./blueprint-store.js"
import { resolveEffectiveSlots } from "./model-control/resolver.js"
import { getProjectById } from "./project-store.js"

function now() {
  return new Date().toISOString()
}

function inferCreatedAtFromTaskId(taskId: string, fallback: string) {
  const match = /^task_(\d{13})$/.exec(taskId)
  if (!match) {
    return fallback
  }

  const timestamp = Number(match[1])
  if (!Number.isFinite(timestamp)) {
    return fallback
  }

  return new Date(timestamp).toISOString()
}

function resolveTaskDataDir() {
  return process.env.GENERGI_DATA_DIR
    ? path.resolve(process.env.GENERGI_DATA_DIR)
    : path.resolve(process.cwd(), ".data")
}

function resolveTaskExportDir(taskId: string) {
  return path.join(resolveTaskDataDir(), "exports", taskId)
}

function resolveTaskSharedAssetDir(taskId: string) {
  return path.join(resolveTaskDataDir(), "assets", taskId)
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
const safeTaskAssetIdPattern = /^[A-Za-z0-9_-]+$/

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

  if (assetType === "planning_audit") {
    return ".json"
  }

  if (assetType === "subtitles") {
    return ".srt"
  }

  if (
    assetType === "script" ||
    assetType === "source_script" ||
    assetType === "planning_prompt" ||
    assetType === "planning_response"
  ) {
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
    case "source_script":
    case "planning_prompt":
    case "planning_response":
      return "text/plain; charset=utf-8"
    case "storyboard":
    case "planning_audit":
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

  if (
    assetType === "audio" ||
    assetType === "video_bundle" ||
    assetType === "scene_video" ||
    assetType === "keyframe_image" ||
    [".mp4", ".mp3", ".wav", ".m4a", ".aac", ".webm", ".png", ".jpg", ".jpeg", ".webp"].includes(extension ?? "")
  ) {
    return "media"
  }

  if (
    assetType === "script" ||
    assetType === "source_script" ||
    assetType === "planning_prompt" ||
    assetType === "planning_response" ||
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

async function inferExportedAssets(taskId: string): Promise<AssetRecord[]> {
  const exportDir = resolveTaskExportDir(taskId)
  const exists = await fs
    .stat(exportDir)
    .then((stats) => stats.isDirectory())
    .catch(() => false)

  if (!exists) {
    return []
  }

  const createdAt = now()
  const assets: AssetRecord[] = []
  const pushIfExists = async (entry: {
    id: string
    assetType: AssetRecord["assetType"]
    label: string
    relativePath: string
  }) => {
    const assetPath = path.join(exportDir, entry.relativePath)
    const present = await fs
      .stat(assetPath)
      .then((stats) => stats.isFile())
      .catch(() => false)

    if (!present) {
      return
    }

    assets.push({
      id: entry.id,
      taskId,
      assetType: entry.assetType,
      label: entry.label,
      status: "ready",
      path: assetPath,
      createdAt,
    })
  }

  await pushIfExists({ id: `${taskId}_script`, assetType: "script", label: "英文脚本", relativePath: "script.txt" })
  await pushIfExists({ id: `${taskId}_source_script`, assetType: "source_script", label: "任务母本", relativePath: "source-script.txt" })
  await pushIfExists({ id: `${taskId}_planning_prompt`, assetType: "planning_prompt", label: "文本规划提示词", relativePath: "planning-prompt.txt" })
  await pushIfExists({ id: `${taskId}_planning_response`, assetType: "planning_response", label: "文本模型原始返回", relativePath: "planning-response.txt" })
  await pushIfExists({ id: `${taskId}_planning_audit`, assetType: "planning_audit", label: "文本规划审计 JSON", relativePath: "planning-audit.json" })
  await pushIfExists({ id: `${taskId}_storyboard`, assetType: "storyboard", label: "分镜 JSON", relativePath: "storyboard.json" })
  await pushIfExists({ id: `${taskId}_subtitles`, assetType: "subtitles", label: "英文字幕", relativePath: "subtitles.srt" })
  await pushIfExists({ id: `${taskId}_audio`, assetType: "audio", label: "英文配音", relativePath: "narration.mp3" })
  await pushIfExists({ id: `${taskId}_video`, assetType: "video_bundle", label: "最终视频", relativePath: path.join("video", "final-with-audio.mp4") })
  const videoDir = path.join(exportDir, "video")
  const videoEntries = await fs
    .readdir(videoDir, { withFileTypes: true })
    .catch(() => [])
  for (const entry of videoEntries) {
    if (!entry.isFile() || !/^scene-\d+\.mp4$/i.test(entry.name)) {
      continue
    }
    const sceneMatch = entry.name.match(/^scene-(\d+)\.mp4$/i)
    const sceneNumber = sceneMatch?.[1] ? Number.parseInt(sceneMatch[1], 10) : null
    await pushIfExists({
      id: `${taskId}_scene_video_scene_${sceneNumber ?? entry.name}`,
      assetType: "scene_video",
      label: sceneNumber ? `分段视频 ${sceneNumber}` : `分段视频 ${entry.name}`,
      relativePath: path.join("video", entry.name),
    })
  }

  const manifestPath = path.join(exportDir, "keyframes", "manifest.json")
  const manifestExists = await fs
    .stat(manifestPath)
    .then((stats) => stats.isFile())
    .catch(() => false)

  if (manifestExists) {
    assets.push({
      id: `${taskId}_keyframes`,
      taskId,
      assetType: "keyframe_bundle",
      label: "关键帧包",
      status: "ready",
      path: manifestPath,
      createdAt,
    })

    try {
      const rawManifest = await fs.readFile(manifestPath, "utf8")
      const manifest = JSON.parse(rawManifest) as {
        frames?: Array<{
          sceneId?: string
          sceneIndex?: number
          title?: string
          fileName?: string
          filePath?: string
        }>
      }
      for (const frame of manifest.frames ?? []) {
        const sceneId = `${frame.sceneId ?? `scene_${frame.sceneIndex ?? assets.length}`}`.trim()
        const sceneIndex = typeof frame.sceneIndex === "number" ? frame.sceneIndex : assets.length - 1
        const imagePath = frame.filePath?.trim()
          ? frame.filePath.trim()
          : frame.fileName
            ? path.join(path.dirname(manifestPath), frame.fileName)
            : null
        if (!imagePath) {
          continue
        }
        const imageExists = await fs
          .stat(imagePath)
          .then((stats) => stats.isFile())
          .catch(() => false)
        if (!imageExists) {
          continue
        }

        assets.push({
          id: `${taskId}_keyframe_${sceneId}`,
          taskId,
          assetType: "keyframe_image",
          label: `关键画面 ${sceneIndex + 1}${frame.title ? ` · ${frame.title}` : ""}`,
          status: "ready",
          path: imagePath,
          createdAt,
        })
      }
    } catch {
      // Ignore malformed manifests and fall back to the bundle record only.
    }
  }

  return assets
}

async function readMergedTaskAssets(taskId: string) {
  const storedAssets = await readTaskAssets(taskId)
  const inferredAssets = await inferExportedAssets(taskId)
  const merged = new Map<string, AssetRecord>()

  for (const asset of inferredAssets) {
    merged.set(asset.id, asset)
  }
  for (const asset of storedAssets) {
    merged.set(asset.id, asset)
  }

  return [...merged.values()]
}

function isPathInsideOrEqual(candidatePath: string, rootPath: string) {
  const resolvedCandidate = path.resolve(candidatePath)
  const resolvedRoot = path.resolve(rootPath)
  const relativePath = path.relative(resolvedRoot, resolvedCandidate)
  return relativePath === "" || (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

function isSafeTaskAssetPath(taskId: string, candidatePath: string) {
  return (
    isPathInsideOrEqual(candidatePath, resolveTaskExportDir(taskId)) ||
    isPathInsideOrEqual(candidatePath, resolveTaskSharedAssetDir(taskId))
  )
}

function isSafeTaskAssetId(taskId: string) {
  return safeTaskAssetIdPattern.test(taskId)
}

async function getTaskAssetDeletionLock(taskId: string) {
  if (!isSafeTaskAssetId(taskId)) {
    return { locked: true as const, reason: "TASK_ASSET_TASK_ID_FORBIDDEN" as const }
  }

  const tasks = await listTasks({ includeArchived: true })
  const task = tasks.find((entry) => entry.id === taskId) ?? null
  if (!task) {
    return { locked: true as const, reason: "TASK_NOT_FOUND" as const }
  }

  if (!terminalTaskStatuses.has(task.status) && task.status !== "waiting_review") {
    return {
      locked: true as const,
      reason: "TASK_ASSETS_LOCKED" as const,
      status: task.status,
    }
  }

  return { locked: false as const, task }
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
  if (currentStatus === "queued" && detail.statusDetail === "等待 worker 恢复处理") {
    return {
      detail: normalizeTaskDetailRecord({
        ...detail,
        reviewStage: null,
        pendingReviewCount: 0,
        reviewUpdatedAt: null,
      }),
      reviewSummary: {
        reviewStage: null,
        pendingReviewCount: 0,
        reviewUpdatedAt: null,
      } satisfies ReviewSummary,
      status: "queued" as const,
    }
  }

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

function inferBaseTaskStatusFromDetail(detail: TaskDetail): TaskStatus {
  const statusDetail = detail.statusDetail ?? ""

  if (statusDetail.includes("终止") || detail.cancelRequestedAt) {
    return "canceled"
  }

  if (detail.failureReason || statusDetail.includes("失败")) {
    return "failed"
  }

  if (detail.actualDurationSec != null || detail.blueprintStatus === "completed") {
    return "completed"
  }

  if (statusDetail === "等待 worker 恢复处理") {
    return "queued"
  }

  if (
    detail.blueprintStatus === "ready_for_review" ||
    detail.blueprintStatus === "approved" ||
    detail.blueprintStatus === "rejected"
  ) {
    return "waiting_review"
  }

  if (
    detail.blueprintStatus === "queued_for_video" ||
    detail.blueprintStatus === "video_generating" ||
    statusDetail.includes("准备") ||
    statusDetail.includes("生成") ||
    statusDetail.includes("合成") ||
    statusDetail.includes("复用")
  ) {
    return "running"
  }

  return "queued"
}

function inferProgressPctFromTaskStatus(status: TaskStatus, reviewStage: ReviewStageId | null) {
  if (status === "completed") {
    return 100
  }

  if (status === "waiting_review") {
    return reviewStage === "keyframe_review" ? 45 : 35
  }

  if (status === "running") {
    return 72
  }

  if (status === "failed" || status === "canceled") {
    return 65
  }

  return 0
}

function getLatestBlueprintRecord(
  records: Record<string, Array<{ version: number; status: TaskSummary["blueprintStatus"]; updatedAt: string }>>,
  taskId: string,
) {
  const taskRecords = records[taskId] ?? []
  return taskRecords.slice().sort((left, right) => left.version - right.version).at(-1) ?? null
}

function synchronizeDetailBlueprintState(
  detail: TaskDetail,
  blueprintRecord: { version: number; status: TaskSummary["blueprintStatus"]; updatedAt: string } | null,
) {
  if (!blueprintRecord) {
    return detail
  }

  if (
    detail.blueprintVersion === blueprintRecord.version &&
    detail.blueprintStatus === blueprintRecord.status &&
    detail.taskRunConfig.blueprintVersion === blueprintRecord.version &&
    detail.taskRunConfig.blueprintStatus === blueprintRecord.status
  ) {
    return detail
  }

  return normalizeTaskDetailRecord({
    ...detail,
    blueprintVersion: blueprintRecord.version,
    blueprintStatus: blueprintRecord.status,
    taskRunConfig: {
      ...detail.taskRunConfig,
      blueprintVersion: blueprintRecord.version,
      blueprintStatus: blueprintRecord.status,
    },
    updatedAt: blueprintRecord.updatedAt,
  })
}

function isQueuedBeforeWorkerStarts(detail: TaskDetail) {
  return (
    detail.blueprintStatus === "pending_generation" &&
    detail.actualDurationSec == null &&
    !detail.failureReason &&
    !detail.cancelRequestedAt &&
    (detail.statusDetail ?? "") === "等待 worker 开始处理"
  )
}

function synthesizeTaskSummaryFromDetail(detail: TaskDetail): TaskSummary {
  const createdAt = inferCreatedAtFromTaskId(detail.taskId, detail.updatedAt)
  const estimatedCost = estimateCost(detail.taskRunConfig.modeId)

  if (isQueuedBeforeWorkerStarts(detail)) {
    const reviewSummary = createDefaultReviewSummary()
    return normalizeTaskSummaryRecord({
      id: detail.taskId,
      projectId: detail.projectId,
      title: detail.title,
      modeId: detail.taskRunConfig.modeId,
      executionMode: detail.taskRunConfig.executionMode,
      channelId: detail.taskRunConfig.channelId,
      terminalPresetId: detail.taskRunConfig.terminalPresetId,
      renderSpecJson: detail.taskRunConfig.renderSpecJson,
      targetDurationSec: detail.taskRunConfig.targetDurationSec,
      generationMode: detail.taskRunConfig.generationMode,
      audioStrategy: detail.taskRunConfig.audioStrategy,
      subtitleStrategy: detail.taskRunConfig.subtitleStrategy,
      generationRoute: detail.taskRunConfig.generationRoute,
      routeReason: detail.taskRunConfig.routeReason,
      planningVersion: detail.taskRunConfig.planningVersion,
      blueprintVersion: detail.blueprintVersion,
      blueprintStatus: detail.blueprintStatus,
      actualDurationSec: detail.actualDurationSec ?? null,
      failureReason: null,
      statusDetail: detail.statusDetail ?? null,
      cancelRequestedAt: null,
      status: "queued",
      progressPct: 0,
      retryCount: 0,
      estimatedCostCny: estimatedCost.budgetUsagePct / 100 * detail.taskRunConfig.budgetLimitCny,
      createdAt,
      updatedAt: detail.updatedAt,
      reviewStage: reviewSummary.reviewStage,
      pendingReviewCount: reviewSummary.pendingReviewCount,
      reviewUpdatedAt: reviewSummary.reviewUpdatedAt,
      currentStage: detail.currentStage ?? null,
      currentStageLabel: detail.currentStageLabel ?? null,
      currentSceneIndex: detail.currentSceneIndex ?? null,
      currentSceneTotal: detail.currentSceneTotal ?? null,
      stageStartedAt: detail.stageStartedAt ?? null,
      lastHeartbeatAt: detail.lastHeartbeatAt ?? null,
      workerId: detail.workerId ?? null,
      activeJobId: detail.activeJobId ?? null,
    })
  }

  const baseStatus = inferBaseTaskStatusFromDetail(detail)
  const derived = applyDerivedReviewState(detail, baseStatus)
  const status = derived.status

  return normalizeTaskSummaryRecord({
    id: detail.taskId,
    projectId: detail.projectId,
    title: detail.title,
    modeId: detail.taskRunConfig.modeId,
    executionMode: detail.taskRunConfig.executionMode,
    channelId: detail.taskRunConfig.channelId,
    terminalPresetId: detail.taskRunConfig.terminalPresetId,
    renderSpecJson: detail.taskRunConfig.renderSpecJson,
    targetDurationSec: detail.taskRunConfig.targetDurationSec,
    generationMode: detail.taskRunConfig.generationMode,
    audioStrategy: detail.taskRunConfig.audioStrategy,
    subtitleStrategy: detail.taskRunConfig.subtitleStrategy,
    generationRoute: detail.taskRunConfig.generationRoute,
    routeReason: detail.taskRunConfig.routeReason,
    planningVersion: detail.taskRunConfig.planningVersion,
    blueprintVersion: detail.blueprintVersion,
    blueprintStatus: detail.blueprintStatus,
    actualDurationSec: detail.actualDurationSec ?? null,
    failureReason: detail.failureReason ?? null,
    statusDetail: detail.statusDetail ?? null,
    cancelRequestedAt: detail.cancelRequestedAt ?? null,
    status,
    progressPct: inferProgressPctFromTaskStatus(status, derived.reviewSummary.reviewStage),
    retryCount: status === "failed" ? 1 : 0,
    estimatedCostCny: estimatedCost.budgetUsagePct / 100 * detail.taskRunConfig.budgetLimitCny,
    createdAt,
    updatedAt: detail.updatedAt,
    reviewStage: derived.reviewSummary.reviewStage,
    pendingReviewCount: derived.reviewSummary.pendingReviewCount,
    reviewUpdatedAt: derived.reviewSummary.reviewUpdatedAt,
    currentStage: detail.currentStage ?? null,
    currentStageLabel: detail.currentStageLabel ?? null,
    currentSceneIndex: detail.currentSceneIndex ?? null,
    currentSceneTotal: detail.currentSceneTotal ?? null,
    stageStartedAt: detail.stageStartedAt ?? null,
    lastHeartbeatAt: detail.lastHeartbeatAt ?? null,
    workerId: detail.workerId ?? null,
    activeJobId: detail.activeJobId ?? null,
  })
}

function hasRuntimeTraceDifference(left: TaskSummary, right: TaskSummary) {
  return (
    left.currentStage !== right.currentStage ||
    left.currentStageLabel !== right.currentStageLabel ||
    left.currentSceneIndex !== right.currentSceneIndex ||
    left.currentSceneTotal !== right.currentSceneTotal ||
    left.stageStartedAt !== right.stageStartedAt ||
    left.lastHeartbeatAt !== right.lastHeartbeatAt ||
    left.workerId !== right.workerId ||
    left.activeJobId !== right.activeJobId
  )
}

async function readTaskSummariesWithRepair() {
  const [tasks, details, blueprintRecords] = await Promise.all([readTaskSummaries(), readTaskDetails(), readTaskBlueprintRecords()])
  const taskIds = new Set(tasks.map((task) => task.id))
  const synthesized = Object.values(details)
    .filter((detail) => !taskIds.has(detail.taskId))
    .map((detail) => synthesizeTaskSummaryFromDetail(detail))

  let changed = synthesized.length > 0
  const nextTasks = [...tasks, ...synthesized].map((task) => {
    const blueprintRecord = getLatestBlueprintRecord(blueprintRecords, task.id)
    if (!blueprintRecord) {
      return task
    }

    const detail = details[task.id]
    const synchronizedDetail = detail ? synchronizeDetailBlueprintState(detail, blueprintRecord) : null
    if (synchronizedDetail && synchronizedDetail !== detail) {
      details[task.id] = synchronizedDetail
      changed = true
    }

    const summaryBase = synchronizedDetail
      ? synthesizeTaskSummaryFromDetail(synchronizedDetail)
      : normalizeTaskSummaryRecord({
          ...task,
          blueprintVersion: blueprintRecord.version,
          blueprintStatus: blueprintRecord.status,
          updatedAt: blueprintRecord.updatedAt,
        })
    const shouldAdoptReviewStatus =
      ["ready_for_review", "approved", "rejected"].includes(blueprintRecord.status) &&
      task.status !== "running" &&
      task.status !== "completed" &&
      task.status !== "failed" &&
      task.status !== "canceled"
    const resolvedStatus = shouldAdoptReviewStatus ? summaryBase.status : task.status

    const mergedSummary = normalizeTaskSummaryRecord({
      ...task,
      ...summaryBase,
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      modeId: task.modeId,
      executionMode: task.executionMode,
      channelId: task.channelId,
      terminalPresetId: task.terminalPresetId,
      renderSpecJson: task.renderSpecJson,
      targetDurationSec: task.targetDurationSec,
      generationMode: task.generationMode,
      audioStrategy: task.audioStrategy,
      generationRoute: task.generationRoute,
      routeReason: task.routeReason,
      planningVersion: task.planningVersion,
      status: resolvedStatus,
      progressPct: resolvedStatus === task.status ? task.progressPct : summaryBase.progressPct,
      retryCount: resolvedStatus === task.status ? task.retryCount : summaryBase.retryCount,
      createdAt: task.createdAt,
    })

    if (
      mergedSummary.blueprintVersion !== task.blueprintVersion ||
      mergedSummary.blueprintStatus !== task.blueprintStatus ||
      mergedSummary.status !== task.status ||
      mergedSummary.reviewStage !== task.reviewStage ||
      mergedSummary.pendingReviewCount !== task.pendingReviewCount ||
      mergedSummary.reviewUpdatedAt !== task.reviewUpdatedAt ||
      hasRuntimeTraceDifference(mergedSummary, task)
    ) {
      changed = true
      return mergedSummary
    }

    return task
  })

  const repaired = nextTasks.sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || left.updatedAt)
    const rightTime = Date.parse(right.createdAt || right.updatedAt)
    return rightTime - leftTime
  })

  if (changed) {
    await writeTaskSummaries(repaired)
    const changedDetails = Object.values(details)
    for (const detail of changedDetails) {
      await upsertTaskDetail(detail)
    }
  }

  return repaired
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
  const imageModel = bySlot.get("imageModel")
  const videoModel = bySlot.get("videoModel")
  const ttsProvider = bySlot.get("ttsProvider")

  return {
    ...taskRunConfig,
    textModel: textModel
      ? { id: textModel.providerModelId, label: textModel.displayName, provider: textModel.providerType }
      : taskRunConfig.textModel,
    imageModel: imageModel
      ? { id: imageModel.providerModelId, label: imageModel.displayName, provider: imageModel.providerType }
      : taskRunConfig.imageModel,
    videoModel: videoModel
      ? { id: videoModel.providerModelId, label: videoModel.displayName, provider: videoModel.providerType }
      : taskRunConfig.videoModel,
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
      statusDetail: detail.statusDetail ?? entry.statusDetail ?? null,
      cancelRequestedAt: detail.cancelRequestedAt ?? entry.cancelRequestedAt ?? null,
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

export async function listTasks(options: { includeArchived?: boolean } = {}): Promise<TaskSummary[]> {
  const tasks = await readTaskSummariesWithRepair()
  if (options.includeArchived) {
    return tasks
  }

  return tasks.filter((task) => !task.archivedAt)
}

export async function getTaskDetail(taskId: string) {
  const existing = await readTaskDetail(taskId)
  const tasks = await listTasks({ includeArchived: true })
  const task = tasks.find((item) => item.id === taskId)
  if (!task) {
    return null
  }

  const taskRunConfig = buildDefaultTaskRunConfig(
    task.modeId,
    task.channelId,
    task.targetDurationSec,
    task.generationMode,
    {
      projectId: task.projectId,
      terminalPresetId: task.terminalPresetId,
    },
  )
  taskRunConfig.executionMode = task.executionMode
  taskRunConfig.renderSpecJson = task.renderSpecJson
  taskRunConfig.aspectRatio = task.renderSpecJson.aspectRatio
  taskRunConfig.blueprintVersion = task.blueprintVersion
  taskRunConfig.blueprintStatus = task.blueprintStatus
  if (existing) {
    const normalizedExisting = synchronizeDetailBlueprintState(normalizeTaskDetailRecord(existing), {
      version: task.blueprintVersion,
      status: task.blueprintStatus,
      updatedAt: task.updatedAt,
    })
    const totalSceneDuration = normalizedExisting.scenes.reduce((total, scene) => total + scene.durationSec, 0)
    const hasExpectedDuration = existing.taskRunConfig.targetDurationSec === task.targetDurationSec
    const hasExpectedRoute = existing.taskRunConfig.generationRoute === task.generationRoute
    if (hasExpectedDuration && hasExpectedRoute && totalSceneDuration === task.targetDurationSec) {
      if (
        normalizedExisting.blueprintVersion !== existing.blueprintVersion ||
        normalizedExisting.blueprintStatus !== existing.blueprintStatus ||
        normalizedExisting.taskRunConfig.blueprintVersion !== existing.taskRunConfig.blueprintVersion ||
        normalizedExisting.taskRunConfig.blueprintStatus !== existing.taskRunConfig.blueprintStatus
      ) {
        await upsertTaskDetail(normalizedExisting)
      }
      return {
        ...normalizedExisting,
        actualDurationSec: normalizedExisting.actualDurationSec ?? task.actualDurationSec,
      }
    }

    const rebuiltScenes = mergeSceneReviewMetadata(
      normalizedExisting.scenes,
      buildStoryboardScenes({
        script: normalizedExisting.script,
        targetDurationSec: task.targetDurationSec,
        maxSceneDurationSec: resolveVideoModelCapability(taskRunConfig.videoModel.id).maxSingleShotSec,
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
    return normalized
  }

  const script = `${task.title}. Keep the tone native-English, product-forward, and optimized for short-form social video.`
  const synthesized = applyDerivedReviewState(
    {
      taskId: task.id,
      projectId: task.projectId,
      title: task.title,
      script,
      taskRunConfig,
      blueprintVersion: task.blueprintVersion,
      blueprintStatus: task.blueprintStatus,
      actualDurationSec: task.actualDurationSec,
      scenes: buildStoryboardScenes({
        script,
        targetDurationSec: task.targetDurationSec,
        maxSceneDurationSec: resolveVideoModelCapability(taskRunConfig.videoModel.id).maxSingleShotSec,
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
  const assets = await readMergedTaskAssets(taskId)
  return Promise.all(assets.map((asset) => resolveAssetRecord(asset)))
}

export async function getTaskAsset(taskId: string, assetId: string) {
  const assets = await readMergedTaskAssets(taskId)
  const asset = assets.find((item) => item.id === assetId) ?? null
  return asset ? resolveAssetRecord(asset) : null
}

export async function deleteTaskAsset(taskId: string, assetId: string) {
  const lock = await getTaskAssetDeletionLock(taskId)
  if (lock.locked) {
    return { deleted: false as const, reason: lock.reason, status: lock.status }
  }

  const asset = await getTaskAsset(taskId, assetId)
  if (!asset) {
    return { deleted: false as const, reason: "ASSET_NOT_FOUND" }
  }

  if (!isSafeTaskAssetPath(taskId, asset.path)) {
    return { deleted: false as const, reason: "ASSET_DELETE_PATH_FORBIDDEN" }
  }

  await fs.rm(asset.path, { recursive: asset.isDirectory, force: true })

  const storedAssets = await readTaskAssets(taskId)
  const nextStoredAssets = storedAssets.filter((item) => item.id !== assetId)
  if (nextStoredAssets.length !== storedAssets.length) {
    await upsertTaskAssets(taskId, nextStoredAssets)
  }

  return { deleted: true as const, asset }
}

export async function deleteTaskAssetCollection(taskId: string) {
  const lock = await getTaskAssetDeletionLock(taskId)
  if (lock.locked) {
    return { deleted: false as const, reason: lock.reason, status: lock.status }
  }

  const exportDir = resolveTaskExportDir(taskId)
  const sharedAssetDir = resolveTaskSharedAssetDir(taskId)
  if (
    !isPathInsideOrEqual(exportDir, path.join(resolveTaskDataDir(), "exports")) ||
    !isPathInsideOrEqual(sharedAssetDir, path.join(resolveTaskDataDir(), "assets"))
  ) {
    return { deleted: false as const, reason: "ASSET_DELETE_PATH_FORBIDDEN" }
  }

  await Promise.all([
    fs.rm(exportDir, { recursive: true, force: true }),
    fs.rm(sharedAssetDir, { recursive: true, force: true }),
  ])
  await deletePersistedTaskAssets(taskId)
  return { deleted: true as const }
}

export async function deleteTaskWithAssets(taskId: string) {
  const assetsResult = await deleteTaskAssetCollection(taskId)
  if (!assetsResult.deleted) {
    return assetsResult
  }

  await deleteTask(taskId)
  return { deleted: true as const }
}

export type TaskBulkOperation = "archive" | "restore" | "delete_task_with_assets" | "delete_assets_only" | "cancel" | "resume"

export type TaskBulkPreviewItem = {
  taskId: string
  title: string
  status: string
  archived: boolean
  allowed: boolean
  reason: string
  code: string
  assetSummary: {
    assetCount: number
    hasFinalVideo: boolean
    hasSubtitles: boolean
    hasScript: boolean
  }
}

export type TaskBulkResultItem = TaskBulkPreviewItem & {
  result: "success" | "skipped" | "failed"
  message: string
  task?: TaskSummary | null
}

function toTaskOperationType(operation: TaskBulkOperation): TaskOperationType {
  switch (operation) {
    case "restore":
      return "bulk_restore"
    case "delete_task_with_assets":
      return "bulk_delete_task_with_assets"
    case "delete_assets_only":
      return "bulk_delete_assets_only"
    case "cancel":
      return "bulk_cancel"
    case "resume":
      return "bulk_resume"
    default:
      return "bulk_archive"
  }
}

function getTaskBulkOperationId(operation: TaskBulkOperation) {
  return `bulk_${operation}_${Date.now()}`
}

function getBulkAllowedReason(operation: TaskBulkOperation) {
  switch (operation) {
    case "archive":
      return "可归档"
    case "restore":
      return "可恢复归档"
    case "delete_task_with_assets":
      return "可删除任务和素材"
    case "delete_assets_only":
      return "可清空素材"
    case "cancel":
      return "可取消"
    case "resume":
      return "可恢复"
    default:
      return "可操作"
  }
}

function getTaskBulkEligibility(task: TaskSummary | null, operation: TaskBulkOperation) {
  if (!task) {
    return { allowed: false, code: "TASK_NOT_FOUND", reason: "任务不存在" }
  }

  const archived = Boolean(task.archivedAt)
  if (operation === "restore") {
    return archived
      ? { allowed: true, code: "ALLOWED", reason: getBulkAllowedReason(operation) }
      : { allowed: false, code: "TASK_NOT_ARCHIVED", reason: "任务没有归档，不需要恢复" }
  }

  if (archived && operation !== "delete_task_with_assets" && operation !== "delete_assets_only") {
    return { allowed: false, code: "TASK_ARCHIVED", reason: "任务已归档，先恢复后再处理" }
  }

  if (operation === "cancel") {
    return task.status === "queued" || task.status === "running" || task.status === "waiting_review"
      ? { allowed: true, code: "ALLOWED", reason: getBulkAllowedReason(operation) }
      : { allowed: false, code: "TASK_CANCEL_LOCKED", reason: "只有排队中、生成中或待审阅的任务可以取消" }
  }

  if (operation === "resume") {
    return task.status === "failed"
      ? { allowed: true, code: "ALLOWED", reason: getBulkAllowedReason(operation) }
      : { allowed: false, code: "TASK_RESUME_LOCKED", reason: "只有失败任务可以批量恢复" }
  }

  if (operation === "archive") {
    return terminalTaskStatuses.has(task.status)
      ? { allowed: true, code: "ALLOWED", reason: getBulkAllowedReason(operation) }
      : { allowed: false, code: "TASK_ARCHIVE_LOCKED", reason: "任务还在生产或审核中，暂时不能归档" }
  }

  if (operation === "delete_task_with_assets" || operation === "delete_assets_only") {
    return terminalTaskStatuses.has(task.status) || task.status === "waiting_review"
      ? { allowed: true, code: "ALLOWED", reason: getBulkAllowedReason(operation) }
      : { allowed: false, code: "TASK_ASSETS_LOCKED", reason: "任务还在生产中，不能删除任务或素材；可先取消任务" }
  }

  return { allowed: false, code: "UNKNOWN_OPERATION", reason: "不支持的批量操作" }
}

async function getBulkAssetSummary(taskId: string): Promise<TaskBulkPreviewItem["assetSummary"]> {
  const assets = await readMergedTaskAssets(taskId)
  return {
    assetCount: assets.length,
    hasFinalVideo: assets.some((asset) => asset.assetType === "video_bundle"),
    hasSubtitles: assets.some((asset) => asset.assetType === "subtitles"),
    hasScript: assets.some((asset) => asset.assetType === "script" || asset.assetType === "source_script"),
  }
}

export async function previewTaskBulkOperation(input: {
  taskIds: string[]
  operation: TaskBulkOperation
}) {
  const tasks = await listTasks({ includeArchived: true })
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const uniqueTaskIds = [...new Set(input.taskIds.map((taskId) => taskId.trim()).filter(Boolean))]

  const items = await Promise.all(uniqueTaskIds.map(async (taskId) => {
    const task = byId.get(taskId) ?? null
    const eligibility = getTaskBulkEligibility(task, input.operation)
    return {
      taskId,
      title: task?.title ?? taskId,
      status: task?.status ?? "missing",
      archived: Boolean(task?.archivedAt),
      ...eligibility,
      assetSummary: task ? await getBulkAssetSummary(task.id) : {
        assetCount: 0,
        hasFinalVideo: false,
        hasSubtitles: false,
        hasScript: false,
      },
    } satisfies TaskBulkPreviewItem
  }))

  return {
    operation: input.operation,
    summary: {
      total: items.length,
      allowed: items.filter((item) => item.allowed).length,
      blocked: items.filter((item) => !item.allowed).length,
    },
    items,
  }
}

async function recordTaskBulkAudit(input: {
  operationId: string
  operation: TaskBulkOperation
  actorId: string
  taskId: string
  before: TaskSummary | null
  after: TaskSummary | null
  result: "success" | "skipped" | "failed"
  reason?: string | null
  message?: string | null
}) {
  return appendTaskOperationAuditRecord({
    operationId: input.operationId,
    operationType: toTaskOperationType(input.operation),
    actorId: input.actorId,
    resourceId: input.taskId,
    before: input.before as unknown as Record<string, unknown> | null,
    after: input.after as unknown as Record<string, unknown> | null,
    result: input.result,
    reason: input.reason ?? null,
    message: input.message ?? null,
  })
}

async function applyArchiveState(taskId: string, archive: {
  archivedAt: string | null
  archivedBy: string | null
  archiveReason: string | null
  archiveOperationId: string | null
}) {
  const tasks = await listTasks({ includeArchived: true })
  let updatedTask: TaskSummary | null = null
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) {
      return task
    }

    updatedTask = normalizeTaskSummaryRecord({
      ...task,
      ...archive,
      updatedAt: now(),
    })
    return updatedTask
  })
  await writeTaskSummaries(nextTasks)

  const detail = await readTaskDetail(taskId)
  if (detail) {
    await upsertTaskDetail(normalizeTaskDetailRecord({
      ...detail,
      ...archive,
      updatedAt: now(),
    }))
  }

  return updatedTask
}

export async function executeTaskBulkArchive(input: {
  taskIds: string[]
  actorId: string
  reason?: string | null
  restore?: boolean
  operationId?: string
}) {
  const operation: TaskBulkOperation = input.restore ? "restore" : "archive"
  const operationId = input.operationId ?? getTaskBulkOperationId(operation)
  const preview = await previewTaskBulkOperation({ taskIds: input.taskIds, operation })
  const results: TaskBulkResultItem[] = []

  for (const item of preview.items) {
    const before = (await listTasks({ includeArchived: true })).find((task) => task.id === item.taskId) ?? null
    if (!item.allowed || !before) {
      await recordTaskBulkAudit({
        operationId,
        operation,
        actorId: input.actorId,
        taskId: item.taskId,
        before,
        after: before,
        result: "skipped",
        reason: item.code,
        message: item.reason,
      })
      results.push({ ...item, result: "skipped", message: item.reason, task: before })
      continue
    }

    const nextTask = await applyArchiveState(item.taskId, input.restore
      ? { archivedAt: null, archivedBy: null, archiveReason: null, archiveOperationId: null }
      : {
          archivedAt: now(),
          archivedBy: input.actorId,
          archiveReason: input.reason ?? "运营批量归档",
          archiveOperationId: operationId,
        })
    await recordTaskBulkAudit({
      operationId,
      operation,
      actorId: input.actorId,
      taskId: item.taskId,
      before,
      after: nextTask,
      result: "success",
      reason: input.reason ?? null,
      message: input.restore ? "已恢复归档任务" : "已归档任务",
    })
    results.push({ ...item, result: "success", message: input.restore ? "已恢复归档任务" : "已归档任务", task: nextTask })
  }

  return buildTaskBulkResult(operationId, operation, results)
}

export async function executeTaskBulkDeletion(input: {
  taskIds: string[]
  actorId: string
  operation: "delete_task_with_assets" | "delete_assets_only"
  reason?: string | null
  operationId?: string
}) {
  const operationId = input.operationId ?? getTaskBulkOperationId(input.operation)
  const preview = await previewTaskBulkOperation({ taskIds: input.taskIds, operation: input.operation })
  const results: TaskBulkResultItem[] = []

  for (const item of preview.items) {
    const before = (await listTasks({ includeArchived: true })).find((task) => task.id === item.taskId) ?? null
    if (!item.allowed || !before) {
      await recordTaskBulkAudit({
        operationId,
        operation: input.operation,
        actorId: input.actorId,
        taskId: item.taskId,
        before,
        after: before,
        result: "skipped",
        reason: item.code,
        message: item.reason,
      })
      results.push({ ...item, result: "skipped", message: item.reason, task: before })
      continue
    }

    const deleteResult = input.operation === "delete_assets_only"
      ? await deleteTaskAssetCollection(item.taskId)
      : await deleteTaskWithAssets(item.taskId)

    if (!deleteResult.deleted) {
      const message = deleteResult.reason
      await recordTaskBulkAudit({
        operationId,
        operation: input.operation,
        actorId: input.actorId,
        taskId: item.taskId,
        before,
        after: before,
        result: "failed",
        reason: message,
        message,
      })
      results.push({ ...item, result: "failed", message, task: before })
      continue
    }

    await recordTaskBulkAudit({
      operationId,
      operation: input.operation,
      actorId: input.actorId,
      taskId: item.taskId,
      before,
      after: null,
      result: "success",
      reason: input.reason ?? null,
      message: input.operation === "delete_assets_only" ? "已清空任务素材" : "已删除任务和素材",
    })
    results.push({
      ...item,
      result: "success",
      message: input.operation === "delete_assets_only" ? "已清空任务素材" : "已删除任务和素材",
      task: null,
    })
  }

  return buildTaskBulkResult(operationId, input.operation, results)
}

function buildTaskBulkResult(operationId: string, operation: TaskBulkOperation, items: TaskBulkResultItem[]) {
  const success = items.filter((item) => item.result === "success").length
  const skipped = items.filter((item) => item.result === "skipped").length
  const failed = items.filter((item) => item.result === "failed").length
  return {
    operationId,
    operation,
    status: failed > 0 || skipped > 0 ? "partially_completed" as const : "completed" as const,
    summary: {
      total: items.length,
      success,
      skipped,
      failed,
    },
    items,
  }
}

export async function listTaskOperationAudit(limit = 50): Promise<TaskOperationAuditRecord[]> {
  const records = await readTaskOperationAuditRecords()
  return records.slice(0, Math.max(1, Math.min(200, limit)))
}

export async function createTask(input: CreateTaskInput): Promise<{ task: TaskSummary; taskRunConfig: unknown }> {
  const project = await getProjectById(input.projectId)
  if (!project) {
    throw new Error("PROJECT_NOT_FOUND")
  }
  const tasks = await listTasks()
  const modeId = input.modeId
  const channelId = input.channelId
  const generationMode = input.generationMode
  const estimate = estimateCost(modeId)
  const timestamp = now()
  let taskRunConfig = buildDefaultTaskRunConfig(
    modeId,
    channelId,
    input.targetDurationSec,
    generationMode,
    {
      projectId: input.projectId,
      terminalPresetId: input.terminalPresetId,
      audioStrategy: input.audioStrategy,
      subtitleStrategy: input.subtitleStrategy,
    },
  )
  const resolvedSlots = await resolveEffectiveSlots({
    modeId,
    taskOverrides: input.modelOverrides,
  })
  taskRunConfig = mapResolvedSlotsToTaskConfig(
    {
      ...taskRunConfig,
      blueprintVersion: 1,
      blueprintStatus: "pending_generation",
      modelOverrides: undefined,
    },
    resolvedSlots,
  )
  const taskId = `task_${Date.now()}`
  const detail = normalizeTaskDetailRecord({
    taskId,
    projectId: input.projectId,
    title: input.title,
    script: input.script,
    taskRunConfig,
    blueprintVersion: 1,
      blueprintStatus: "pending_generation",
      actualDurationSec: null,
      failureReason: null,
      statusDetail: "等待 worker 开始处理",
      cancelRequestedAt: null,
      scenes: buildStoryboardScenes({
      script: input.script,
      targetDurationSec: input.targetDurationSec,
      maxSceneDurationSec: resolveVideoModelCapability(taskRunConfig.videoModel.id).maxSingleShotSec,
      aspectRatio: taskRunConfig.aspectRatio,
      reviewRequirements: buildSceneReviewRequirements(taskRunConfig),
    }),
    updatedAt: timestamp,
    ...createDefaultReviewSummary(),
  })
  const task: TaskSummary = {
    id: taskId,
    projectId: input.projectId,
    title: input.title,
    modeId,
    executionMode: taskRunConfig.executionMode,
    channelId,
    terminalPresetId: taskRunConfig.terminalPresetId,
    renderSpecJson: taskRunConfig.renderSpecJson,
    targetDurationSec: input.targetDurationSec,
    generationMode,
    audioStrategy: taskRunConfig.audioStrategy,
    subtitleStrategy: taskRunConfig.subtitleStrategy,
    generationRoute: taskRunConfig.generationRoute,
    routeReason: taskRunConfig.routeReason,
    planningVersion: taskRunConfig.planningVersion,
    blueprintVersion: detail.blueprintVersion,
    blueprintStatus: detail.blueprintStatus,
    actualDurationSec: null,
    failureReason: null,
    statusDetail: "等待 worker 开始处理",
    cancelRequestedAt: null,
    status: "queued",
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
  await createInitialTaskBlueprintRecord(detail)

  return {
    task,
    taskRunConfig,
  }
}

export async function cancelTask(taskId: string, queue: {
  removedJobIds: string[]
  hadActiveJob: boolean
}) {
  const tasks = await listTasks()
  const task = tasks.find((entry) => entry.id === taskId)
  if (!task) {
    return null
  }

  const detail = await readTaskDetail(taskId)
  if (!detail) {
    return null
  }

  const canceledAt = now()
  const statusDetail = queue.hadActiveJob ? "正在终止当前任务" : "任务已终止"
  const nextSummary = normalizeTaskSummaryRecord({
    ...task,
    status: "canceled",
    failureReason: null,
    statusDetail,
    cancelRequestedAt: canceledAt,
    currentStage: "canceled",
    currentStageLabel: "任务已终止",
    currentSceneIndex: null,
    currentSceneTotal: null,
    stageStartedAt: canceledAt,
    lastHeartbeatAt: canceledAt,
    workerId: null,
    activeJobId: null,
    updatedAt: canceledAt,
  })
  const nextDetail = normalizeTaskDetailRecord({
    ...detail,
    failureReason: null,
    statusDetail,
    cancelRequestedAt: canceledAt,
    currentStage: "canceled",
    currentStageLabel: "任务已终止",
    currentSceneIndex: null,
    currentSceneTotal: null,
    stageStartedAt: canceledAt,
    lastHeartbeatAt: canceledAt,
    workerId: null,
    activeJobId: null,
    updatedAt: canceledAt,
  })

  await writeTaskSummaries(tasks.map((entry) => (entry.id === taskId ? nextSummary : entry)))
  await upsertTaskDetail(nextDetail)

  return {
    summary: nextSummary,
    detail: nextDetail,
  }
}

export async function updateTaskAudioStrategy(
  taskId: string,
  audioStrategy: TaskDetail["taskRunConfig"]["audioStrategy"],
) {
  const tasks = await listTasks()
  const task = tasks.find((entry) => entry.id === taskId)
  if (!task) {
    return { ok: false as const, code: "TASK_NOT_FOUND" }
  }

  const detail = await readTaskDetail(taskId)
  if (!detail) {
    return { ok: false as const, code: "TASK_NOT_FOUND" }
  }

  const lockedByStatus =
    task.status === "running" ||
    task.status === "completed" ||
    task.status === "canceled"
  const lockedByBlueprint =
    detail.blueprintStatus === "queued_for_video" ||
    detail.blueprintStatus === "video_generating" ||
    detail.blueprintStatus === "completed"
  const editableReviewStage =
    detail.taskRunConfig.executionMode === "review_required" &&
    (detail.blueprintStatus === "ready_for_review" ||
      detail.blueprintStatus === "approved" ||
      detail.blueprintStatus === "rejected")

  if (lockedByStatus || lockedByBlueprint || !editableReviewStage) {
    return { ok: false as const, code: "TASK_AUDIO_STRATEGY_LOCKED" }
  }

  const updatedAt = now()
  const nextSummary = normalizeTaskSummaryRecord({
    ...task,
    audioStrategy,
    updatedAt,
  })
  const nextDetail = normalizeTaskDetailRecord({
    ...detail,
    taskRunConfig: {
      ...detail.taskRunConfig,
      audioStrategy,
    },
    updatedAt,
  })

  await writeTaskSummaries(tasks.map((entry) => (entry.id === taskId ? nextSummary : entry)))
  await upsertTaskDetail(nextDetail)

  return {
    ok: true as const,
    summary: nextSummary,
    detail: nextDetail,
  }
}

export async function resumeFailedTask(taskId: string) {
  const tasks = await listTasks()
  const task = tasks.find((entry) => entry.id === taskId)
  if (!task) {
    return null
  }

  const detail = await readTaskDetail(taskId)
  if (!detail) {
    return null
  }

  const resumedAt = now()
  const nextSummary = normalizeTaskSummaryRecord({
    ...task,
    status: "queued",
    failureReason: null,
    statusDetail: "等待 worker 恢复处理",
    cancelRequestedAt: null,
    currentStage: "resume_pending",
    currentStageLabel: "等待 worker 恢复处理",
    currentSceneIndex: null,
    currentSceneTotal: null,
    stageStartedAt: resumedAt,
    lastHeartbeatAt: resumedAt,
    workerId: null,
    activeJobId: null,
    updatedAt: resumedAt,
  })
  const nextDetail = normalizeTaskDetailRecord({
    ...detail,
    failureReason: null,
    statusDetail: "等待 worker 恢复处理",
    cancelRequestedAt: null,
    currentStage: "resume_pending",
    currentStageLabel: "等待 worker 恢复处理",
    currentSceneIndex: null,
    currentSceneTotal: null,
    stageStartedAt: resumedAt,
    lastHeartbeatAt: resumedAt,
    workerId: null,
    activeJobId: null,
    updatedAt: resumedAt,
  })

  await writeTaskSummaries(tasks.map((entry) => (entry.id === taskId ? nextSummary : entry)))
  await upsertTaskDetail(nextDetail)

  return {
    summary: nextSummary,
    detail: nextDetail,
  }
}

export async function markTaskRetryPending(taskId: string) {
  const tasks = await listTasks()
  const task = tasks.find((entry) => entry.id === taskId)
  if (!task) {
    return null
  }

  const detail = await readTaskDetail(taskId)
  if (!detail) {
    return null
  }

  const retryAt = now()
  const nextSummary = normalizeTaskSummaryRecord({
    ...task,
    status: "queued",
    failureReason: null,
    statusDetail: "等待 worker 局部重试",
    cancelRequestedAt: null,
    retryCount: task.retryCount + 1,
    currentStage: "retry_pending",
    currentStageLabel: "等待 worker 局部重试",
    currentSceneIndex: null,
    currentSceneTotal: null,
    stageStartedAt: retryAt,
    lastHeartbeatAt: retryAt,
    workerId: null,
    activeJobId: null,
    updatedAt: retryAt,
  })
  const nextDetail = normalizeTaskDetailRecord({
    ...detail,
    failureReason: null,
    statusDetail: "等待 worker 局部重试",
    cancelRequestedAt: null,
    currentStage: "retry_pending",
    currentStageLabel: "等待 worker 局部重试",
    currentSceneIndex: null,
    currentSceneTotal: null,
    stageStartedAt: retryAt,
    lastHeartbeatAt: retryAt,
    workerId: null,
    activeJobId: null,
    updatedAt: retryAt,
  })

  await writeTaskSummaries(tasks.map((entry) => (entry.id === taskId ? nextSummary : entry)))
  await upsertTaskDetail(nextDetail)

  return {
    summary: nextSummary,
    detail: nextDetail,
  }
}

export async function restoreTaskState(taskSnapshot: TaskSummary, detailSnapshot: TaskDetail) {
  const tasks = await listTasks()
  await writeTaskSummaries(tasks.map((entry) =>
    entry.id === taskSnapshot.id ? normalizeTaskSummaryRecord(taskSnapshot) : entry,
  ))
  await upsertTaskDetail(normalizeTaskDetailRecord(detailSnapshot))
}

export async function deleteTask(taskId: string) {
  const tasks = await listTasks()
  const nextTasks = tasks.filter((task) => task.id !== taskId)
  if (nextTasks.length !== tasks.length) {
    await writeTaskSummaries(nextTasks)
  }

  await deleteTaskDetail(taskId)
  await deletePersistedTaskAssets(taskId)
  await deleteTaskTimeline(taskId)
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
