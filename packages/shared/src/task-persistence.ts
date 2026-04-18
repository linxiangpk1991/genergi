import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  AssetRecord,
  ReviewStageId,
  ReviewSummary,
  StoryboardScene,
  StoredUser,
  TaskDetail,
  TaskSummary,
} from "./index.js"

function resolveDataDir() {
  return process.env.GENERGI_DATA_DIR
    ? path.resolve(process.env.GENERGI_DATA_DIR)
    : path.resolve(process.cwd(), ".data")
}

function resolveFiles() {
  const dataDir = resolveDataDir()
  return {
    dataDir,
    tasksFile: path.join(dataDir, "tasks.json"),
    tempTasksFile: path.join(dataDir, "tasks.tmp.json"),
    detailsFile: path.join(dataDir, "task-details.json"),
    tempDetailsFile: path.join(dataDir, "task-details.tmp.json"),
    runtimeFile: path.join(dataDir, "runtime-status.json"),
    tempRuntimeFile: path.join(dataDir, "runtime-status.tmp.json"),
    assetsFile: path.join(dataDir, "assets.json"),
    tempAssetsFile: path.join(dataDir, "assets.tmp.json"),
    usersFile: path.join(dataDir, "users.json"),
    tempUsersFile: path.join(dataDir, "users.tmp.json"),
  }
}

function now() {
  return new Date().toISOString()
}

const reviewStageValues = new Set<ReviewStageId>([
  "storyboard_review",
  "keyframe_review",
  "auto_qa",
])

const sceneReviewStatusValues = new Set<StoryboardScene["reviewStatus"]>([
  "pending",
  "approved",
  "rejected",
])

export function createDefaultReviewSummary(): ReviewSummary {
  return {
    reviewStage: null,
    pendingReviewCount: 0,
    reviewUpdatedAt: null,
  }
}

function normalizeNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function normalizeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0
}

function normalizeReviewStage(value: unknown): ReviewStageId | null {
  return typeof value === "string" && reviewStageValues.has(value as ReviewStageId)
    ? (value as ReviewStageId)
    : null
}

function normalizeSceneReviewStatus(
  value: unknown,
  fallback: StoryboardScene["reviewStatus"],
): StoryboardScene["reviewStatus"] {
  return typeof value === "string" && sceneReviewStatusValues.has(value as StoryboardScene["reviewStatus"])
    ? (value as StoryboardScene["reviewStatus"])
    : fallback
}

function normalizeReviewSummaryRecord<T extends Partial<ReviewSummary>>(record: T): ReviewSummary {
  return {
    reviewStage: normalizeReviewStage(record.reviewStage),
    pendingReviewCount: normalizeNonNegativeInteger(record.pendingReviewCount),
    reviewUpdatedAt: normalizeNullableString(record.reviewUpdatedAt),
  }
}

export function normalizeStoryboardScene(
  scene: StoryboardScene & Partial<Record<"reviewNote" | "reviewedAt" | "keyframeReviewNote" | "keyframeReviewedAt", string | null>>,
): StoryboardScene {
  return {
    ...scene,
    reviewStatus: normalizeSceneReviewStatus(scene.reviewStatus, "pending"),
    keyframeStatus: normalizeSceneReviewStatus(scene.keyframeStatus, "pending"),
    reviewNote: normalizeNullableString(scene.reviewNote),
    reviewedAt: normalizeNullableString(scene.reviewedAt),
    keyframeReviewNote: normalizeNullableString(scene.keyframeReviewNote),
    keyframeReviewedAt: normalizeNullableString(scene.keyframeReviewedAt),
  }
}

export function normalizeTaskSummaryRecord(
  task: TaskSummary & {
    targetDurationSec?: number
    generationMode?: TaskSummary["generationMode"]
    generationRoute?: TaskSummary["generationRoute"]
    routeReason?: string
    planningVersion?: TaskSummary["planningVersion"]
    actualDurationSec?: number | null
    reviewStage?: ReviewStageId | null
    pendingReviewCount?: number
    reviewUpdatedAt?: string | null
  },
): TaskSummary {
  return {
    ...task,
    targetDurationSec: task.targetDurationSec ?? 30,
    generationMode: task.generationMode ?? "user_locked",
    generationRoute: task.generationRoute ?? "multi_scene",
    routeReason: task.routeReason ?? "legacy task normalized to multi-scene",
    planningVersion: task.planningVersion ?? "v1",
    actualDurationSec: task.actualDurationSec ?? null,
    ...normalizeReviewSummaryRecord(task),
  }
}

