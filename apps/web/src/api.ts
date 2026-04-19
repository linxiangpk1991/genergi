export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ""

type ApiErrorBody = {
  message?: string
  reason?: string
  detail?: string
  error?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    let detail = `Request failed: ${response.status}`

    try {
      const errorBody = (await response.json()) as ApiErrorBody
      detail =
        errorBody.reason ??
        errorBody.message ??
        errorBody.detail ??
        errorBody.error ??
        detail
    } catch {
      detail = response.statusText || detail
    }

    throw new Error(detail)
  }

  return (await response.json()) as T
}

function buildWorkspaceUrl(pathname: string, params: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value)
    }
  })

  const search = searchParams.toString()
  return search ? `${pathname}?${search}` : pathname
}

function buildApiUrl(pathname: string, params: Record<string, string | undefined>) {
  return buildWorkspaceUrl(pathname, params)
}

export type HealthResponse = {
  status: string
  service: string
  version: string
}

export type GenerationPreferenceId = "user_locked" | "system_enhanced"

export type GenerationRouteId = "single_shot" | "multi_scene"

export type ReviewStageId = "storyboard_review" | "keyframe_review" | "auto_qa"

export type ReviewDecision = "approved" | "rejected"

export type ReviewDecisionPayload = {
  decision: ReviewDecision
  note?: string
}

export type TaskPlanningSnapshot = {
  generationMode: GenerationPreferenceId | null
  generationPreferenceLabel: string
  generationRoute: GenerationRouteId
  generationRouteLabel: string
  targetDurationSec: number
  sceneCount: number
  planningSummary: string
  planningKeywords: string[]
  planningSourceLabel: string
}

export type BootstrapResponse = {
  brand: { productName: string; companyName: string; domain: string }
  durationOptions: number[]
  channels: Array<{ id: string; label: string; description: string }>
  modes: Array<{ id: string; label: string; description: string; budgetLimitCny: number; maxSingleShotSec: number }>
  generationPreferences: Array<{
    id: GenerationPreferenceId
    label: string
    description: string
  }>
}

export type SessionResponse = {
  authenticated: boolean
  operator: string | null
  auth: {
    configured: boolean
    localDevFallback: boolean
  }
}

export type UserStatus = "active" | "disabled"

export type UserRecord = {
  id: string
  username: string
  displayName: string
  password?: string
  status: UserStatus
}

export type UsersResponse = {
  users: UserRecord[]
}

export type UserPayload = {
  username: string
  displayName: string
  password?: string
  status: UserStatus
}

export type ResetPasswordPayload = {
  password: string
}

export type RuntimeServiceState = {
  name: string
  status: "healthy" | "degraded"
  updatedAt: string
  message: string
}

export type RuntimeStatusResponse = {
  runtime: {
    api: RuntimeServiceState
    worker: RuntimeServiceState
    redis: RuntimeServiceState
  }
}

export type TaskSummary = {
  id: string
  title: string
  modeId: string
  channelId: string
  targetDurationSec: number
  generationMode: GenerationPreferenceId
  generationRoute: GenerationRouteId
  routeReason: string
  planningVersion: string
  actualDurationSec: number | null
  status: string
  progressPct: number
  retryCount: number
  estimatedCostCny: number
  createdAt: string
  updatedAt: string
  reviewStage?: ReviewStageId | null
  pendingReviewCount?: number
  reviewUpdatedAt?: string | null
  planning?: TaskPlanningSnapshot
}

export type StoryboardScene = {
  id: string
  index: number
  title: string
  script: string
  imagePrompt: string
  videoPrompt: string
  durationSec: number
  startLabel: string
  endLabel: string
  reviewStatus: "pending" | "approved" | "rejected"
  keyframeStatus: "pending" | "approved" | "rejected"
  reviewNote?: string
  reviewedAt?: string
  keyframeReviewNote?: string
  keyframeReviewedAt?: string
}

export type TaskDetail = {
  taskId: string
  title: string
  script: string
  taskRunConfig: {
    modeId: string
    channelId: string
    targetDurationSec: number
    generationMode: GenerationPreferenceId
    generationRoute: GenerationRouteId
    routeReason: string
    planningVersion: string
    imageModel: {
      label: string
    }
  }
  visualStyleGuide?: string
  ctaLine?: string
  actualDurationSec?: number | null
  scenes: StoryboardScene[]
  updatedAt: string
  reviewStage?: ReviewStageId | null
  pendingReviewCount?: number
  reviewUpdatedAt?: string | null
  planning?: TaskPlanningSnapshot
}

export type ReviewMutationResponse = {
  task: TaskSummary
  detail: TaskDetail
}

