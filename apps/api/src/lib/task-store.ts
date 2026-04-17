import fs from "node:fs/promises"
import path from "node:path"
import { buildDefaultTaskRunConfig, estimateCost } from "@genergi/config"
import { readTaskAssets, readTaskDetail, readTaskSummaries, upsertTaskDetail, writeTaskSummaries } from "@genergi/shared"
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

function buildScenes(script: string): StoryboardScene[] {
  return Array.from({ length: 4 }, (_, index) => {
    const sceneNo = index + 1
    return {
      id: `scene_${sceneNo}`,
      index,
      title: `Scene ${sceneNo}`,
      script:
        sceneNo === 1
          ? `${script} Start with an immediate hook and a highly visible problem.`
          : sceneNo === 2
            ? "Show the product in action and establish why it feels like the obvious upgrade."
            : sceneNo === 3
              ? "Layer in proof, visual trust signals, or a concrete before/after moment."
              : "Close with a direct CTA designed for short-form English social video.",
      imagePrompt: `Vertical hero frame for scene ${sceneNo}, premium product focus, social-first composition, English-speaking market aesthetic.`,
      videoPrompt: `Generate a 9:16 video for scene ${sceneNo} with strong pacing, platform-native movement, and clear product readability.`,
      durationSec: 4,
      startLabel: `00:${String(index * 4).padStart(2, "0")}`,
      endLabel: `00:${String((index + 1) * 4).padStart(2, "0")}`,
      reviewStatus: index === 0 ? "approved" : "pending",
      keyframeStatus: "pending",
    }
  })
}

export async function listTasks(): Promise<TaskSummary[]> {
  return readTaskSummaries()
}

export async function getTaskDetail(taskId: string) {
  const existing = await readTaskDetail(taskId)
  if (existing) {
    return existing
  }

  const tasks = await listTasks()
  const task = tasks.find((item) => item.id === taskId)
  if (!task) {
    return null
  }

  const taskRunConfig = buildDefaultTaskRunConfig(task.modeId, task.channelId)
  const synthesized: TaskDetail = {
    taskId: task.id,
    title: task.title,
    script: `${task.title}. Keep the tone native-English, product-forward, and optimized for short-form social video.`,
    taskRunConfig,
    scenes: buildScenes(task.title),
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
  const taskRunConfig = buildDefaultTaskRunConfig(input.modeId, input.channelId)
  const task: TaskSummary = {
    id: `task_${Date.now()}`,
    title: input.title,
    modeId: input.modeId,
    channelId: input.channelId,
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
    scenes: buildScenes(input.script),
    updatedAt: timestamp,
  }
  await upsertTaskDetail(detail)

  return {
    task,
    taskRunConfig,
  }
}
