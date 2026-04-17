import fs from "node:fs/promises"
import path from "node:path"
import { buildDefaultTaskRunConfig, estimateCost } from "@genergi/config"
import { buildStoryboardScenes, readTaskAssets, readTaskDetail, readTaskSummaries, upsertTaskDetail, writeTaskSummaries } from "@genergi/shared"
import type { CreateTaskInput, StoryboardScene, TaskDetail, TaskSummary, TaskStatus } from "@genergi/shared"

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
    const totalSceneDuration = existing.scenes.reduce((total, scene) => total + scene.durationSec, 0)
    const hasExpectedDuration = existing.taskRunConfig.targetDurationSec === task.targetDurationSec
    const hasExpectedRoute = existing.taskRunConfig.generationRoute === task.generationRoute
    if (hasExpectedDuration && hasExpectedRoute && totalSceneDuration === task.targetDurationSec) {
      return existing
    }

    const normalized: TaskDetail = {
      ...existing,
      taskRunConfig,
      actualDurationSec: existing.actualDurationSec ?? task.actualDurationSec,
      scenes: buildStoryboardScenes({
        script: existing.script,
        targetDurationSec: task.targetDurationSec,
        aspectRatio: taskRunConfig.aspectRatio,
      }),
      updatedAt: now(),
    }
    await upsertTaskDetail(normalized)
    return normalized
  }

  const script = `${task.title}. Keep the tone native-English, product-forward, and optimized for short-form social video.`
  const synthesized: TaskDetail = {
    taskId: task.id,
    title: task.title,
    script,
    taskRunConfig,
    actualDurationSec: task.actualDurationSec,
    scenes: buildStoryboardScenes({
      script,
      targetDurationSec: task.targetDurationSec,
      aspectRatio: taskRunConfig.aspectRatio,
    }),
    updatedAt: task.updatedAt,
  }

  await upsertTaskDetail(synthesized)
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
  const taskRunConfig = buildDefaultTaskRunConfig(
    input.modeId,
    input.channelId,
    input.targetDurationSec,
    input.generationMode,
  )
  const task: TaskSummary = {
    id: `task_${Date.now()}`,
    title: input.title,
    modeId: input.modeId,
    channelId: input.channelId,
    targetDurationSec: input.targetDurationSec,
    generationMode: input.generationMode,
    generationRoute: taskRunConfig.generationRoute,
    routeReason: taskRunConfig.routeReason,
    planningVersion: taskRunConfig.planningVersion,
    actualDurationSec: null,
    status: "queued" satisfies TaskStatus,
    progressPct: 0,
    retryCount: 0,
    estimatedCostCny: estimate.budgetUsagePct / 100 * taskRunConfig.budgetLimitCny,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  tasks.unshift(task)
  await writeTaskSummaries(tasks)
  const detail: TaskDetail = {
    taskId: task.id,
    title: task.title,
    script: input.script,
    taskRunConfig,
    actualDurationSec: null,
    scenes: buildStoryboardScenes({
      script: input.script,
      targetDurationSec: input.targetDurationSec,
      aspectRatio: taskRunConfig.aspectRatio,
    }),
    updatedAt: timestamp,
  }
  await upsertTaskDetail(detail)

  return {
    task,
    taskRunConfig,
  }
}