export type AssetRecord = {
  id: string
  taskId: string
  assetType: "script" | "storyboard" | "subtitles" | "audio" | "keyframe_bundle" | "video_bundle"
  label: string
  status: "ready" | "pending"
  path: string
  createdAt: string
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
  previewKind: "text" | "json" | "media" | "directory" | "binary"
  modifiedAt: string | null
  downloadFileName: string
}

export function buildAssetDownloadUrl(taskId: string, assetId: string) {
  return `${API_BASE_URL}/api/tasks/${taskId}/assets/${assetId}/download`
}

export function buildAssetPreviewUrl(taskId: string, assetId: string) {
  return `${API_BASE_URL}/api/tasks/${taskId}/assets/${assetId}/preview`
}

export function buildKeyframePreviewUrl(taskId: string, sceneId: string) {
  return `${API_BASE_URL}/api/tasks/${taskId}/keyframes/${sceneId}/preview`
}

export function buildStoryboardReviewUrl(taskId?: string, sceneId?: string) {
  return buildWorkspaceUrl("/storyboard-review", { taskId, sceneId })
}

export function buildKeyframeReviewUrl(taskId?: string, sceneId?: string) {
  return buildWorkspaceUrl("/keyframe-review", { taskId, sceneId })
}

export function buildBatchDashboardUrl(taskId?: string) {
  return buildWorkspaceUrl("/batch-dashboard", { taskId })
}

export function buildAssetCenterUrl(taskId?: string) {
  return buildWorkspaceUrl("/asset-center", { taskId })
}

export function buildTaskReviewUrl(task: Pick<TaskSummary, "id" | "reviewStage">, sceneId?: string) {
  if (task.reviewStage === "keyframe_review") {
    return buildKeyframeReviewUrl(task.id, sceneId)
  }

  if (task.reviewStage === "storyboard_review") {
    return buildStoryboardReviewUrl(task.id, sceneId)
  }

  return buildAssetCenterUrl(task.id)
}

export const MODEL_CONTROL_SLOT_ORDER = [
  "textModel",
  "imageModel",
  "videoModel",
  "ttsProvider",
] as const

export type ModelControlSlotType = (typeof MODEL_CONTROL_SLOT_ORDER)[number]

export type ModelControlModeId = "mass_production" | "high_quality"

export const MODEL_CONTROL_SLOT_LABELS: Record<ModelControlSlotType, string> = {
  textModel: "文案规划",
  imageModel: "图片模型",
  videoModel: "视频模型",
  ttsProvider: "TTS 配音",
}

export const MODEL_CONTROL_MODE_LABELS: Record<ModelControlModeId, string> = {
  mass_production: "量产模式",
  high_quality: "高质量模式",
}

export type ModelControlLifecycleStatus =
  | "draft"
  | "validating"
  | "available"
  | "invalid"
  | "disabled"
  | "deprecated"

export type ProviderAuthType = "bearer_token" | "api_key_header" | "none" | string

export type ProviderRegistryRecord = {
  id: string
  providerKey: string
  providerType: string
  displayName: string
  endpointUrl: string
  authType: ProviderAuthType
  status: ModelControlLifecycleStatus
  hasSecret?: boolean
  maskedSecret?: string | null
  lastValidatedAt?: string | null
  lastValidationError?: string | null
  createdAt?: string
  updatedAt?: string
}

export type ModelRegistryRecord = {
  id: string
  modelKey: string
  providerId: string
  providerDisplayName?: string | null
  slotType: ModelControlSlotType
  providerModelId: string
  displayName: string
  lifecycleStatus: ModelControlLifecycleStatus
  capabilityJson: Record<string, unknown>
  lastValidatedAt?: string | null
  lastValidationError?: string | null
  createdAt?: string
  updatedAt?: string
}

export type ModelControlSelection = {
  recordId: string | null
  displayName?: string | null
  providerDisplayName?: string | null
}

export type ModelControlDefaults = {
  global: Partial<Record<ModelControlSlotType, ModelControlSelection | null>>
  modes: Partial<Record<ModelControlModeId, Partial<Record<ModelControlSlotType, ModelControlSelection | null>>>>
}

export type SelectableModelOption = {
  recordId: string
  displayName: string
  providerDisplayName?: string | null
  providerId?: string
  slotType: ModelControlSlotType
  capabilityJson?: Record<string, unknown>
  description?: string | null
}

export type SelectableSlotPool = {
  slotType: ModelControlSlotType
  options: SelectableModelOption[]
  globalDefaultId?: string | null
  modeDefaultId?: string | null
  effectiveId?: string | null
}

export type SelectableModelPoolsResponse = {
  modeId: ModelControlModeId
  pools: Record<ModelControlSlotType, SelectableSlotPool>
}