export function normalizeTaskDetailRecord(
  detail: TaskDetail & {
    actualDurationSec?: number | null
    reviewStage?: ReviewStageId | null
    pendingReviewCount?: number
    reviewUpdatedAt?: string | null
  },
): TaskDetail {
  return {
    ...detail,
    actualDurationSec: detail.actualDurationSec ?? null,
    scenes: Array.isArray(detail.scenes)
      ? detail.scenes.map((scene) => normalizeStoryboardScene(scene))
      : [],
    updatedAt: typeof detail.updatedAt === "string" && detail.updatedAt.trim().length > 0
      ? detail.updatedAt
      : now(),
    ...normalizeReviewSummaryRecord(detail),
  }
}

export function seedTaskSummaries(): TaskSummary[] {
  return [
    {
      id: "task_seed_001",
      title: "Summer Product Hook Series",
      modeId: "mass_production",
      channelId: "tiktok",
      targetDurationSec: 30,
      generationMode: "user_locked",
      generationRoute: "multi_scene",
      routeReason: "legacy seed task normalized to multi-scene",
      planningVersion: "v1",
      actualDurationSec: null,
      status: "running",
      progressPct: 40,
      retryCount: 0,
      estimatedCostCny: 2.4,
      createdAt: now(),
      updatedAt: now(),
      ...createDefaultReviewSummary(),
    },
    {
      id: "task_seed_002",
      title: "Feature Review Promo V3",
      modeId: "high_quality",
      channelId: "reels",
      targetDurationSec: 45,
      generationMode: "user_locked",
      generationRoute: "multi_scene",
      routeReason: "legacy seed task normalized to multi-scene",
      planningVersion: "v1",
      actualDurationSec: null,
      status: "failed",
      progressPct: 62,
      retryCount: 2,
      estimatedCostCny: 4.5,
      createdAt: now(),
      updatedAt: now(),
      ...createDefaultReviewSummary(),
    },
  ]
}

