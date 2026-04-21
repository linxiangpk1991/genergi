import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  AssetRecord,
  BlueprintStatus,
  ExecutionMode,
  GlobalModelDefaults,
  ModelControlStatus,
  ModelControlDefaults,
  ModelDefaultsDocument,
  ModelRecord,
  ProviderRegistryRecord,
  ReviewStageId,
  ReviewSummary,
  ProviderRecord,
  StoryboardScene,
  StoredUser,
  TaskDetail,
  TaskSummary,
  TerminalPresetId,
} from "./index.js"
import {
  normalizeImageProviderModelId,
  normalizeVideoProviderModelId,
} from "./provider-model-ids.js"
import { renderSpecSchema } from "./video-blueprint.js"

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
    providersFile: path.join(dataDir, "providers.json"),
    tempProvidersFile: path.join(dataDir, "providers.tmp.json"),
    modelsFile: path.join(dataDir, "models.json"),
    tempModelsFile: path.join(dataDir, "models.tmp.json"),
    modelDefaultsFile: path.join(dataDir, "model-defaults.json"),
    tempModelDefaultsFile: path.join(dataDir, "model-defaults.tmp.json"),
  }
}

async function commitTempFile(tempPath: string, finalPath: string, content: string) {
  await writeFile(tempPath, content, "utf8")
  try {
    await rename(tempPath, finalPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("ENOENT")) {
      throw error
    }
    await writeFile(finalPath, content, "utf8")
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

function normalizeExecutionMode(value: unknown): ExecutionMode {
  return value === "review_required" ? "review_required" : "automated"
}

function normalizeTerminalPresetId(value: unknown): TerminalPresetId {
  switch (value) {
    case "phone_landscape":
    case "tablet_portrait":
    case "tablet_landscape":
      return value
    default:
      return "phone_portrait"
  }
}

function createDefaultRenderSpec(terminalPresetId: TerminalPresetId) {
  switch (terminalPresetId) {
    case "phone_landscape":
      return {
        terminalPresetId,
        width: 1920,
        height: 1080,
        aspectRatio: "16:9",
        safeArea: { topPct: 8, rightPct: 6, bottomPct: 8, leftPct: 6 },
        compositionGuideline: "主体不宜过小，适合横向叙事与左右信息分布。",
        motionGuideline: "可用横向推进和平移，但保持主体和产品停留在主要观看区域。",
      }
    case "tablet_portrait":
      return {
        terminalPresetId,
        width: 1536,
        height: 2048,
        aspectRatio: "3:4",
        safeArea: { topPct: 7, rightPct: 6, bottomPct: 9, leftPct: 6 },
        compositionGuideline: "保留更多环境空间，竖向构图下仍需保证主体清晰集中。",
        motionGuideline: "可使用更缓的推进与轻微层次变化，避免主体漂到边缘。",
      }
    case "tablet_landscape":
      return {
        terminalPresetId,
        width: 2048,
        height: 1536,
        aspectRatio: "4:3",
        safeArea: { topPct: 7, rightPct: 6, bottomPct: 7, leftPct: 6 },
        compositionGuideline: "适合横向场景展开、双主体或产品与环境并置展示。",
        motionGuideline: "允许横向环境展开和更慢节奏镜头，但主体和产品要维持可读性。",
      }
    default:
      return {
        terminalPresetId: "phone_portrait" as const,
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
        compositionGuideline: "主体保持在竖屏中心安全区，优先纵向层次和中上部视觉焦点。",
        motionGuideline: "优先轻推拉、竖向层次变化与居中主体运动，避免大幅横向扫动。",
      }
  }
}

function normalizeRenderSpec(value: unknown, terminalPresetId: TerminalPresetId) {
  const fallback = createDefaultRenderSpec(terminalPresetId)
  const parsed = renderSpecSchema.safeParse(value)
  if (!parsed.success) {
    return fallback
  }

  return {
    ...parsed.data,
    terminalPresetId: normalizeTerminalPresetId(parsed.data.terminalPresetId),
  }
}

function normalizeBlueprintStatus(value: unknown): BlueprintStatus {
  switch (value) {
    case "ready_for_review":
    case "rejected":
    case "approved":
    case "queued_for_video":
    case "video_generating":
    case "completed":
      return value
    default:
      return "pending_generation"
  }
}

function normalizeControlStatus(value: unknown): ModelControlStatus {
  return value === "validating" ||
    value === "available" ||
    value === "invalid" ||
    value === "disabled" ||
    value === "deprecated"
    ? value
    : "draft"
}

function normalizeCapabilityJson(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeProviderRecord(record: ProviderRecord): ProviderRecord {
  return {
    ...record,
    endpointUrl: normalizeNullableString(record.endpointUrl),
    encryptedEndpoint: normalizeNullableString(record.encryptedEndpoint),
    encryptedSecret: normalizeNullableString(record.encryptedSecret),
    endpointHint: normalizeNullableString(record.endpointHint),
    secretHint: normalizeNullableString(record.secretHint),
    status: normalizeControlStatus(record.status),
    lastValidatedAt: normalizeNullableString(record.lastValidatedAt),
    lastValidationError: normalizeNullableString(record.lastValidationError),
  }
}

function normalizeModelSlotType(value: unknown): ModelRecord["slotType"] | null {
  switch (value) {
    case "textModel":
    case "imageModel":
    case "videoModel":
    case "ttsProvider":
      return value
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

function normalizeModelRecord(record: ModelRecord): ModelRecord | null {
  const slotType = normalizeModelSlotType((record as { slotType?: unknown }).slotType)
  if (!slotType) {
    return null
  }

  const providerModelId =
    slotType === "imageModel"
      ? normalizeImageProviderModelId(record.providerModelId)
      : slotType === "videoModel"
        ? normalizeVideoProviderModelId(record.providerModelId)
        : record.providerModelId
  const capabilityJson = normalizeCapabilityJson(record.capabilityJson)

  return {
    ...record,
    slotType,
    providerModelId,
    capabilityJson:
      slotType === "videoModel" && typeof capabilityJson.modelId === "string"
        ? {
            ...capabilityJson,
            modelId: normalizeVideoProviderModelId(capabilityJson.modelId),
          }
        : capabilityJson,
    lifecycleStatus: normalizeControlStatus(record.lifecycleStatus),
    lastValidatedAt: normalizeNullableString(record.lastValidatedAt),
    lastValidationError: normalizeNullableString(record.lastValidationError),
  }
}

function normalizeTaskRuntimeModelId(slotType: "imageModel" | "videoModel", modelId: string) {
  return slotType === "imageModel"
    ? normalizeImageProviderModelId(modelId)
    : normalizeVideoProviderModelId(modelId)
}

const unifiedDefaultSlotKeys = [
  "textModel",
  "imageModel",
  "videoModel",
  "ttsProvider",
] as const satisfies ReadonlyArray<keyof GlobalModelDefaults>

function normalizeSlotSelection(
  selection: unknown,
  slot: typeof unifiedDefaultSlotKeys[number],
) {
  if (typeof selection === "string" && selection.trim()) {
    const valueId = selection.trim()
    return slot === "ttsProvider"
      ? { modelId: valueId, providerId: valueId }
      : { modelId: valueId }
  }

  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return null
  }

  const rawModelId = typeof (selection as { modelId?: unknown }).modelId === "string"
    ? (selection as { modelId: string }).modelId.trim()
    : ""
  const rawProviderId = typeof (selection as { providerId?: unknown }).providerId === "string"
    ? (selection as { providerId: string }).providerId.trim()
    : ""
  const modelId = rawModelId || (slot === "ttsProvider" ? rawProviderId : "")

  if (!modelId) {
    return null
  }

  return {
    modelId,
    providerId: rawProviderId || (slot === "ttsProvider" ? modelId : undefined),
  }
}

function normalizeGlobalModelDefaults(value: unknown): GlobalModelDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  const record = value as Record<string, unknown>
  const normalized: GlobalModelDefaults = {}

  const textModel = normalizeSlotSelection(record.textModel, "textModel")
  if (textModel) {
    normalized.textModel = textModel
  }

  const imageModel =
    normalizeSlotSelection(record.imageModel, "imageModel") ??
    normalizeSlotSelection(record.imageFinalModel, "imageModel") ??
    normalizeSlotSelection(record.imageDraftModel, "imageModel")
  if (imageModel) {
    normalized.imageModel = imageModel
  }

  const videoModel =
    normalizeSlotSelection(record.videoModel, "videoModel") ??
    normalizeSlotSelection(record.videoFinalModel, "videoModel") ??
    normalizeSlotSelection(record.videoDraftModel, "videoModel")
  if (videoModel) {
    normalized.videoModel = videoModel
  }

  const ttsProvider = normalizeSlotSelection(record.ttsProvider, "ttsProvider")
  if (ttsProvider) {
    normalized.ttsProvider = ttsProvider
  }

  return normalized
}

function normalizeModelDefaultsDocument(value: unknown): ModelDefaultsDocument {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<ModelDefaultsDocument> & {
        global?: unknown
        modes?: Record<string, unknown>
        modeDefaults?: unknown
      })
    : {}

  const modeDefaults = Array.isArray(record.modeDefaults)
    ? record.modeDefaults
        .filter((entry): entry is NonNullable<ModelDefaultsDocument["modeDefaults"]>[number] =>
          Boolean(entry) && typeof entry === "object" && typeof entry.modeId === "string",
        )
        .map((entry) => ({
          modeId: entry.modeId,
          slots: normalizeGlobalModelDefaults(entry.slots),
        }))
    : []

  if (!modeDefaults.length && record.modes && typeof record.modes === "object") {
    for (const modeId of ["mass_production", "high_quality"] as const) {
      if (modeId in record.modes) {
        modeDefaults.push({
          modeId,
          slots: normalizeGlobalModelDefaults(record.modes[modeId]),
        })
      }
    }
  } else if (record.modeDefaults && typeof record.modeDefaults === "object") {
    const modeDefaultsRecord = record.modeDefaults as unknown as Record<string, unknown>
    for (const modeId of ["mass_production", "high_quality"] as const) {
      const source = modeDefaultsRecord[modeId]
      if (source && typeof source === "object" && !Array.isArray(source)) {
        modeDefaults.push({
          modeId,
          slots: normalizeGlobalModelDefaults(source),
        })
      }
    }
  }

  return {
    globalDefaults: normalizeGlobalModelDefaults(record.globalDefaults ?? record.global),
    modeDefaults,
    updatedAt: normalizeNullableString(record.updatedAt),
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
    projectId?: string
    executionMode?: ExecutionMode
    terminalPresetId?: TerminalPresetId
    renderSpecJson?: unknown
    targetDurationSec?: number
    generationMode?: TaskSummary["generationMode"]
    generationRoute?: TaskSummary["generationRoute"]
    routeReason?: string
    planningVersion?: TaskSummary["planningVersion"]
    blueprintVersion?: number
    blueprintStatus?: BlueprintStatus
    actualDurationSec?: number | null
    failureReason?: string | null
    statusDetail?: string | null
    cancelRequestedAt?: string | null
    reviewStage?: ReviewStageId | null
    pendingReviewCount?: number
    reviewUpdatedAt?: string | null
  },
): TaskSummary {
  return {
    ...task,
    projectId: typeof task.projectId === "string" && task.projectId.trim() ? task.projectId : "project_unassigned",
    executionMode: normalizeExecutionMode(task.executionMode),
    terminalPresetId: normalizeTerminalPresetId(task.terminalPresetId),
    renderSpecJson: normalizeRenderSpec(task.renderSpecJson, normalizeTerminalPresetId(task.terminalPresetId)),
    targetDurationSec: task.targetDurationSec ?? 30,
    generationMode: task.generationMode ?? "user_locked",
    generationRoute: task.generationRoute ?? "multi_scene",
    routeReason: task.routeReason ?? "legacy task normalized to multi-scene",
    planningVersion: task.planningVersion ?? "v1",
    blueprintVersion: typeof task.blueprintVersion === "number" && task.blueprintVersion >= 0 ? task.blueprintVersion : 0,
    blueprintStatus: normalizeBlueprintStatus(task.blueprintStatus),
    actualDurationSec: task.actualDurationSec ?? null,
    failureReason: normalizeNullableString(task.failureReason),
    statusDetail: normalizeNullableString(task.statusDetail),
    cancelRequestedAt: normalizeNullableString(task.cancelRequestedAt),
    ...normalizeReviewSummaryRecord(task),
  }
}

export function normalizeTaskDetailRecord(
  detail: TaskDetail & {
    projectId?: string
    actualDurationSec?: number | null
    blueprintVersion?: number
    blueprintStatus?: BlueprintStatus
    failureReason?: string | null
    statusDetail?: string | null
    cancelRequestedAt?: string | null
    reviewStage?: ReviewStageId | null
    pendingReviewCount?: number
    reviewUpdatedAt?: string | null
  },
): TaskDetail {
  const taskRunConfig = detail.taskRunConfig
  const normalizedTerminalPresetId = normalizeTerminalPresetId(taskRunConfig.terminalPresetId)
  return {
    ...detail,
    projectId: typeof detail.projectId === "string" && detail.projectId.trim() ? detail.projectId : taskRunConfig.projectId ?? "project_unassigned",
    taskRunConfig: {
      ...taskRunConfig,
      projectId:
        typeof taskRunConfig.projectId === "string" && taskRunConfig.projectId.trim()
          ? taskRunConfig.projectId
          : "project_unassigned",
      executionMode: normalizeExecutionMode(taskRunConfig.executionMode),
      terminalPresetId: normalizedTerminalPresetId,
      renderSpecJson: normalizeRenderSpec(taskRunConfig.renderSpecJson, normalizedTerminalPresetId),
      imageModel: {
        ...taskRunConfig.imageModel,
        id: normalizeTaskRuntimeModelId("imageModel", taskRunConfig.imageModel.id),
      },
      videoModel: {
        ...taskRunConfig.videoModel,
        id: normalizeTaskRuntimeModelId("videoModel", taskRunConfig.videoModel.id),
      },
      slotSnapshots: Array.isArray(taskRunConfig.slotSnapshots)
        ? taskRunConfig.slotSnapshots.map((slot) => ({
            ...slot,
            providerModelId:
              slot.slotType === "imageModel"
                ? normalizeImageProviderModelId(slot.providerModelId)
                : slot.slotType === "videoModel"
                  ? normalizeVideoProviderModelId(slot.providerModelId)
                  : slot.providerModelId,
            capabilityJson:
              slot.slotType === "videoModel" && typeof slot.capabilityJson?.modelId === "string"
                ? {
                    ...slot.capabilityJson,
                    modelId: normalizeVideoProviderModelId(slot.capabilityJson.modelId),
                  }
                : slot.capabilityJson,
          }))
        : [],
      blueprintVersion:
        typeof taskRunConfig.blueprintVersion === "number" && taskRunConfig.blueprintVersion >= 0
          ? taskRunConfig.blueprintVersion
          : 0,
      blueprintStatus: normalizeBlueprintStatus(taskRunConfig.blueprintStatus),
    },
    blueprintVersion:
      typeof detail.blueprintVersion === "number" && detail.blueprintVersion >= 0
        ? detail.blueprintVersion
        : taskRunConfig.blueprintVersion ?? 0,
    blueprintStatus: normalizeBlueprintStatus(detail.blueprintStatus ?? taskRunConfig.blueprintStatus),
    actualDurationSec: detail.actualDurationSec ?? null,
    failureReason: normalizeNullableString(detail.failureReason),
    statusDetail: normalizeNullableString(detail.statusDetail),
    cancelRequestedAt: normalizeNullableString(detail.cancelRequestedAt),
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
      projectId: "project_seed_default",
      title: "Summer Product Hook Series",
      modeId: "mass_production",
      executionMode: "automated",
      channelId: "tiktok",
      terminalPresetId: "phone_portrait",
      renderSpecJson: createDefaultRenderSpec("phone_portrait"),
      targetDurationSec: 30,
      generationMode: "user_locked",
      generationRoute: "multi_scene",
      routeReason: "legacy seed task normalized to multi-scene",
      planningVersion: "v1",
      blueprintVersion: 0,
      blueprintStatus: "pending_generation",
      actualDurationSec: null,
      failureReason: null,
      statusDetail: "等待 worker 开始处理",
      cancelRequestedAt: null,
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
      projectId: "project_seed_default",
      title: "Feature Review Promo V3",
      modeId: "high_quality",
      executionMode: "review_required",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      renderSpecJson: createDefaultRenderSpec("phone_portrait"),
      targetDurationSec: 45,
      generationMode: "user_locked",
      generationRoute: "multi_scene",
      routeReason: "legacy seed task normalized to multi-scene",
      planningVersion: "v1",
      blueprintVersion: 0,
      blueprintStatus: "pending_generation",
      actualDurationSec: null,
      failureReason: null,
      statusDetail: "等待 worker 开始处理",
      cancelRequestedAt: null,
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
  await commitTempFile(tempTasksFile, tasksFile, JSON.stringify(tasks, null, 2))
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
  await commitTempFile(tempDetailsFile, detailsFile, JSON.stringify(details, null, 2))
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
  await commitTempFile(tempRuntimeFile, runtimeFile, JSON.stringify(status, null, 2))
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
  await commitTempFile(tempAssetsFile, assetsFile, JSON.stringify(records, null, 2))
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
  await commitTempFile(tempUsersFile, usersFile, JSON.stringify(records, null, 2))
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

async function writeProviderRecords(records: ProviderRecord[]) {
  const { dataDir, providersFile, tempProvidersFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  await commitTempFile(tempProvidersFile, providersFile, JSON.stringify(records, null, 2))
}

export async function readProviderRecords(): Promise<ProviderRecord[]> {
  const { dataDir, providersFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  try {
    const content = await readFile(providersFile, "utf8")
    if (!content.trim()) {
      await writeProviderRecords([])
      return []
    }

    const parsed = JSON.parse(content) as ProviderRecord[]
    const normalized = parsed.map((record) => normalizeProviderRecord(record))
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await writeProviderRecords(normalized)
    }
    return normalized
  } catch {
    await writeProviderRecords([])
    return []
  }
}

export async function replaceProviderRecords(records: ProviderRecord[]) {
  await writeProviderRecords(records)
}

export async function readProviderRegistryRecords(): Promise<ProviderRegistryRecord[]> {
  const records = await readProviderRecords()
  return records.map((record) => ({
    id: record.id,
    providerKey: record.providerKey,
    providerType: record.providerType,
    displayName: record.displayName,
    endpointUrl: record.endpointUrl ?? record.endpointHint ?? "",
    authType: record.authType,
    authHeaderName: null,
    encryptedSecret: record.encryptedSecret,
    status:
      record.status === "available" ||
      record.status === "validating" ||
      record.status === "invalid" ||
      record.status === "disabled" ||
      record.status === "deprecated"
        ? record.status
        : "draft",
    lastValidatedAt: record.lastValidatedAt ?? null,
    lastValidationError: record.lastValidationError ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }))
}

async function writeModelRecords(records: ModelRecord[]) {
  const { dataDir, modelsFile, tempModelsFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  await commitTempFile(tempModelsFile, modelsFile, JSON.stringify(records, null, 2))
}

export async function readModelRecords(): Promise<ModelRecord[]> {
  const { dataDir, modelsFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  try {
    const content = await readFile(modelsFile, "utf8")
    if (!content.trim()) {
      await writeModelRecords([])
      return []
    }

    const parsed = JSON.parse(content) as ModelRecord[]
    const normalized = parsed
      .map((record) => normalizeModelRecord(record))
      .filter((record): record is ModelRecord => Boolean(record))
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await writeModelRecords(normalized)
    }
    return normalized
  } catch {
    await writeModelRecords([])
    return []
  }
}

export async function replaceModelRecords(records: ModelRecord[]) {
  await writeModelRecords(records)
}

export async function readModelRegistryRecords() {
  return readModelRecords()
}

function createDefaultModelDefaults(): ModelDefaultsDocument {
  return {
    globalDefaults: {} satisfies GlobalModelDefaults,
    modeDefaults: [],
    updatedAt: null,
  }
}

async function writeModelDefaults(document: ModelDefaultsDocument) {
  const { dataDir, modelDefaultsFile, tempModelDefaultsFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  await commitTempFile(tempModelDefaultsFile, modelDefaultsFile, JSON.stringify(document, null, 2))
}

export async function readModelDefaults(): Promise<ModelDefaultsDocument> {
  const { dataDir, modelDefaultsFile } = resolveFiles()
  await mkdir(dataDir, { recursive: true })
  try {
    const content = await readFile(modelDefaultsFile, "utf8")
    if (!content.trim()) {
      const defaults = createDefaultModelDefaults()
      await writeModelDefaults(defaults)
      return defaults
    }

    const parsed = JSON.parse(content) as ModelDefaultsDocument
    const normalized = normalizeModelDefaultsDocument(parsed)
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await writeModelDefaults(normalized)
    }
    return normalized
  } catch {
    const defaults = createDefaultModelDefaults()
    await writeModelDefaults(defaults)
    return defaults
  }
}

export async function replaceModelDefaults(document: ModelDefaultsDocument) {
  await writeModelDefaults(document)
}

function toControlPlaneDefaults(document: ModelDefaultsDocument): ModelControlDefaults {
  const controlPlane = {
    global: {} as NonNullable<ModelControlDefaults["global"]>,
    modes: {
      mass_production: {},
      high_quality: {},
    } as NonNullable<ModelControlDefaults["modes"]>,
    updatedAt: document.updatedAt ?? null,
  }

  for (const [slot, selection] of Object.entries(document.globalDefaults)) {
    if (selection?.modelId || selection?.providerId) {
      controlPlane.global[slot as keyof typeof controlPlane.global] = {
        slotType: slot as any,
        providerId: selection.providerId,
        modelId: selection.modelId,
      }
    }
  }

  for (const entry of document.modeDefaults) {
    for (const [slot, selection] of Object.entries(entry.slots)) {
      if (selection?.modelId || selection?.providerId) {
        controlPlane.modes[entry.modeId][slot as keyof (typeof controlPlane.modes)[typeof entry.modeId]] = {
          slotType: slot as any,
          providerId: selection.providerId,
          modelId: selection.modelId,
        }
      }
    }
  }

  return controlPlane as ModelControlDefaults
}

function fromControlPlaneDefaults(document: ModelControlDefaults): ModelDefaultsDocument {
  return {
    globalDefaults: normalizeGlobalModelDefaults(document.global ?? {}),
    modeDefaults: (["mass_production", "high_quality"] as const).map((modeId) => ({
      modeId,
      slots: normalizeGlobalModelDefaults(document.modes?.[modeId] ?? {}),
    })),
    updatedAt: document.updatedAt ?? null,
  }
}

export async function readModelControlDefaults(): Promise<ModelControlDefaults> {
  const defaults = await readModelDefaults()
  return toControlPlaneDefaults(defaults)
}

export async function replaceModelControlDefaults(document: ModelControlDefaults) {
  await replaceModelDefaults(fromControlPlaneDefaults(document))
}