export type CreateModelProviderPayload = {
  providerKey: string
  providerType: string
  displayName: string
  endpointUrl: string
  authType: ProviderAuthType
  secret?: string
  status?: ModelControlLifecycleStatus
}

export type UpdateModelProviderPayload = Partial<CreateModelProviderPayload>

export type CreateModelRegistryEntryPayload = {
  modelKey: string
  providerId: string
  slotType: ModelControlSlotType
  providerModelId: string
  displayName: string
  capabilityJson: Record<string, unknown>
  lifecycleStatus?: ModelControlLifecycleStatus
}

export type UpdateModelRegistryEntryPayload = Partial<CreateModelRegistryEntryPayload>

export type UpdateModelDefaultsPayload = {
  assignments: Partial<Record<ModelControlSlotType, string | null>>
}

export type CreateTaskPayload = {
  title: string
  script: string
  modeId: string
  channelId: string
  aspectRatio: string
  targetDurationSec: number
  generationMode?: GenerationPreferenceId
  modelOverrides?: Partial<Record<ModelControlSlotType, { modelId?: string; providerId?: string }>>
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  session: () => request<SessionResponse>("/api/auth/session"),
  runtimeStatus: () => request<RuntimeStatusResponse>("/api/system/status"),
  login: (payload: { username: string; password: string }) =>
    request<{ authenticated: boolean; operator: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  logout: () =>
    request<{ authenticated: boolean }>("/api/auth/logout", {
      method: "POST",
    }),
  bootstrap: () => request<BootstrapResponse>("/api/bootstrap"),
  listUsers: () => request<UsersResponse>("/api/users"),
  createUser: (payload: UserPayload) =>
    request<{ user: UserRecord }>("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateUser: (userId: string, payload: Partial<UserPayload>) =>
    request<{ user: UserRecord }>(`/api/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  resetUserPassword: (userId: string, payload: ResetPasswordPayload) =>
    request<{ user: UserRecord }>(`/api/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listTasks: () => request<{ tasks: TaskSummary[] }>("/api/tasks"),
  getTaskDetail: (taskId: string) => request<{ detail: TaskDetail }>(`/api/tasks/${taskId}`),
  getTaskAssets: (taskId: string) => request<{ assets: AssetRecord[] }>(`/api/tasks/${taskId}/assets`),
  submitStoryboardReview: (taskId: string, sceneId: string, payload: ReviewDecisionPayload) =>
    request<ReviewMutationResponse>(`/api/tasks/${taskId}/reviews/storyboard_review/${sceneId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  submitKeyframeReview: (taskId: string, sceneId: string, payload: ReviewDecisionPayload) =>
    request<ReviewMutationResponse>(`/api/tasks/${taskId}/reviews/keyframe_review/${sceneId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createTask: (payload: CreateTaskPayload) =>
    request<{ task: TaskSummary }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listModelProviders: () => request<{ providers: ProviderRegistryRecord[] }>("/api/model-control/providers"),
  createModelProvider: (payload: CreateModelProviderPayload) =>
    request<{ provider: ProviderRegistryRecord }>("/api/model-control/providers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateModelProvider: (providerId: string, payload: UpdateModelProviderPayload) =>
    request<{ provider: ProviderRegistryRecord }>(`/api/model-control/providers/${providerId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  validateModelProvider: (providerId: string) =>
    request<{ provider: ProviderRegistryRecord }>(`/api/model-control/validation/providers/${providerId}`, {
      method: "POST",
    }),
  listModelRegistry: () => request<{ models: ModelRegistryRecord[] }>("/api/model-control/models"),
  createModelRegistryEntry: (payload: CreateModelRegistryEntryPayload) =>
    request<{ model: ModelRegistryRecord }>("/api/model-control/models", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateModelRegistryEntry: (modelId: string, payload: UpdateModelRegistryEntryPayload) =>
    request<{ model: ModelRegistryRecord }>(`/api/model-control/models/${modelId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  validateModelRegistryEntry: (modelId: string) =>
    request<{ model: ModelRegistryRecord }>(`/api/model-control/validation/models/${modelId}`, {
      method: "POST",
    }),
  getModelDefaults: () => request<ModelControlDefaults>("/api/model-control/defaults"),
  updateGlobalModelDefaults: (payload: UpdateModelDefaultsPayload) =>
    request<ModelControlDefaults>("/api/model-control/defaults/global", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  updateModeModelDefaults: (modeId: ModelControlModeId, payload: UpdateModelDefaultsPayload) =>
    request<ModelControlDefaults>(`/api/model-control/defaults/modes/${modeId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  getSelectableModelPools: (modeId: ModelControlModeId) =>
    request<SelectableModelPoolsResponse>(buildApiUrl("/api/model-control/selectable", { modeId })),
}
