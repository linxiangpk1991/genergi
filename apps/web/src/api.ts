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
export type AudioStrategy = "tts_only" | "native_plus_tts_ducked"

export type GenerationRouteId = "single_shot" | "multi_scene"

export type ReviewStageId = "storyboard_review" | "keyframe_review" | "auto_qa"
export type ExecutionMode = "automated" | "review_required"
export type TerminalPresetId =
  | "phone_portrait"
  | "phone_landscape"
  | "tablet_portrait"
  | "tablet_landscape"
export type BlueprintStatus =
  | "pending_generation"
  | "ready_for_review"
  | "rejected"
  | "approved"
  | "queued_for_video"
  | "video_generating"
  | "completed"

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
}

export type RenderSpec = {
  terminalPresetId: TerminalPresetId
  width: number
  height: number
  aspectRatio: string
  safeArea: {
    topPct: number
    rightPct: number
    bottomPct: number
    leftPct: number
  }
  compositionGuideline: string
  motionGuideline: string
}

export type ProjectRecord = {
  id: string
  name: string
  description?: string | null
  brandDirection?: string | null
  defaultChannelIds: string[]
  reusableStyleConstraints: string[]
  createdAt: string
  updatedAt: string
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
  projectId: string
  title: string
  modeId: string
  executionMode: ExecutionMode
  channelId: string
  terminalPresetId: TerminalPresetId
  renderSpecJson: RenderSpec
  targetDurationSec: number
  generationMode: GenerationPreferenceId
  audioStrategy: "tts_only" | "native_plus_tts_ducked"
  generationRoute: GenerationRouteId
  routeReason: string
  planningVersion: string
  blueprintVersion: number
  blueprintStatus: BlueprintStatus
  actualDurationSec: number | null
  failureReason?: string | null
  statusDetail?: string | null
  cancelRequestedAt?: string | null
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
  sceneGoal?: string
  voiceoverScript?: string
  startFrameDescription?: string
  script: string
  imagePrompt: string
  videoPrompt: string
  startFrameIntent?: string
  endFrameIntent?: string
  durationSec: number
  startLabel: string
  endLabel: string
  reviewStatus: "pending" | "approved" | "rejected"
  keyframeStatus: "pending" | "approved" | "rejected"
  continuityConstraints?: string[]
  reviewNote?: string
  reviewedAt?: string
  keyframeReviewNote?: string
  keyframeReviewedAt?: string
}

