import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ModelUsageSummary } from "../components/ModelUsageSummary"
import { MoreActionsMenu } from "../components/MoreActionsMenu"
import {
  API_BASE_URL,
  api,
  buildAssetDownloadUrl,
  buildAssetPreviewUrl,
  buildBatchDashboardUrl,
  buildDeliveryManifestUrl,
  buildTaskReviewUrl,
  getAudioStrategyLabel,
  normalizeOperatorCopy,
  type AssetRecord,
  type RuntimeStatusResponse,
  type TaskDiagnostics,
  type TaskSummary,
  type TaskTimelineEvent,
} from "../api"

function getDurationDelta(task: TaskSummary | null) {
  if (!task || task.actualDurationSec == null) {
    return null
  }

  return task.actualDurationSec - task.targetDurationSec
}

function getToleranceLabel(delta: number | null) {
  if (delta == null) {
    return "待成片"
  }

  if (Math.abs(delta) <= 2) {
    return "容差内"
  }

  return "需复核"
}

function getTaskFlowLabel(task: TaskSummary | null) {
  if (!task) {
    return "待同步"
  }

  if (task.statusDetail?.trim()) {
    return normalizeOperatorCopy(task.statusDetail.trim())
  }

  if (task.executionMode === "review_required" && task.blueprintStatus === "ready_for_review") {
    return `整条视频待审核 (方案 v${task.blueprintVersion})`
  }

  if (task.executionMode === "review_required" && task.blueprintStatus === "approved") {
    return `审核已通过，待继续生成 (方案 v${task.blueprintVersion})`
  }

  if (task.executionMode === "review_required" && task.blueprintStatus === "rejected") {
    return `生成方案已驳回 (方案 v${task.blueprintVersion})`
  }

  if (task.status === "completed") {
    return "任务已完成"
  }

  if (task.status === "failed") {
    return "任务失败"
  }

  if (task.status === "running") {
    return "生成进行中"
  }

  return "等待生成"
}

function canCancelTask(task: TaskSummary | null) {
  return task?.status === "queued" || task?.status === "running"
}

function formatFailureModelRoute(task: TaskSummary | null) {
  if (!task?.modelTrace) {
    return ""
  }

  return Object.values(task.modelTrace)
    .filter(Boolean)
    .map((trace) => `${trace.label}${trace.requestPath ? `（${trace.requestPath}）` : ""}`)
    .join(" · ")
}

function canResumeFailedTask(task: TaskSummary | null) {
  return task?.status === "failed"
}

function formatTimelineTime(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return "时间未知"
  }
  return new Date(parsed).toLocaleTimeString("zh-CN")
}

function isStaleRunningTask(task: TaskSummary | null) {
  if (task?.status !== "running") {
    return false
  }

  const updatedAtMs = Date.parse(task.lastHeartbeatAt ?? task.updatedAt)
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs >= 10 * 60 * 1000
}

function canResumeTask(task: TaskSummary | null, diagnostics: TaskDiagnostics | null, diagnosticsError: string) {
  if (diagnostics) {
    return diagnostics.recoverable
  }

  if (diagnosticsError) {
    return canResumeFailedTask(task)
  }

  return canResumeFailedTask(task) || isStaleRunningTask(task)
}

function canDeleteTaskAssets(task: TaskSummary | null) {
  return task?.status === "failed" || task?.status === "completed" || task?.status === "canceled" || task?.status === "waiting_review"
}

function getAssetDeleteLockLabel(task: TaskSummary | null) {
  if (canDeleteTaskAssets(task)) {
    return ""
  }
  return "任务还在生成中，素材暂时不能清理"
}

type DeliveryCheckKey =
  | "finalVideo"
  | "subtitles"
  | "script"
  | "cover"
  | "title"
  | "description"
  | "manifest"

type DeliveryItemStatus = "ready" | "needs_check" | "missing" | "failed" | "pending" | "unknown"
type DeliveryWorkbenchSource = "api" | "fallback"
type DeliveryRetryKind = "keyframe" | "video" | "scene"

type DeliveryCheck = {
  key: DeliveryCheckKey
  label: string
  status: DeliveryItemStatus
  message: string
  assetId?: string
}

type DeliverySceneCell = {
  status: DeliveryItemStatus
  label: string
  message: string
}

type DeliverySceneRow = {
  sceneId: string
  index: number
  title: string
  keyframe: DeliverySceneCell
  video: DeliverySceneCell
  review: DeliverySceneCell
}

type DeliveryRecommendation = {
  id: string
  label: string
  description: string
  retryKind?: DeliveryRetryKind
  sceneId?: string
}

type DeliveryWorkbench = {
  source: DeliveryWorkbenchSource
  checks: DeliveryCheck[]
  scenes: DeliverySceneRow[]
  recommendedActions: DeliveryRecommendation[]
  retryEndpoints: Partial<Record<DeliveryRetryKind, string>>
  publishCopy: {
    title: string
    description: string
    channelId: string
  }
  manifestUrl?: string
  message: string
  updatedAt?: string
}

type DeliveryStatusSummary = {
  id: "ready_to_publish" | "needs_delivery_check" | "missing_assets" | "failed_recovery"
  label: string
  description: string
  tone: "success" | "warning" | "danger"
}

const DELIVERY_CHECK_ORDER: DeliveryCheckKey[] = [
  "finalVideo",
  "subtitles",
  "script",
  "cover",
  "title",
  "description",
  "manifest",
]

const DELIVERY_CHECK_LABELS: Record<DeliveryCheckKey, string> = {
  finalVideo: "成片视频",
  subtitles: "英文字幕",
  script: "最终脚本",
  cover: "发布封面",
  title: "发布标题",
  description: "发布描述",
  manifest: "素材清单",
}

const DELIVERY_STATUS_COPY: DeliveryStatusSummary[] = [
  {
    id: "ready_to_publish",
    label: "可以发布",
    description: "发布需要的文件都齐了，可以进入发布前复核。",
    tone: "success",
  },
  {
    id: "needs_delivery_check",
    label: "交付待检查",
    description: "还有待确认项，先看检查清单和分段状态。",
    tone: "warning",
  },
  {
    id: "missing_assets",
    label: "缺文件",
    description: "关键文件缺失，或记录里的文件当前打不开。",
    tone: "danger",
  },
  {
    id: "failed_recovery",
    label: "失败待处理",
    description: "任务失败或可恢复，需要局部重试或恢复生成。",
    tone: "danger",
  },
]

const RETRY_IMPACT_COPY: Record<DeliveryRetryKind, string> = {
  keyframe: "只重做这一段的关键画面，适合封面或首帧方向不对。",
  video: "沿用当前关键画面，只重做这一段视频，会增加视频生成成本。",
  scene: "这一段的关键画面和视频都重做，成本最高，适合画面方向整体错误。",
}

const RETRY_BUTTON_LABELS: Record<DeliveryRetryKind, string> = {
  keyframe: "只重做关键画面",
  video: "只重做视频段",
  scene: "关键画面和视频都重做",
}

const ASSET_TYPE_LABELS: Partial<Record<AssetRecord["assetType"], string>> = {
  video_bundle: "成片文件",
  subtitles: "字幕文件",
  script: "脚本文件",
  audio: "音频文件",
  keyframe_image: "关键画面",
  scene_video: "视频分段",
  keyframe_bundle: "关键画面包",
  keyframe_prompt_summary: "画面提示词",
  source_script: "原始文案",
}