export async function writeTaskSummaries(tasks: TaskSummary[]) {
  const { dataDir, tasksFile, tempTasksFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  await writeFile(tempTasksFile, JSON.stringify(tasks, null, 2), "utf8")
  await rename(tempTasksFile, tasksFile)
}

export async function ensureTaskDataFile() {
  const { dataDir, tasksFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  try {
    const content = await readFile(tasksFile, "utf8")
    if (!content.trim()) {
      await writeTaskSummaries(seedTaskSummaries())
    }
  } catch {
    await writeTaskSummaries(seedTaskSummaries())
  }
}

export async function readTaskSummaries(): Promise<TaskSummary[]> {
  const { tasksFile } = resolveFiles()
  await ensureTaskDataFile()
  const content = await readFile(tasksFile, "utf8")
  if (!content.trim()) {
    const tasks = seedTaskSummaries()
    await writeTaskSummaries(tasks)
    return tasks
  }

  try {
    const tasks = JSON.parse(content) as Array<
      TaskSummary & {
        targetDurationSec?: number
        generationMode?: TaskSummary["generationMode"]
        generationRoute?: TaskSummary["generationRoute"]
        routeReason?: string
        planningVersion?: TaskSummary["planningVersion"]
        actualDurationSec?: number | null
        reviewStage?: ReviewStageId | null
        pendingReviewCount?: number
        reviewUpdatedAt?: string | null
      }
    >
    const normalized = tasks.map((task) => normalizeTaskSummaryRecord(task))
    if (JSON.stringify(tasks) !== JSON.stringify(normalized)) {
      await writeTaskSummaries(normalized)
    }
    return normalized
  } catch {
    const tasks = seedTaskSummaries()
    await writeTaskSummaries(tasks)
    return tasks
  }
}

export async function updateTaskSummary(
  taskId: string,
  updater: (task: TaskSummary) => TaskSummary,
) {
  const tasks = await readTaskSummaries()
  const nextTasks = tasks.map((task) => (task.id === taskId ? updater(task) : task))
  await writeTaskSummaries(nextTasks)
  return nextTasks.find((task) => task.id === taskId) ?? null
}

async function writeTaskDetails(details: Record<string, TaskDetail>) {
  const { dataDir, detailsFile, tempDetailsFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  await writeFile(tempDetailsFile, JSON.stringify(details, null, 2), "utf8")
  await rename(tempDetailsFile, detailsFile)
}

export async function readTaskDetails(): Promise<Record<string, TaskDetail>> {
  const { detailsFile } = resolveFiles()
  await ensureTaskDataFile()
  try {
    const content = await readFile(detailsFile, "utf8")
    if (!content.trim()) {
      return {}
    }

    const parsed = JSON.parse(content) as Record<string, TaskDetail>
    const normalized = Object.fromEntries(
      Object.entries(parsed).map(([taskId, detail]) => [taskId, normalizeTaskDetailRecord(detail)]),
    ) as Record<string, TaskDetail>
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await writeTaskDetails(normalized)
    }

    return normalized
  } catch {
    return {}
  }
}

export async function upsertTaskDetail(detail: TaskDetail) {
  const details = await readTaskDetails()
  details[detail.taskId] = detail
  await writeTaskDetails(details)
}

export async function deleteTaskDetail(taskId: string) {
  const details = await readTaskDetails()
  if (!(taskId in details)) {
    return
  }

  delete details[taskId]
  await writeTaskDetails(details)
}

export async function readTaskDetail(taskId: string) {
  const details = await readTaskDetails()
  return details[taskId] ?? null
}

export type RuntimeServiceState = {
  name: string
  status: "healthy" | "degraded"
  updatedAt: string
  message: string
}

export type RuntimeStatus = {
  api: RuntimeServiceState
  worker: RuntimeServiceState
  redis: RuntimeServiceState
}

const defaultRuntimeStatus: RuntimeStatus = {
  api: {
    name: "api",
    status: "healthy",
    updatedAt: now(),
    message: "API online",
  },
  worker: {
    name: "worker",
    status: "degraded",
    updatedAt: now(),
    message: "Worker heartbeat unavailable",
  },
  redis: {
    name: "redis",
    status: "healthy",
    updatedAt: now(),
    message: "Redis configured",
  },
}

async function writeRuntimeStatus(status: RuntimeStatus) {
  const { dataDir, runtimeFile, tempRuntimeFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  await writeFile(tempRuntimeFile, JSON.stringify(status, null, 2), "utf8")
  await rename(tempRuntimeFile, runtimeFile)
}

export async function readRuntimeStatus(): Promise<RuntimeStatus> {
  const { runtimeFile } = resolveFiles()
  await ensureTaskDataFile()
  try {
    const content = await readFile(runtimeFile, "utf8")
    if (!content.trim()) {
      await writeRuntimeStatus(defaultRuntimeStatus)
      return defaultRuntimeStatus
    }

    return JSON.parse(content) as RuntimeStatus
  } catch {
    await writeRuntimeStatus(defaultRuntimeStatus)
    return defaultRuntimeStatus
  }
}

export async function updateRuntimeStatus(
  updater: (status: RuntimeStatus) => RuntimeStatus,
) {
  const current = await readRuntimeStatus()
  const next = updater(current)
  await writeRuntimeStatus(next)
  return next
}

async function writeAssetRecords(records: Record<string, AssetRecord[]>) {
  const { dataDir, assetsFile, tempAssetsFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  await writeFile(tempAssetsFile, JSON.stringify(records, null, 2), "utf8")
  await rename(tempAssetsFile, assetsFile)
}

export async function readAssetRecords(): Promise<Record<string, AssetRecord[]>> {
  const { assetsFile } = resolveFiles()
  await ensureTaskDataFile()
  try {
    const content = await readFile(assetsFile, "utf8")
    if (!content.trim()) {
      return {}
    }
    return JSON.parse(content) as Record<string, AssetRecord[]>
  } catch {
    return {}
  }
}

export async function upsertTaskAssets(taskId: string, assets: AssetRecord[]) {
  const records = await readAssetRecords()
  records[taskId] = assets
  await writeAssetRecords(records)
}

export async function deleteTaskAssets(taskId: string) {
  const records = await readAssetRecords()
  if (!(taskId in records)) {
    return
  }

  delete records[taskId]
  await writeAssetRecords(records)
}

export async function readTaskAssets(taskId: string) {
  const records = await readAssetRecords()
  return records[taskId] ?? []
}

async function writeUserRecords(records: StoredUser[]) {
  const { dataDir, usersFile, tempUsersFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  await writeFile(tempUsersFile, JSON.stringify(records, null, 2), "utf8")
  await rename(tempUsersFile, usersFile)
}

export async function ensureUserDataFile() {
  const { dataDir, usersFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  try {
    const content = await readFile(usersFile, "utf8")
    if (!content.trim()) {
      await writeUserRecords([])
    }
  } catch {
    await writeUserRecords([])
  }
}

export async function readUserRecords(): Promise<StoredUser[]> {
  const { usersFile } = resolveFiles()
  await ensureUserDataFile()
  try {
    const content = await readFile(usersFile, "utf8")
    if (!content.trim()) {
      await writeUserRecords([])
      return []
    }

    return JSON.parse(content) as StoredUser[]
  } catch {
    await writeUserRecords([])
    return []
  }
}

export async function replaceUserRecords(records: StoredUser[]) {
  await writeUserRecords(records)
}