export type TaskDetail = {
  taskId: string
  projectId: string
  title: string
  script: string
  blueprintVersion: number
  blueprintStatus: BlueprintStatus
  failureReason?: string | null
  statusDetail?: string | null
  cancelRequestedAt?: string | null
  taskRunConfig: {
    projectId: string
    modeId: string
    executionMode: ExecutionMode
    channelId: string
    terminalPresetId: TerminalPresetId
    renderSpecJson: RenderSpec
    targetDurationSec: number
    generationMode: GenerationPreferenceId
    audioStrategy: "tts_only" | "native_plus_tts_ducked"
    generationRoute: GenerationRouteId
    routeReason: string
    planningVersion: string
    blueprintVersion: number
    blueprintStatus: BlueprintStatus
    textModel: {
      id: string
      label: string
      provider: string
    }
    imageModel: {
      id: string
      label: string
      provider: string
    }
    videoModel: {
      id: string
      label: string
      provider: string
    }
    ttsProvider: string
    contentLocale: "en"
    operatorLocale: "zh-CN"
    requireStoryboardReview: boolean
    requireKeyframeReview: boolean
    budgetLimitCny: number
    aspectRatio: string
    slotSnapshots: Array<Record<string, unknown>>
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

export type TaskCancelResponse = {
  task: TaskSummary
  detail: TaskDetail
  queue: {
    removedJobIds: string[]
    hadActiveJob: boolean
  }
}

export type TaskResumeResponse = {
  task: TaskSummary
  detail: TaskDetail
  queue: {
    queued: boolean
    reason: string
    continueExecution: boolean
    blueprintVersion?: number | null
    stage?: string | null
    resumeFrom?: string | null
  }
}

export type AssetRecord = {
  id: string
  taskId: string
  assetType:
    | "script"
    | "source_script"
    | "planning_prompt"
    | "planning_response"
    | "planning_audit"
    | "storyboard"
    | "subtitles"
    | "audio"
    | "keyframe_bundle"
    | "keyframe_image"
    | "video_bundle"
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

export type PlannedExecutionBlueprint = {
  executionMode: ExecutionMode
  renderSpec: RenderSpec
  globalTheme: string
  visualStyleGuide: string
  subjectProfile: string
  productProfile: string
  backgroundConstraints: string[]
  negativeConstraints: string[]
  totalVoiceoverScript: string
  sceneContracts: Array<{
    id: string
    index: number
    sceneGoal: string
    voiceoverScript: string
    startFrameDescription: string
    imagePrompt: string
    videoPrompt: string
    startFrameIntent: string
    endFrameIntent: string
    durationSec: number
    transitionHint: string
    continuityConstraints: string[]
  }>
}

export type TaskBlueprintRecord = {
  taskId: string
  version: number
  status: BlueprintStatus
  createdAt: string
  updatedAt: string
  blueprint: PlannedExecutionBlueprint & {
    taskId: string
    projectId: string
    version: number
    createdAt: string
  }
  keyframeManifestPath?: string | null
}

export type TaskBlueprintReviewRecord = {
  taskId: string
  blueprintVersion: number
  decision: ReviewDecision
  note?: string | null
  decidedAt: string
}

export type ProjectApprovedBlueprintRecord = {
  projectId: string
  taskId: string
  blueprintVersion: number
  approvedAt: string
  blueprint: TaskBlueprintRecord["blueprint"]
}

export type BlueprintCurrentResponse = {
  blueprint: TaskBlueprintRecord
  review: TaskBlueprintReviewRecord | null
  nextStage: {
    canResumeExecution: boolean
    resumePath: string | null
  }
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

export function buildBatchDashboardUrl(taskId?: string) {
  return buildWorkspaceUrl("/batch-dashboard", { taskId })
}

export function buildAssetCenterUrl(taskId?: string) {
  return buildWorkspaceUrl("/asset-center", { taskId })
}

export function buildTaskReviewUrl(
  task: Pick<TaskSummary, "id" | "executionMode" | "blueprintStatus">,
) {
  if (
    task.executionMode === "review_required" &&
    (task.blueprintStatus === "ready_for_review" ||
      task.blueprintStatus === "approved" ||
      task.blueprintStatus === "rejected")
  ) {
    return buildWorkspaceUrl("/task-review", { taskId: task.id })
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
  projectId: string
  title: string
  script: string
  terminalPresetId: TerminalPresetId
  targetDurationSec: number
  audioStrategy: AudioStrategy
}

export function getAudioStrategyLabel(strategy: AudioStrategy | null | undefined) {
  return strategy === "native_plus_tts_ducked" ? "原生音频 + TTS 混音" : "TTS 主导"
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
  listProjects: () => request<{ projects: ProjectRecord[] }>("/api/projects"),
  getProjectLibrary: (projectId: string) =>
    request<{ entries: ProjectApprovedBlueprintRecord[] }>(`/api/projects/${projectId}/library`),
  listTasks: () => request<{ tasks: TaskSummary[] }>("/api/tasks"),
  getTaskDetail: (taskId: string) => request<{ detail: TaskDetail }>(`/api/tasks/${taskId}`),
  getTaskBlueprints: (taskId: string) => request<{ blueprints: TaskBlueprintRecord[] }>(`/api/tasks/${taskId}/blueprints`),
  getTaskCurrentBlueprint: (taskId: string) =>
    request<BlueprintCurrentResponse>(`/api/tasks/${taskId}/blueprints/current`),
  createTaskBlueprint: (taskId: string, payload: {
    blueprint: PlannedExecutionBlueprint
    keyframeManifestPath?: string
  }) =>
    request<BlueprintCurrentResponse>(`/api/tasks/${taskId}/blueprints`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  reviewTaskBlueprint: (taskId: string, version: number, payload: ReviewDecisionPayload) =>
    request<{
      blueprint: TaskBlueprintRecord
      review: TaskBlueprintReviewRecord
      projectLibraryEntry: ProjectApprovedBlueprintRecord | null
      nextStage: {
        canResumeExecution: boolean
        resumePath: string | null
      }
    }>(`/api/tasks/${taskId}/blueprints/${version}/review`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  resumeCurrentBlueprint: (taskId: string) =>
    request<{
      blueprint: TaskBlueprintRecord
      queue: {
        queued: boolean
        reason: string
        continueExecution: boolean
      }
      nextStage: {
        canResumeExecution: boolean
        resumePath: string | null
      }
    }>(`/api/tasks/${taskId}/blueprints/current/resume`, {
      method: "POST",
    }),
  getTaskAssets: (taskId: string) => request<{ assets: AssetRecord[] }>(`/api/tasks/${taskId}/assets`),
  cancelTask: (taskId: string) =>
    request<TaskCancelResponse>(`/api/tasks/${taskId}/cancel`, {
      method: "POST",
    }),
  resumeFailedTask: (taskId: string) =>
    request<TaskResumeResponse>(`/api/tasks/${taskId}/resume`, {
      method: "POST",
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