const ASSET_TYPE_BY_CHECK: Partial<Record<DeliveryCheckKey, AssetRecord["assetType"]>> = {
  finalVideo: "video_bundle",
  subtitles: "subtitles",
  script: "script",
  manifest: "keyframe_bundle",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function normalizeDeliveryStatus(value: unknown): DeliveryItemStatus {
  const status = readString(value).toLowerCase().replaceAll("-", "_")

  if (["ready", "ok", "pass", "passed", "available", "approved", "complete", "completed"].includes(status)) {
    return "ready"
  }

  if (["review", "needs_review", "needs_check", "warning", "warn", "check"].includes(status)) {
    return "needs_check"
  }

  if (["missing", "not_found", "absent", "unavailable"].includes(status)) {
    return "missing"
  }

  if (["failed", "error", "rejected", "blocked"].includes(status)) {
    return "failed"
  }

  if (["pending", "running", "queued", "generating", "in_progress"].includes(status)) {
    return "pending"
  }

  return "unknown"
}

function normalizeCheckKey(value: string): DeliveryCheckKey | null {
  const key = value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_")

  if (["final_video", "finalvideo", "video", "video_bundle", "final"].includes(key)) {
    return "finalVideo"
  }

  if (["subtitles", "subtitle", "srt"].includes(key)) {
    return "subtitles"
  }

  if (["script", "voiceover_script", "final_script"].includes(key)) {
    return "script"
  }

  if (["cover", "cover_image", "thumbnail"].includes(key)) {
    return "cover"
  }

  if (key === "title") {
    return "title"
  }

  if (["description", "post_description", "caption"].includes(key)) {
    return "description"
  }

  if (["manifest", "delivery_manifest", "keyframe_manifest"].includes(key)) {
    return "manifest"
  }

  return null
}

function normalizeDeliveryCheck(rawKey: DeliveryCheckKey, value: unknown): DeliveryCheck {
  if (!isRecord(value)) {
    const status = normalizeDeliveryStatus(value)
    return {
      key: rawKey,
      label: DELIVERY_CHECK_LABELS[rawKey],
      status,
      message: getDeliveryStatusLabel(status),
    }
  }

  const status = normalizeDeliveryStatus(value.status ?? value.state ?? value.result)
  return {
    key: rawKey,
    label: readString(value.label) || DELIVERY_CHECK_LABELS[rawKey],
    status,
    message: readString(value.message) || readString(value.reason) || getDeliveryStatusLabel(status),
    assetId: readString(value.assetId) || undefined,
  }
}

function normalizeSceneCell(value: unknown): DeliverySceneCell {
  if (!isRecord(value)) {
    const status = normalizeDeliveryStatus(value)
    return {
      status,
      label: getDeliveryStatusLabel(status),
      message: "",
    }
  }

  const status = normalizeDeliveryStatus(value.status ?? value.state ?? value.result)
  return {
    status,
    label: readString(value.label) || getDeliveryStatusLabel(status),
    message: readString(value.message) || readString(value.reason),
  }
}

function normalizeRetryKind(value: unknown): DeliveryRetryKind | undefined {
  const kind = readString(value).toLowerCase()
  if (kind === "keyframe" || kind === "video" || kind === "scene") {
    return kind
  }
  return undefined
}

function normalizeRetryEndpoints(value: unknown): Partial<Record<DeliveryRetryKind, string>> {
  if (!isRecord(value)) {
    return {}
  }

  return {
    keyframe: readString(value.keyframe) || undefined,
    video: readString(value.video) || undefined,
    scene: readString(value.scene) || undefined,
  }
}

function normalizeRecommendedActions(value: unknown): DeliveryRecommendation[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      return {
        id: `action_${index}`,
        label: String(item),
        description: "",
      }
    }

    return {
      id: readString(item.id) || `action_${index}`,
      label: readString(item.label) || readString(item.title) || "建议动作",
      description: readString(item.description) || readString(item.message),
      retryKind: normalizeRetryKind(item.retryKind ?? item.kind),
      sceneId: readString(item.sceneId) || undefined,
    }
  })
}

function normalizePublishCopy(value: unknown): DeliveryWorkbench["publishCopy"] {
  if (!isRecord(value)) {
    return {
      title: "",
      description: "",
      channelId: "",
    }
  }

  return {
    title: readString(value.title),
    description: readString(value.description),
    channelId: readString(value.channelId),
  }
}

function normalizeSceneRows(value: unknown): DeliverySceneRow[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item, index) => {
    const row = isRecord(item) ? item : {}
    const sceneId = readString(row.sceneId) || readString(row.id) || `scene_${index + 1}`
    const sceneIndex = typeof row.index === "number" ? row.index : index

    return {
      sceneId,
      index: sceneIndex,
      title: readString(row.title) || `第 ${sceneIndex + 1} 段`,
      keyframe: normalizeSceneCell(row.keyframe ?? row.keyframeStatus),
      video: normalizeSceneCell(row.video ?? row.videoStatus),
      review: normalizeSceneCell(row.review ?? row.reviewStatus),
    }
  })
}

export function normalizeDeliveryWorkbench(payload: unknown): DeliveryWorkbench {
  const root = isRecord(payload) && isRecord(payload.delivery) ? payload.delivery : payload
  const record = isRecord(root) ? root : {}
  const checksValue = record.checks
  const checksByKey = new Map<DeliveryCheckKey, DeliveryCheck>()

  if (Array.isArray(checksValue)) {
    checksValue.forEach((item) => {
      if (!isRecord(item)) {
        return
      }
      const rawKey = readString(item.key) || readString(item.id) || readString(item.type)
      const key = normalizeCheckKey(rawKey)
      if (key) {
        checksByKey.set(key, normalizeDeliveryCheck(key, item))
      }
    })
  } else if (isRecord(checksValue)) {
    Object.entries(checksValue).forEach(([rawKey, value]) => {
      const key = normalizeCheckKey(rawKey)
      if (key) {
        checksByKey.set(key, normalizeDeliveryCheck(key, value))
      }
    })
  }

  const checks = DELIVERY_CHECK_ORDER.map(
    (key) =>
      checksByKey.get(key) ?? {
        key,
        label: DELIVERY_CHECK_LABELS[key],
        status: "unknown" as const,
        message: "等待系统确认",
      },
  )

  return {
    source: "api",
    checks,
    scenes: normalizeSceneRows(record.sceneMatrix ?? record.scenes),
    recommendedActions: normalizeRecommendedActions(record.recommendedActions ?? record.actions),
    retryEndpoints: normalizeRetryEndpoints(record.retryEndpoints),
    publishCopy: normalizePublishCopy(record.publishCopy),
    manifestUrl: readString(record.manifestUrl) || undefined,
    message: readString(record.operatorMessage) || readString(record.message),
    updatedAt: readString(record.updatedAt) || undefined,
  }
}

function getDeliveryStatusLabel(status: DeliveryItemStatus) {
  switch (status) {
    case "ready":
      return "就绪"
    case "needs_check":
      return "待检查"
    case "missing":
      return "缺失"
    case "failed":
      return "失败"
    case "pending":
      return "生成中"
    default:
      return "待确认"
  }
}

function isReadyAsset(asset: AssetRecord) {
  return asset.exists && asset.status === "ready"
}

function getAssetTypeLabel(assetType: AssetRecord["assetType"] | string | null | undefined) {
  if (!assetType) {
    return "暂无缺口"
  }
  return ASSET_TYPE_LABELS[assetType as AssetRecord["assetType"]] ?? normalizeOperatorCopy(String(assetType))
}

function getAssetSourceLabel(asset: AssetRecord) {
  if (asset.assetType === "keyframe_image") {
    return `来自：${normalizeOperatorCopy(asset.label)}`
  }

  if (asset.assetType === "scene_video") {
    return `来自：${normalizeOperatorCopy(asset.label)} 对应的视频段`
  }

  if (asset.assetType === "keyframe_bundle" || asset.assetType === "keyframe_prompt_summary") {
    return "来自：关键画面生成记录"
  }

  return `来自：${normalizeOperatorCopy(asset.label)}`
}

function getAssetModelLabel(asset: AssetRecord) {
  return asset.modelTrace?.label ? `使用模型：${asset.modelTrace.label}` : "使用模型：这条素材没有留下模型记录"
}

function getAssetBasisLabel(asset: AssetRecord) {
  if (asset.assetType === "keyframe_image") {
    return "生成依据：按这段分镜的英文提示词生成，完整提示词可在关键画面提示词摘要里查看。"
  }

  if (asset.assetType === "scene_video") {
    return "生成依据：沿用对应关键画面和视频段提示词生成。"
  }

  if (asset.assetType === "keyframe_prompt_summary") {
    return "生成依据：这里保存了关键画面的英文提示词摘要。"
  }

  return "生成依据：来自当前任务的脚本、分镜和生成设置。"
}

function getAssetReadableStatus(asset: AssetRecord) {
  if (!asset.exists) {
    return "缺图：记录还在，但文件现在打不开。"
  }

  if (asset.status !== "ready") {
    return "状态：还在生成或等待刷新。"
  }

  return "状态：文件已生成，可以预览或下载。"
}

function findAssetForCheck(assets: AssetRecord[], key: DeliveryCheckKey) {
  const assetType = ASSET_TYPE_BY_CHECK[key]
  if (!assetType) {
    return null
  }
  return assets.find((asset) => asset.assetType === assetType) ?? null
}

export function buildFallbackDeliveryWorkbench(input: {
  task: TaskSummary | null
  assets: AssetRecord[]
  diagnostics: TaskDiagnostics | null
}): DeliveryWorkbench {
  const checks = DELIVERY_CHECK_ORDER.map<DeliveryCheck>((key) => {
    const asset = findAssetForCheck(input.assets, key)

    if (!asset && ASSET_TYPE_BY_CHECK[key]) {
      return {
        key,
        label: DELIVERY_CHECK_LABELS[key],
        status: "missing",
        message: "当前素材列表里没有找到这个文件",
      }
    }

    if (asset) {
      const status = isReadyAsset(asset) ? "ready" : asset.exists ? "pending" : "missing"
      return {
        key,
        label: DELIVERY_CHECK_LABELS[key],
        status,
        message: isReadyAsset(asset) ? asset.fileName : asset.exists ? "文件仍在生成或待刷新" : "记录存在但文件不可访问",
        assetId: asset.id,
      }
    }

    return {
      key,
      label: DELIVERY_CHECK_LABELS[key],
      status: "unknown",
      message: "等待系统返回发布字段",
    }
  })

  const currentSceneTotal = input.diagnostics?.runtimeTrace.currentSceneTotal ?? input.task?.currentSceneTotal ?? 0
  const currentSceneIndex = input.diagnostics?.runtimeTrace.currentSceneIndex ?? input.task?.currentSceneIndex ?? null
  const scenes = Array.from({ length: currentSceneTotal }, (_, index) => {
    const isCurrentScene = currentSceneIndex === index
    const pendingStatus: DeliverySceneCell = {
      status: isCurrentScene ? "pending" : "unknown",
      label: isCurrentScene ? "生成中" : "待确认",
      message: isCurrentScene ? "当前正在处理这一段" : "等待分段状态同步",
    }
    const reviewStatus: DeliverySceneCell = {
      status: "unknown",
      label: "待确认",
      message: "等待审核状态同步",
    }

    return {
      sceneId: `scene_${index + 1}`,
      index,
      title: `第 ${index + 1} 段`,
      keyframe: pendingStatus,
      video: pendingStatus,
      review: reviewStatus,
    }
  })

  return {
    source: "fallback",
    checks,
    scenes,
    recommendedActions: input.diagnostics?.recoverable
      ? [
          {
            id: "resume_failed_task",
            label: "恢复失败任务",
            description: input.diagnostics.operatorMessage,
          },
        ]
      : [],
    retryEndpoints: {},
    publishCopy: {
      title: input.task?.title ?? "",
      description: input.task?.planning?.planningSummary ?? "",
      channelId: input.task?.channelId ?? "",
    },
    message: "交付检查暂时没有返回完整结果，当前根据素材、诊断和时间线保守判断。",
  }
}

export function classifyDeliveryWorkbench(
  workbench: DeliveryWorkbench | null,
  task: TaskSummary | null,
): DeliveryStatusSummary {
  if (task?.status === "failed" || workbench?.checks.some((check) => check.status === "failed")) {
    return DELIVERY_STATUS_COPY.find((item) => item.id === "failed_recovery") ?? DELIVERY_STATUS_COPY[3]
  }

  if (workbench?.checks.some((check) => check.status === "missing")) {
    return DELIVERY_STATUS_COPY.find((item) => item.id === "missing_assets") ?? DELIVERY_STATUS_COPY[2]
  }

  const hasAllExplicitChecks = Boolean(workbench && workbench.checks.every((check) => check.status === "ready"))
  if (task?.status === "completed" && hasAllExplicitChecks) {
    return DELIVERY_STATUS_COPY.find((item) => item.id === "ready_to_publish") ?? DELIVERY_STATUS_COPY[0]
  }

  return DELIVERY_STATUS_COPY.find((item) => item.id === "needs_delivery_check") ?? DELIVERY_STATUS_COPY[1]
}

function resolveApiUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl
  }

  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`
  return `${API_BASE_URL}${path}`
}

async function fetchTaskDeliveryWorkbench(taskId: string) {
  return normalizeDeliveryWorkbench(await api.getTaskDelivery(taskId))
}

async function postDeliveryRetry(input: {
  taskId: string
  workbench: DeliveryWorkbench | null
  kind: DeliveryRetryKind
  sceneId?: string
}) {
  const endpoint =
    input.workbench?.retryEndpoints[input.kind] ??
    `/api/tasks/${encodeURIComponent(input.taskId)}/retry`
  const payload = {
    scope: input.kind,
    sceneId: input.sceneId,
    reason: `${input.kind}${input.sceneId ? `:${input.sceneId}` : ""}`,
  }
  if (endpoint === `/api/tasks/${encodeURIComponent(input.taskId)}/retry`) {
    return api.retryTask(input.taskId, payload)
  }

  const response = await fetch(resolveApiUrl(endpoint), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  const content = await response.text()

  if (!response.ok) {
    throw new Error(content || `局部重试提交失败 (${response.status})`)
  }

  return content ? JSON.parse(content) : {}
}

function sortAssetsForDelivery(assets: AssetRecord[]) {
  const priority: Record<AssetRecord["assetType"], number> = {
    video_bundle: 0,
    subtitles: 1,
    script: 2,
    audio: 3,
    source_script: 4,
    planning_prompt: 5,
    planning_response: 6,
    planning_audit: 7,
    visual_plan: 8,
    keyframe_prompt_summary: 9,
    storyboard: 10,
    keyframe_bundle: 11,
    keyframe_image: 12,
    scene_video: 13,
  }

  return [...assets].sort((left, right) => {
    const priorityDiff = priority[left.assetType] - priority[right.assetType]
    if (priorityDiff !== 0) {
      return priorityDiff
    }
    return left.label.localeCompare(right.label, "zh-CN")
  })
}

export function AssetsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const routeTaskId = searchParams.get("taskId") ?? ""

  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [runtime, setRuntime] = useState<RuntimeStatusResponse["runtime"] | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [timeline, setTimeline] = useState<TaskTimelineEvent[]>([])
  const [diagnostics, setDiagnostics] = useState<TaskDiagnostics | null>(null)
  const [diagnosticsError, setDiagnosticsError] = useState("")
  const [deliveryWorkbench, setDeliveryWorkbench] = useState<DeliveryWorkbench | null>(null)
  const [deliveryError, setDeliveryError] = useState("")
  const [previewAsset, setPreviewAsset] = useState<AssetRecord | null>(null)
  const [previewText, setPreviewText] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState("")
  const [lastRefreshAt, setLastRefreshAt] = useState<string>("")
  const [isStale, setIsStale] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [actionError, setActionError] = useState("")
  const [actionSuccess, setActionSuccess] = useState("")
  const [cancelingTaskId, setCancelingTaskId] = useState("")
  const [resumingTaskId, setResumingTaskId] = useState("")
  const [deletingAssetId, setDeletingAssetId] = useState("")
  const [deletingTaskAssets, setDeletingTaskAssets] = useState(false)
  const [deletingTask, setDeletingTask] = useState(false)
  const [retryingDeliveryAction, setRetryingDeliveryAction] = useState("")

  function syncTaskContext(taskId?: string, replace = true) {
    const currentTaskId = searchParams.get("taskId") ?? ""
    const nextTaskId = taskId ?? ""

    if (currentTaskId === nextTaskId) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)

    if (taskId) {
      nextSearchParams.set("taskId", taskId)
    } else {
      nextSearchParams.delete("taskId")
    }

    setSearchParams(nextSearchParams, { replace })
  }

  async function loadTaskWorkData(taskId: string) {
    if (!taskId) {
      setAssets([])
      setTimeline([])
      setDiagnostics(null)
      setDiagnosticsError("")
      setDeliveryWorkbench(null)
      setDeliveryError("")
      return
    }

    const [assetResult, timelineResult, diagnosticsResult, deliveryResult] = await Promise.all([
      api.getTaskAssets(taskId),
      api.getTaskTimeline(taskId).catch(() => ({ timeline: [] })),
      api
        .getTaskDiagnostics(taskId)
        .then((result) => ({ diagnostics: result.diagnostics, error: "" }))
        .catch(() => ({ diagnostics: null, error: "诊断暂不可用，素材列表仍可查看。" })),
      fetchTaskDeliveryWorkbench(taskId)
        .then((delivery) => ({ delivery, error: "" }))
        .catch(() => ({ delivery: null, error: "交付检查接口暂不可用，已根据素材和诊断保守推断。" })),
    ])

    const taskForFallback = tasks.find((task) => task.id === taskId) ?? null
    const fallbackWorkbench = buildFallbackDeliveryWorkbench({
      task: taskForFallback,
      assets: assetResult.assets,
      diagnostics: diagnosticsResult.diagnostics,
    })

    setAssets(assetResult.assets)
    setTimeline(timelineResult.timeline)
    setDiagnostics(diagnosticsResult.diagnostics)
    setDiagnosticsError(diagnosticsResult.error)
    setDeliveryWorkbench(deliveryResult.delivery ?? fallbackWorkbench)
    setDeliveryError(deliveryResult.error)
    setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
    setIsStale(false)
    setLoadError("")
  }

  useEffect(() => {
    async function load() {
      const [taskResult, runtimeResult] = await Promise.all([api.listTasks(), api.runtimeStatus()])
      setTasks(taskResult.tasks)
      setRuntime(runtimeResult.runtime)
      setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
      setIsStale(false)
      setLoadError("")
    }

    void load().catch(() => {
      setLoadError("任务或系统状态加载失败，当前结果可能不完整。")
      setIsStale(true)
    })

    const timer = window.setInterval(() => {
      void Promise.all([api.listTasks(), api.runtimeStatus()])
        .then(([taskResult, runtimeResult]) => {
          setTasks(taskResult.tasks)
          setRuntime(runtimeResult.runtime)
          setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
          setIsStale(false)
          setLoadError("")
        })
        .catch(() => {
          setIsStale(true)
          setLoadError("自动刷新失败，当前可能显示的是旧任务状态。")
        })
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!tasks.length) {
      setSelectedTaskId("")
      return
    }

    const nextTask = tasks.find((task) => task.id === routeTaskId) ?? tasks[0] ?? null
    if (nextTask && nextTask.id !== selectedTaskId) {
      setSelectedTaskId(nextTask.id)
    }
  }, [routeTaskId, selectedTaskId, tasks])

  useEffect(() => {
    void loadTaskWorkData(selectedTaskId).catch(() => {
      setAssets([])
      setTimeline([])
      setDeliveryWorkbench(null)
      setDeliveryError("")
      setIsStale(true)
      setLoadError("素材列表加载失败，当前无法确认发布文件是否完整。")
    })

    const timer = window.setInterval(() => {
      void loadTaskWorkData(selectedTaskId).catch(() => {
        setAssets([])
        setDeliveryWorkbench(null)
        setIsStale(true)
        setLoadError("素材自动刷新失败，当前可能显示的是旧结果。")
      })
    }, 5000)

    return () => window.clearInterval(timer)
  }, [selectedTaskId])

  useEffect(() => {
    if (!selectedTaskId) {
      return
    }

    syncTaskContext(selectedTaskId, true)
  }, [selectedTaskId])

  async function handleCancelTask(taskId: string) {
    setActionError("")
    setActionSuccess("")
    setCancelingTaskId(taskId)
    try {
      const response = await api.cancelTask(taskId)
      setTasks((current) => current.map((task) => (task.id === taskId ? response.task : task)))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "终止任务失败")
    } finally {
      setCancelingTaskId("")
    }
  }

  async function handleResumeFailedTask(taskId: string) {
    setActionError("")
    setActionSuccess("")
    setResumingTaskId(taskId)
    try {
      const response = await api.resumeFailedTask(taskId)
      setTasks((current) => current.map((task) => (task.id === taskId ? response.task : task)))
      if (response.diagnostics) {
        setDiagnostics(response.diagnostics)
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "恢复生成失败")
    } finally {
      setResumingTaskId("")
    }
  }

  async function handleDeleteAsset(asset: AssetRecord) {
    if (!canDeleteTaskAssets(selectedTask)) {
      setActionError(getAssetDeleteLockLabel(selectedTask))
      return
    }

    const assetLabel = normalizeOperatorCopy(asset.label)

    if (!window.confirm(`确认删除素材「${assetLabel}」吗？该操作会删除这个任务自己的文件，无法从页面里恢复。`)) {
      return
    }

    setActionError("")
    setActionSuccess("")
    setDeletingAssetId(asset.id)
    try {
      await api.deleteTaskAsset(asset.taskId, asset.id)
      await loadTaskWorkData(asset.taskId)
      setActionSuccess(`已删除素材：${assetLabel}`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "删除素材失败")
    } finally {
      setDeletingAssetId("")
    }
  }

  async function handleDeleteTaskAssets() {
    if (!selectedTask) {
      return
    }

    if (!canDeleteTaskAssets(selectedTask)) {
      setActionError(getAssetDeleteLockLabel(selectedTask))
      return
    }

    if (!window.confirm(`确认清空任务「${selectedTask.title}」的全部素材文件吗？该操作只会删除该任务自己的文件和记录。`)) {
      return
    }

    setActionError("")
    setActionSuccess("")
    setDeletingTaskAssets(true)
    try {
      await api.deleteTaskAssets(selectedTask.id)
      await loadTaskWorkData(selectedTask.id)
      setActionSuccess(`已清空任务素材：${selectedTask.title}`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "清空任务素材失败")
    } finally {
      setDeletingTaskAssets(false)
    }
  }

  async function handleDeleteTask() {
    if (!selectedTask) {
      return
    }

    if (!canDeleteTaskAssets(selectedTask)) {
      setActionError(getAssetDeleteLockLabel(selectedTask))
      return
    }

    if (!window.confirm(`确认删除整个任务「${selectedTask.title}」吗？\n\n这会同时删除任务记录、素材文件、排查记录和时间线，无法从页面里恢复。`)) {
      return
    }

    const deletedTask = selectedTask
    setActionError("")
    setActionSuccess("")
    setDeletingTask(true)
    try {
      await api.deleteTask(deletedTask.id)
      setTasks((current) => current.filter((task) => task.id !== deletedTask.id))
      setAssets([])
      setTimeline([])
      setDiagnostics(null)
      setDiagnosticsError("")
      setDeliveryWorkbench(null)
      setDeliveryError("")
      setPreviewAsset(null)
      setPreviewText("")
      setPreviewError("")
      setPreviewLoading(false)
      syncTaskContext("")
      setActionSuccess(`已删除任务：${deletedTask.title}`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "删除任务失败")
    } finally {
      setDeletingTask(false)
    }
  }

  async function handleDeliveryRetry(kind: DeliveryRetryKind, sceneId?: string) {
    if (!selectedTaskId) {
      return
    }

    const impact = RETRY_IMPACT_COPY[kind]
    const targetLabel = sceneId ? `分段 ${sceneId}` : "当前任务"
    if (!window.confirm(`确认${RETRY_BUTTON_LABELS[kind]}吗？\n\n影响：${impact}\n\n目标：${targetLabel}`)) {
      return
    }

    const actionKey = `${kind}:${sceneId ?? "task"}`
    setActionError("")
    setActionSuccess("")
    setRetryingDeliveryAction(actionKey)
    try {
      await postDeliveryRetry({
        taskId: selectedTaskId,
        workbench: deliveryWorkbench,
        kind,
        sceneId,
      })
      await loadTaskWorkData(selectedTaskId)
      setActionSuccess(`已提交${RETRY_BUTTON_LABELS[kind]}：${targetLabel}`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "局部重试失败")
    } finally {
      setRetryingDeliveryAction("")
    }
  }

  async function handleCopyDeliveryText(label: string, text: string) {
    if (!text.trim()) {
      setActionError(`${label} 暂无可复制内容`)
      return
    }

    setActionError("")
    setActionSuccess("")
    try {
      await navigator.clipboard.writeText(text)
      setActionSuccess(`已复制${label}`)
    } catch {
      setActionError(`复制${label}失败，请手动选中文本复制。`)
    }
  }

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  )

  const assetStats = useMemo(() => {
    const readyCount = assets.filter((asset) => asset.status === "ready").length
    const previewableCount = assets.filter((asset) => asset.previewable).length
    const missingCount = assets.filter((asset) => !asset.exists).length
    const deliverables = assets.filter((asset) => ["video_bundle", "subtitles", "script", "audio"].includes(asset.assetType))
    const deliveryChecks = deliveryWorkbench?.checks ?? []
    const deliverableReadyCount = deliveryChecks.length
      ? deliveryChecks.filter((check) => check.status === "ready").length
      : deliverables.filter((asset) => asset.status === "ready").length

    return {
      readyCount,
      previewableCount,
      missingCount,
      deliverableReadyCount,
      deliverableTotal: deliveryChecks.length || deliverables.length,
    }
  }, [assets, deliveryWorkbench])

  const durationDelta = useMemo(() => getDurationDelta(selectedTask), [selectedTask])
  const durationDeltaLabel = durationDelta == null ? "待成片" : `${durationDelta > 0 ? "+" : ""}${durationDelta.toFixed(1)}s`
  const toleranceLabel = getToleranceLabel(durationDelta)
  const sortedAssets = useMemo(() => sortAssetsForDelivery(assets), [assets])
  const visibleKeyframeCount = Math.max(
    assets.filter((asset) => asset.assetType === "keyframe_image").length,
    selectedTask?.keyframeCount ?? 0,
    selectedTask ? Math.max(1, Math.ceil(selectedTask.targetDurationSec / 15)) : 0,
  )
  const deliverableAssets = sortedAssets.filter((asset) => ["video_bundle", "subtitles", "script", "audio"].includes(asset.assetType))
  const supportingAssets = sortedAssets.filter((asset) => !["video_bundle", "subtitles", "script", "audio"].includes(asset.assetType))
  const assetDeleteLocked = !canDeleteTaskAssets(selectedTask)
  const assetDeleteLockLabel = getAssetDeleteLockLabel(selectedTask)
  const deliveryStatus = useMemo(
    () => classifyDeliveryWorkbench(deliveryWorkbench, selectedTask),
    [deliveryWorkbench, selectedTask],
  )
  const deliveryChecks = useMemo(
    () =>
      [...(deliveryWorkbench?.checks ?? [])].sort(
        (left, right) => DELIVERY_CHECK_ORDER.indexOf(left.key) - DELIVERY_CHECK_ORDER.indexOf(right.key),
      ),
    [deliveryWorkbench],
  )
  const deliveryScenes = deliveryWorkbench?.scenes ?? []
  const canUseDeliveryRetry = selectedTask?.status === "failed" || Boolean(diagnostics?.recoverable)
  const deliveryManifestUrl = selectedTaskId
    ? deliveryWorkbench?.manifestUrl
      ? resolveApiUrl(deliveryWorkbench.manifestUrl)
      : buildDeliveryManifestUrl(selectedTaskId)
    : ""
  const recentTimeline = useMemo(() => [...timeline].slice(-6).reverse(), [timeline])
  const heartbeatAgeLabel = useMemo(() => {
    const ageMs = diagnostics?.stale.ageMs
    if (ageMs == null) {
      return "暂无进展记录"
    }

    const minutes = Math.floor(ageMs / 60000)
    if (minutes < 1) {
      return "1 分钟内"
    }
    return `${minutes} 分钟前`
  }, [diagnostics])

  useEffect(() => {
    if (previewAsset && !assets.some((asset) => asset.id === previewAsset.id)) {
      setPreviewAsset(null)
      setPreviewText("")
      setPreviewError("")
      setPreviewLoading(false)
    }
  }, [assets, previewAsset])

  async function openInlinePreview(asset: AssetRecord) {
    setPreviewAsset(asset)
    setPreviewError("")

    if (asset.previewKind === "text" || asset.previewKind === "json") {
      setPreviewLoading(true)
      try {
        const response = await fetch(buildAssetPreviewUrl(asset.taskId, asset.id))
        const content = await response.text()
        if (!response.ok) {
          throw new Error(content || `预览失败 (${response.status})`)
        }

        if (asset.previewKind === "json") {
          try {
            setPreviewText(JSON.stringify(JSON.parse(content), null, 2))
          } catch {
            setPreviewText(content)
          }
        } else {
          setPreviewText(content)
        }
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : "文本预览加载失败")
        setPreviewText("")
      } finally {
        setPreviewLoading(false)
      }
      return
    }

    setPreviewLoading(false)
    setPreviewText("")
  }

  function renderAssetList(title: string, description: string, items: AssetRecord[]) {
    const isDeliverySection = title === "发布文件"

    return (
      <section className="asset-section">
        <div className="section-header">
          <div>
            <h3>{title}</h3>
            <div className="muted">{description}</div>
          </div>
        </div>
        <div className={isDeliverySection ? "asset-trust-note asset-trust-note--delivery" : "asset-trust-note"}>
          <strong>{isDeliverySection ? "可发布文件层" : "内部排查文件层"}</strong>
          <span>
            {isDeliverySection
              ? "只把这里的成片、字幕、脚本和清单作为对外发布依据。"
              : "这里用于定位问题和恢复任务，不直接交给发布同事使用。"}
          </span>
        </div>
        <div className="task-list">
          {items.map((asset) => (
            <div key={asset.id} className="asset-item">
              <div className="asset-item-header">
                <div>
                  <div className="asset-item-title">{normalizeOperatorCopy(asset.label)}</div>
                  <div className="asset-item-tags">
                    <span className="pill pill--sm">{getAssetTypeLabel(asset.assetType)}</span>
                    <span className="pill pill--sm">
                      {asset.previewKind === "directory" ? "目录" : asset.previewKind === "json" ? "结构化预览" : asset.previewKind === "media" ? "媒体预览" : asset.previewKind === "text" ? "文本预览" : "二进制"}
                    </span>
                    <span className={asset.status === "ready" ? "status-text--success" : "status-text--warning"}>
                      {asset.status === "ready" ? "就绪" : "生成中"}
                    </span>
                  </div>
                </div>
                <div className="asset-item-size">
                  <strong>{asset.sizeLabel}</strong>
                  <div className="muted">{asset.modifiedAt ? new Date(asset.modifiedAt).toLocaleString("zh-CN") : new Date(asset.createdAt).toLocaleString("zh-CN")}</div>
                </div>
              </div>
              <div className="asset-item-meta">
                <div>
                  <div className="field-label" style={{ marginTop: 0 }}>文件名</div>
                  <div className="text-break">{asset.fileName}</div>
                </div>
                <div>
                  <div className="field-label" style={{ marginTop: 0 }}>存储位置</div>
                  <div className="text-break muted">{asset.displayPath}</div>
                </div>
                <div>
                  <div className="field-label" style={{ marginTop: 0 }}>预览信息</div>
                  <div className="muted">
                    {asset.previewable ? `浏览器内可直接打开 · ${asset.mimeType}` : `${asset.mimeType} · 仅支持下载`}
                  </div>
                </div>
                <div>
                  <div className="field-label" style={{ marginTop: 0 }}>目录</div>
                  <div className="muted">{asset.directoryName ?? "根目录"}</div>
                </div>
                <div>
                  <div className="field-label" style={{ marginTop: 0 }}>生成模型</div>
                  <div className="muted">
                    {asset.modelTrace
                      ? `${asset.modelTrace.label}，用于${asset.assetType === "scene_video" ? "生成视频段" : asset.assetType === "keyframe_image" ? "生成关键画面" : "生成这个素材"}`
                      : "这条素材没有留下模型记录"}
                  </div>
                </div>
              </div>
              {asset.assetType === "keyframe_image" || asset.assetType === "scene_video" || asset.assetType === "keyframe_prompt_summary" ? (
                <div className="asset-origin-card">
                  <span>{getAssetSourceLabel(asset)}</span>
                  <span>{getAssetModelLabel(asset)}</span>
                  <span>{getAssetBasisLabel(asset)}</span>
                  <span className={!asset.exists ? "asset-origin-card__warning" : undefined}>{getAssetReadableStatus(asset)}</span>
                </div>
              ) : null}
              <div className="asset-item-footer">
                <div className="muted" style={{ fontSize: 13 }}>
                  {asset.exists ? "记录已绑定真实文件" : "这个文件现在打不开，可能还没生成完成，也可能已被清理。"}
                </div>
                <div className="asset-item-actions">
                  {asset.previewable ? (
                    <button
                      className="ghost-button"
                      onClick={() => void openInlinePreview(asset)}
                      type="button"
                    >
                      预览
                    </button>
                  ) : (
                    <span className="ghost-button ghost-button--disabled" aria-disabled="true">
                      预览不可用
                    </span>
                  )}
                  <a className="primary-button" href={buildAssetDownloadUrl(asset.taskId, asset.id)} target="_blank" rel="noreferrer">
                    下载文件
                  </a>
                  <MoreActionsMenu
                    ariaLabel={`${normalizeOperatorCopy(asset.label)} 更多操作`}
                    items={[
                      {
                        label: assetDeleteLocked ? "素材清理已锁定" : deletingAssetId === asset.id ? "删除中..." : "删除素材",
                        description: assetDeleteLocked
                          ? assetDeleteLockLabel
                          : "只删除当前任务自己的这个文件记录和文件。",
                        tone: "danger",
                        disabled: assetDeleteLocked || deletingAssetId === asset.id,
                        onSelect: () => void handleDeleteAsset(asset),
                      },
                    ]}
                  />
                </div>
              </div>
            </div>
          ))}
          {!items.length ? (
            <div className="task-item">
              {loadError ? (
                <>
                  <div><strong>素材加载失败</strong><span> · 请先处理上方错误</span></div>
                  <div className="muted">服务恢复后，这里会自动刷新为真实素材列表。</div>
                </>
              ) : (
                <>
                  <div><strong>当前暂无记录</strong><span> · 等待任务继续产出</span></div>
                  <div className="muted">任务一旦进入下一阶段，这里会自动刷新。</div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  function renderDeliveryRetryButton(kind: DeliveryRetryKind, sceneId?: string) {
    if (!canUseDeliveryRetry) {
      return null
    }

    const actionKey = `${kind}:${sceneId ?? "task"}`
    return (
      <button
        className="ghost-button ghost-button--compact"
        disabled={!selectedTaskId || retryingDeliveryAction === actionKey}
        onClick={() => void handleDeliveryRetry(kind, sceneId)}
        title={RETRY_IMPACT_COPY[kind]}
        type="button"
      >
        {retryingDeliveryAction === actionKey ? "提交中" : RETRY_BUTTON_LABELS[kind]}
      </button>
    )
  }

  function renderSceneCell(cell: DeliverySceneCell) {
    return (
      <div className={`delivery-scene-cell delivery-scene-cell--${cell.status}`}>
        <strong>{cell.label}</strong>
        {cell.message ? <span>{cell.message}</span> : null}
      </div>
    )
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Asset Center</div>
          <h1>素材与交付</h1>
          <p>先确认成片、字幕、脚本和封面是否齐全，再检查关键画面、分段视频和排查文件。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">{selectedTask?.planning?.generationRouteLabel ?? "等待同步"}</span>
          <span className="pill pill--accent">{selectedTask?.planning?.generationPreferenceLabel ?? "等待同步"}</span>
        </div>
      </header>

      <div className="workspace-grid">
        <section className="card card--main">
          <label className="field-label">任务选择</label>
          {tasks.length ? (
            <select
              className="input"
              value={selectedTaskId}
              onChange={(event) => {
                setSelectedTaskId(event.target.value)
                syncTaskContext(event.target.value, false)
              }}
            >
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title} · {task.targetDurationSec}s · {task.planning?.generationRouteLabel ?? "等待同步"}
                </option>
              ))}
            </select>
          ) : (
            <div className="empty-inline">请先从任务列表中选择一条任务。</div>
          )}

          <div className="planning-summary-card">
            <strong>{selectedTask?.planning?.generationRouteLabel ?? "等待同步"}</strong>
            <span>{selectedTask?.planning?.planningSummary ?? "这里会展示视频结构、目标时长和生成原则的摘要。"}</span>
            <div className="planning-summary-tags">
              <span className="pill pill--sm">{selectedTask?.planning?.generationPreferenceLabel ?? "等待同步"}</span>
              <span className="pill pill--sm">{getAudioStrategyLabel(selectedTask?.audioStrategy)}</span>
              <span className="pill pill--sm">目标 {selectedTask?.targetDurationSec ?? 0}s</span>
              <span className="pill pill--sm">
                关键画面 {visibleKeyframeCount} 张 · {selectedTask?.keyframeGenerationMode === "single" ? "单张" : "批量"}
              </span>
              {selectedTask?.actualDurationSec ? (
                <span className="pill pill--sm">实际 {selectedTask.actualDurationSec.toFixed(1)}s</span>
              ) : null}
            </div>
          </div>

          <ModelUsageSummary source={selectedTask?.modelUsage} trace={selectedTask?.modelTrace} />

          <div className="route-context-card">
            <strong>正在查看这条任务</strong>
            <span>
              {selectedTaskId
                ? `任务 ${selectedTaskId}。可以从右侧返回审核页或生产看板。`
                : "选择任务后，这里会显示当前素材视角。"}
            </span>
          </div>

          <div className="muted" style={{ marginBottom: 12 }}>
            最近刷新：{lastRefreshAt || "刚刚进入页面"}{isStale ? " · 当前可能显示的是旧数据" : ""}
          </div>
          {loadError ? (
            <div className="review-inline-note review-inline-note--danger" role="alert">
              {loadError}
            </div>
          ) : null}
          {actionError ? (
            <div className="review-inline-note review-inline-note--danger" role="alert">
              {actionError}
            </div>
          ) : null}
          {actionSuccess ? (
            <div className="review-inline-note review-inline-note--success" role="status">
              {actionSuccess}
            </div>
          ) : null}
          {deliveryError ? (
            <div className="review-inline-note" role="status">
              {deliveryError}
            </div>
          ) : null}

          <section className="delivery-workbench">
            <div className="section-header section-header--stack">
              <div>
                <div className="eyebrow">Delivery Workbench</div>
                <h2>交付工作台</h2>
                <div className="muted">
                  当前判断：{deliveryStatus.label}
                  {deliveryWorkbench?.source === "fallback" ? " · 根据素材和诊断保守判断" : " · 来自交付检查"}
                  {deliveryWorkbench?.updatedAt ? ` · ${new Date(deliveryWorkbench.updatedAt).toLocaleString("zh-CN")}` : ""}
                </div>
              </div>
              <span className={`delivery-status-pill delivery-status-pill--${deliveryStatus.tone}`}>
                {deliveryStatus.label}
              </span>
            </div>

            <div className="delivery-status-grid">
              {DELIVERY_STATUS_COPY.map((item) => (
                <div
                  className={`delivery-status-card delivery-status-card--${item.tone}${deliveryStatus.id === item.id ? " delivery-status-card--active" : ""}`}
                  key={item.id}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </div>
              ))}
            </div>

            <div className="delivery-command-bar">
              <div>
                <strong>发布前交接</strong>
                <span>
                  {deliveryWorkbench?.publishCopy.channelId
                    ? `渠道 ${deliveryWorkbench.publishCopy.channelId}`
                    : "复制发布字段并下载清单，交给运营复核。"}
                </span>
              </div>
              <div className="delivery-command-bar__actions">
                <button
                  className="ghost-button ghost-button--compact"
                  onClick={() => void handleCopyDeliveryText("标题", deliveryWorkbench?.publishCopy.title ?? "")}
                  type="button"
                >
                  复制标题
                </button>
                <button
                  className="ghost-button ghost-button--compact"
                  onClick={() => void handleCopyDeliveryText("描述", deliveryWorkbench?.publishCopy.description ?? "")}
                  type="button"
                >
                  复制描述
                </button>
                {deliveryManifestUrl ? (
                  <a className="ghost-button ghost-button--compact" href={deliveryManifestUrl}>
                    下载清单
                  </a>
                ) : null}
              </div>
            </div>

            <div className="delivery-check-grid">
              {deliveryChecks.map((check) => (
                <div className={`delivery-check delivery-check--${check.status}`} key={check.key}>
                  <div className="delivery-check__header">
                    <strong>{check.label}</strong>
                    <span>{getDeliveryStatusLabel(check.status)}</span>
                  </div>
                  <div className="muted">{check.message}</div>
                  {check.assetId ? (
                    <div className="mono delivery-check__asset">文件记录 {check.assetId}</div>
                  ) : null}
                </div>
              ))}
              {!deliveryChecks.length ? (
                <div className="task-item">
                  <strong>等待任务上下文</strong>
                  <span>选择任务后会显示成片、字幕、脚本、封面、标题、描述和素材清单检查。</span>
                </div>
              ) : null}
            </div>

            {deliveryWorkbench?.message ? (
              <div className="delivery-message">
                {deliveryWorkbench.message}
              </div>
            ) : null}

            <div className="delivery-retry-guide">
              <div className="delivery-retry-guide__intro">
                <strong>重做入口</strong>
                <span>优先选影响最小的动作；“恢复生成”只用于失败或卡住的任务。</span>
              </div>
              {(Object.keys(RETRY_IMPACT_COPY) as DeliveryRetryKind[]).map((kind) => (
                <div key={kind}>
                  <strong>{RETRY_BUTTON_LABELS[kind]}</strong>
                  <span>{RETRY_IMPACT_COPY[kind]}</span>
                </div>
              ))}
            </div>

            <div className="delivery-scene-matrix">
              <div className="delivery-scene-matrix__head">
                <span>分段</span>
                <span>关键画面</span>
                <span>视频段</span>
                <span>审核</span>
                <span>重试</span>
              </div>
              {deliveryScenes.map((scene) => (
                <div className="delivery-scene-matrix__row" key={scene.sceneId}>
                  <div className="delivery-scene-title">
                    <strong>{scene.index + 1}. {scene.title}</strong>
                    <span className="mono">{scene.sceneId}</span>
                  </div>
                  {renderSceneCell(scene.keyframe)}
                  {renderSceneCell(scene.video)}
                  {renderSceneCell(scene.review)}
                  <div className="delivery-retry-actions">
                    {canUseDeliveryRetry ? (
                      <>
                        {renderDeliveryRetryButton("keyframe", scene.sceneId)}
                        {renderDeliveryRetryButton("video", scene.sceneId)}
                        {renderDeliveryRetryButton("scene", scene.sceneId)}
                      </>
                    ) : (
                      <span className="muted">无需重试</span>
                    )}
                  </div>
                </div>
              ))}
              {!deliveryScenes.length ? (
                <div className="delivery-scene-matrix__empty">
                  <strong>暂无分段状态</strong>
                  <span>系统返回分段结果后，这里会逐段显示关键画面、视频段和审核状态。</span>
                </div>
              ) : null}
            </div>

            {deliveryWorkbench?.recommendedActions.length ? (
              <div className="delivery-actions-panel">
                <div className="field-label">推荐动作</div>
                <div className="task-list compact-list">
                  {deliveryWorkbench.recommendedActions.map((action) => (
                    <div className="task-item" key={action.id}>
                      <strong>{action.label}</strong>
                      <span>{action.description || "根据当前交付检查结果推荐。"}</span>
                      {action.retryKind ? (
                        <div className="task-item__actions">
                          {renderDeliveryRetryButton(action.retryKind, action.sceneId)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <div className="asset-metrics">
            <div className="asset-metric-card">
              <div className="metric-label">目标时长</div>
              <strong className="metric-value">{selectedTask?.targetDurationSec ?? "--"}s</strong>
            </div>
            <div className="asset-metric-card">
              <div className="metric-label">实际时长</div>
              <strong className="metric-value">{selectedTask?.actualDurationSec ? `${selectedTask.actualDurationSec.toFixed(1)}s` : "--"}</strong>
            </div>
            <div className="asset-metric-card">
              <div className="metric-label">偏差</div>
              <strong className="metric-value">{durationDeltaLabel}</strong>
            </div>
            <div className="asset-metric-card">
              <div className="metric-label">容差判断</div>
              <strong className="metric-value">{toleranceLabel}</strong>
            </div>
            <div className="asset-metric-card">
              <div className="metric-label">交付就绪度</div>
              <strong className="metric-value">{assetStats.deliverableReadyCount}/{assetStats.deliverableTotal || 0}</strong>
            </div>
            <div className="asset-metric-card">
              <div className="metric-label">当前流程</div>
              <strong className="metric-value">{getTaskFlowLabel(selectedTask)}</strong>
            </div>
          </div>

          {assetStats.missingCount ? (
            <div className="asset-missing-notice">
              {assetStats.missingCount} 个记录指向的文件当前不可访问，列表仍保留记录方便排查历史任务。
            </div>
          ) : null}
          {assetDeleteLocked ? (
            <div className="asset-missing-notice">
              {assetDeleteLockLabel}。只有任务待审阅、失败、完成或终止后，才能清理该任务的素材文件。
            </div>
          ) : null}
          {selectedTask ? (
            <section className="danger-zone asset-danger-zone">
              <div>
                <strong>清理与删除</strong>
                <span>
                  只处理当前任务「{selectedTask.title}」。清空素材会删除该任务自己的文件和记录；删除任务会同时删除任务记录、素材、排查记录和时间线。
                </span>
                {assetDeleteLocked ? <span>{assetDeleteLockLabel}。</span> : <span>删除前请确认发布文件已经不再需要，操作无法从页面里恢复。</span>}
              </div>
              <div className="danger-zone__actions">
                <button
                  className="ghost-button danger-button"
                  disabled={assetDeleteLocked || deletingTaskAssets || deletingTask}
                  onClick={() => void handleDeleteTaskAssets()}
                  title={assetDeleteLocked ? assetDeleteLockLabel : undefined}
                  type="button"
                >
                  {assetDeleteLocked ? "素材清理已锁定" : deletingTaskAssets ? "清理中..." : "清空当前任务素材"}
                </button>
                <button
                  className="ghost-button danger-button"
                  disabled={assetDeleteLocked || deletingTaskAssets || deletingTask}
                  onClick={() => void handleDeleteTask()}
                  title={assetDeleteLocked ? assetDeleteLockLabel : undefined}
                  type="button"
                >
                  {assetDeleteLocked ? "任务删除已锁定" : deletingTask ? "删除中..." : "删除当前任务"}
                </button>
              </div>
            </section>
          ) : null}

          {previewAsset ? (
            <section className="planning-summary-card">
              <div className="section-header">
                <div>
                  <strong>页内预览</strong>
                  <div className="muted">{normalizeOperatorCopy(previewAsset.label)} · {previewAsset.fileName}</div>
                </div>
                <button
                  className="ghost-button"
                  onClick={() => {
                    setPreviewAsset(null)
                    setPreviewText("")
                    setPreviewError("")
                    setPreviewLoading(false)
                  }}
                  type="button"
                >
                  关闭预览
                </button>
              </div>
              {previewLoading ? <div className="muted">正在加载预览...</div> : null}
              {previewError ? <div className="review-inline-note review-inline-note--danger">{previewError}</div> : null}
              {!previewLoading && !previewError && (previewAsset.previewKind === "text" || previewAsset.previewKind === "json") ? (
                <pre className="review-content" style={{ whiteSpace: "pre-wrap", maxHeight: 420, overflow: "auto" }}>{previewText}</pre>
              ) : null}
              {!previewLoading && !previewError && previewAsset.mimeType.startsWith("image/") ? (
                <img
                  alt={normalizeOperatorCopy(previewAsset.label)}
                  className="visual-preview__image"
                  src={buildAssetPreviewUrl(previewAsset.taskId, previewAsset.id)}
                />
              ) : null}
              {!previewLoading && !previewError && previewAsset.mimeType.startsWith("video/") ? (
                <video
                  controls
                  className="visual-preview__image"
                  src={buildAssetPreviewUrl(previewAsset.taskId, previewAsset.id)}
                />
              ) : null}
              {!previewLoading && !previewError && previewAsset.mimeType.startsWith("audio/") ? (
                <audio
                  controls
                  style={{ width: "100%" }}
                  src={buildAssetPreviewUrl(previewAsset.taskId, previewAsset.id)}
                />
              ) : null}
            </section>
          ) : null}

          {renderAssetList("发布文件", "优先确认成片、字幕、脚本和音频是否已经齐全。", deliverableAssets)}
          {renderAssetList("排查文件", "用于查看生成过程和中间结果，不要和最终发布文件混在一起判断。", supportingAssets)}
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>系统状态</h3>
            <div className="task-list compact-list">
              <div className="task-item">
                <strong>后台接口</strong>
                <span>{runtime?.api.status ?? "unknown"} · {normalizeOperatorCopy(runtime?.api.message) || "N/A"}</span>
              </div>
              <div className="task-item">
                <strong>生成服务</strong>
                <span>{runtime?.worker.status ?? "unknown"} · {normalizeOperatorCopy(runtime?.worker.message) || "N/A"}</span>
              </div>
              <div className="task-item">
                <strong>排队服务</strong>
                <span>{runtime?.redis.status ?? "unknown"} · {normalizeOperatorCopy(runtime?.redis.message) || "N/A"}</span>
              </div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>当前处理入口</h3>
            <div className="task-list compact-list">
              <div className="task-item">
                <strong>{getTaskFlowLabel(selectedTask)}</strong>
                <span>素材排查完成后，直接回到当前任务真正需要处理的页面。</span>
                <div className="task-item__actions">
                  {selectedTaskId && canCancelTask(selectedTask) ? (
                    <button
                      className="ghost-button"
                      disabled={cancelingTaskId === selectedTaskId}
                      onClick={() => void handleCancelTask(selectedTaskId)}
                      type="button"
                    >
                      {cancelingTaskId === selectedTaskId ? "终止中..." : "终止任务"}
                    </button>
                  ) : null}
                  {selectedTaskId && canResumeTask(selectedTask, diagnostics, diagnosticsError) ? (
                    <button
                      className="ghost-button"
                      disabled={resumingTaskId === selectedTaskId}
                      onClick={() => void handleResumeFailedTask(selectedTaskId)}
                      type="button"
                    >
                      {resumingTaskId === selectedTaskId
                        ? "恢复中..."
                        : diagnostics?.recoveryReason === "stale_running_task" || isStaleRunningTask(selectedTask)
                          ? "恢复卡住任务"
                          : "恢复生成"}
                    </button>
                  ) : null}
                  {selectedTask?.executionMode === "review_required" &&
                  (selectedTask.blueprintStatus === "ready_for_review" ||
                    selectedTask.blueprintStatus === "approved" ||
                    selectedTask.blueprintStatus === "rejected") ? (
                    <Link className="primary-button" to={buildTaskReviewUrl(selectedTask)}>
                      进入任务审核
                    </Link>
                  ) : (
                    <Link className="primary-button" to={buildBatchDashboardUrl(selectedTaskId || undefined)}>
                      返回生产看板
                    </Link>
                  )}
                  <Link className="ghost-button" to={buildBatchDashboardUrl(selectedTaskId || undefined)}>
                    打开任务在看板中的位置
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>任务诊断</h3>
            <div className="task-list compact-list">
              <div className="task-item">
                <strong>{diagnostics?.operatorMessage ?? (diagnosticsError || "等待诊断同步")}</strong>
                <span>系统会结合最近进展、排队情况和素材产出判断是否真的卡住。</span>
              </div>
              <div className="task-item">
                <strong>当前阶段</strong>
                <span>{diagnostics?.runtimeTrace.currentStageLabel ?? selectedTask?.currentStageLabel ?? getTaskFlowLabel(selectedTask)}</span>
              </div>
              <div className="task-item">
                <strong>分段进度</strong>
                <span>
                  {diagnostics?.runtimeTrace.currentSceneTotal
                    ? `${(diagnostics.runtimeTrace.currentSceneIndex ?? 0) + 1}/${diagnostics.runtimeTrace.currentSceneTotal}`
                    : "暂无分段进度"}
                </span>
              </div>
              <div className="task-item">
                <strong>最近进展</strong>
                <span>{heartbeatAgeLabel}</span>
              </div>
              <div className="task-item">
                <strong>排队状态</strong>
                <span>
                  {!diagnostics
                    ? diagnosticsError || "诊断加载中"
                    : diagnostics.queue.available
                      ? `处理中 ${diagnostics.queue.activeJobIds.length} · 等待中 ${diagnostics.queue.waitingJobIds.length} · 延后 ${diagnostics.queue.delayedJobIds.length} · 失败 ${diagnostics.queue.failedJobIds.length}`
                      : `不可用 · ${diagnostics.queue.unavailableReason ?? "无法连接排队服务"}`}
                </span>
              </div>
              <div className="task-item">
                <strong>下一步缺口</strong>
                <span>{diagnostics ? getAssetTypeLabel(diagnostics.assets.expectedNextAssetType) : "等待诊断同步"}</span>
              </div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>任务时间线</h3>
            <div className="task-list compact-list">
              {recentTimeline.length ? (
                recentTimeline.map((event) => (
                  <div className="task-item" key={event.id}>
                    <strong>{event.label}</strong>
                    <span>
                      {formatTimelineTime(event.createdAt)}
                      {" · "}
                      {event.level === "error" ? "错误" : event.level === "warning" ? "提醒" : "阶段"}
                      {event.reason ? ` · ${event.reason}` : ""}
                    </span>
                  </div>
                ))
              ) : (
                <div className="task-item">
                  <strong>当前暂无记录</strong>
                  <span>生成服务进入下一阶段后，这里会记录关键过程和失败原因。</span>
                </div>
              )}
            </div>
          </section>

          <section className="card card--compact">
            <h3>生成依据</h3>
            <div className="task-list compact-list">
              {selectedTask?.status === "failed" && selectedTask?.failureReason ? (
                <div className="task-item"><strong>失败原因</strong><span>{selectedTask.failureReason}</span></div>
              ) : null}
              {selectedTask?.status === "failed" && formatFailureModelRoute(selectedTask) ? (
                <div className="task-item"><strong>失败时使用的模型</strong><span>{formatFailureModelRoute(selectedTask)}</span></div>
              ) : null}
              <div className="task-item"><strong>视频结构依据</strong><span>{selectedTask?.routeReason ?? "待同步"}</span></div>
              <div className="task-item"><strong>生成原则</strong><span>{selectedTask?.planning?.generationPreferenceLabel ?? "待同步"}</span></div>
              <div className="task-item"><strong>音频策略</strong><span>{getAudioStrategyLabel(selectedTask?.audioStrategy)}</span></div>
              <div className="task-item"><strong>当前流程</strong><span>{getTaskFlowLabel(selectedTask)}</span></div>
              <div className="task-item"><strong>可预览素材</strong><span>{assetStats.previewableCount} 个</span></div>
              <div className="task-item"><strong>已就绪文件</strong><span>{assetStats.readyCount} 个</span></div>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
