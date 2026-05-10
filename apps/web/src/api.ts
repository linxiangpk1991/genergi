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
export type SubtitleStrategy = "tts_aligned" | "whisper_cpp"
export type KeyframeGenerationMode = "batch" | "single"

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
  qualityReasons?: Array<{
    slotType?: ModelControlSlotType | null
    issueCategory: QualityIssueCategory
    note?: string
  }>
}

export type QualityIssueCategory =
  | "script_off_track"
  | "image_inconsistent"
  | "character_unstable"
  | "low_image_quality"
  | "poor_motion"
  | "subtitle_issue"
  | "voice_issue"
  | "other"

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

export type TaskTimelineEvent = {
  id: string
  taskId: string
  sequence: number
  type: "stage" | "provider" | "error"
  stage: string
  label: string
  level: "info" | "warning" | "error"
  summary?: string | null
  reason?: string | null
  provider?: {
    provider?: string | null
    model?: string | null
    request?: Record<string, unknown>
    response?: Record<string, unknown>
    error?: string | null
  } | null
  metadata?: Record<string, unknown>
  createdAt: string
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
  defaultVisualSeedInput?: string | null
  defaultKeyframeGenerationMode?: KeyframeGenerationMode
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
  source?: "file" | "env"
  purpose?: "operator" | "test_operator"
  expiresAt?: string | null
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

export type TaskModelRef = {
  id: string
  label: string
  provider: string
}

export type TaskModelUsage = {
  textModel?: TaskModelRef | null
  imageModel?: TaskModelRef | null
  videoModel?: TaskModelRef | null
  ttsProvider?: string | null
}

export type TaskModelTraceEntry = {
  slotType: ModelControlSlotType
  stage?: ModelControlSlotType
  label: string
  providerId?: string
  providerKey?: string
  providerType: string
  modelId?: string
  modelKey?: string
  providerModelId: string
  wireApi: string
  requestPath: string
  transport?: string
  smokeProbe?: string
  validatedAt?: string | null
  selectionReason?: string
  routingStrategy?: ModelRoutingStrategy
  routingPolicyNote?: string
  fallbackCandidates?: Array<{
    displayName: string
    providerType: string
    providerModelId: string
    fallbackTriggers?: ModelFallbackTrigger[]
  }>
}

export type TaskModelTrace = Partial<Record<ModelControlSlotType, TaskModelTraceEntry>>

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
  visualSeedInput?: string | null
  keepCharacterConsistent?: boolean
  keyframeGenerationMode?: KeyframeGenerationMode
  keyframeCount?: number
  understandingPreview?: BilingualUnderstandingPreview | null
  executionBrief?: EnglishExecutionBrief | null
  executionBriefVersion?: "execution-brief-v1"
  audioStrategy: "tts_only" | "native_plus_tts_ducked"
  subtitleStrategy: SubtitleStrategy
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
  currentStage?: string | null
  currentStageLabel?: string | null
  currentSceneIndex?: number | null
  currentSceneTotal?: number | null
  stageStartedAt?: string | null
  lastHeartbeatAt?: string | null
  workerId?: string | null
  activeJobId?: string | null
  modelUsage?: TaskModelUsage | null
  modelTrace?: TaskModelTrace | null
  planning?: TaskPlanningSnapshot
  archivedAt?: string | null
  archivedBy?: string | null
  archiveReason?: string | null
  archiveOperationId?: string | null
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
    visualSeedInput?: string | null
    keepCharacterConsistent?: boolean
    keyframeGenerationMode?: KeyframeGenerationMode
    keyframeCount?: number
    understandingPreview?: BilingualUnderstandingPreview | null
    executionBrief?: EnglishExecutionBrief | null
    executionBriefVersion?: "execution-brief-v1"
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
  modelTrace?: TaskModelTrace | null
  visualStyleGuide?: string
  ctaLine?: string
  actualDurationSec?: number | null
  scenes: StoryboardScene[]
  updatedAt: string
  reviewStage?: ReviewStageId | null
  pendingReviewCount?: number
  reviewUpdatedAt?: string | null
  currentStage?: string | null
  currentStageLabel?: string | null
  currentSceneIndex?: number | null
  currentSceneTotal?: number | null
  stageStartedAt?: string | null
  lastHeartbeatAt?: string | null
  workerId?: string | null
  activeJobId?: string | null
  planning?: TaskPlanningSnapshot
  archivedAt?: string | null
  archivedBy?: string | null
  archiveReason?: string | null
  archiveOperationId?: string | null
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

export type TaskBulkPreviewResponse = {
  operation: TaskBulkOperation
  summary: {
    total: number
    allowed: number
    blocked: number
  }
  items: TaskBulkPreviewItem[]
}

export type TaskBulkResultItem = TaskBulkPreviewItem & {
  result: "success" | "skipped" | "failed"
  message: string
  task?: TaskSummary | null
}

export type TaskBulkResultResponse = {
  operationId: string
  operation: TaskBulkOperation
  status: "completed" | "partially_completed"
  summary: {
    total: number
    success: number
    skipped: number
    failed: number
  }
  items: TaskBulkResultItem[]
}

export type TaskDiagnostics = {
  taskId: string
  recoverable: boolean
  recoveryReason: "failed_task" | "stale_running_task" | "not_recoverable"
  stale: {
    isStale: boolean
    thresholdMs: number
    ageMs: number | null
    sourceUpdatedAt: string | null
  }
  queue: {
    available: boolean
    activeJobIds: string[]
    waitingJobIds: string[]
    delayedJobIds: string[]
    prioritizedJobIds: string[]
    pausedJobIds: string[]
    failedJobIds: string[]
    unavailableReason?: string
  }
  runtimeTrace: {
    currentStage: string | null
    currentStageLabel: string | null
    currentSceneIndex: number | null
    currentSceneTotal: number | null
    stageStartedAt: string | null
    lastHeartbeatAt: string | null
    workerId: string | null
    activeJobId: string | null
  }
  assets: {
    readyCount: number
    missingCount: number
    deliverableReadyCount: number
    deliverableTotal: number
    expectedNextAssetType: string | null
  }
  operatorMessage: string
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
    recoveredJobIds?: string[]
    activeJobIds?: string[]
  }
  diagnostics?: TaskDiagnostics
}

export type TaskAudioStrategyResponse = {
  task: TaskSummary
  detail: TaskDetail
}

export type RetryRequestScope = "task" | "scene" | "keyframe" | "video"
export type RetryRequestStatus = "pending" | "accepted" | "enqueue_failed" | "rejected"

export type RetryRequest = {
  id: string
  taskId: string
  scope: RetryRequestScope
  sceneId: string | null
  sceneIndex: number | null
  sceneTitle: string | null
  reason: string | null
  status: RetryRequestStatus
  statusDetail: string | null
  taskStatusAtRequest: string
  queue: {
    queued: boolean
    jobId: string | null
    reason: string
    continueExecution: boolean
    blueprintVersion: number | null
    stage: string | null
    resumeFrom: string | null
  } | null
  createdAt: string
  updatedAt: string
}

export type TaskRetryResponse = {
  retryRequest: RetryRequest | null
  task: TaskSummary
  detail: TaskDetail
  queue: TaskResumeResponse["queue"]
}

export type TaskDeliveryResponse = {
  delivery: Record<string, unknown>
}

export type ProductionScheduleResponse = {
  schedule: {
    generatedAt: string
    lanes: Record<string, number>
    items: Array<Record<string, unknown>>
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
    | "visual_plan"
    | "keyframe_prompt_summary"
    | "storyboard"
    | "subtitles"
    | "audio"
    | "keyframe_bundle"
    | "keyframe_image"
    | "scene_video"
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
  modelTrace?: TaskModelTraceEntry | null
}

export type PlannedExecutionBlueprint = {
  executionMode: ExecutionMode
  renderSpec: RenderSpec
  globalTheme: string
  visualStyleGuide: string
  bilingualUnderstandingPreview?: BilingualUnderstandingPreview | null
  englishExecutionBrief?: EnglishExecutionBrief | null
  subjectProfile: string
  productProfile: string
  backgroundConstraints: string[]
  negativeConstraints: string[]
  visualPlan?: {
    sourceBrief?: string | null
    keyframeCount: number
    generationMode: KeyframeGenerationMode
    characterConsistency: boolean
    subjectProfile: string
    setting: string
    style: string
    mood: string
    negativePrompt: string
    continuityRules: string[]
  } | null
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
  qualityFeedback?: Array<{
    taskId: string
    blueprintVersion: number
    slotType: ModelControlSlotType | null
    issueCategory: QualityIssueCategory
    reasonLabel: string
    note?: string | null
    operator: string
    createdAt: string
  }>
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

export function buildDeliveryManifestUrl(taskId: string) {
  return `${API_BASE_URL}/api/tasks/${taskId}/delivery/manifest`
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
  if (task.executionMode === "review_required") {
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
export type ModelRoutingStrategy = "balanced" | "quality_first" | "speed_first" | "cost_first"
export type ModelFallbackTrigger = "timeout" | "rate_limit" | "provider_error" | "empty_result" | "invalid_response"

export const MODEL_CONTROL_SLOT_LABELS: Record<ModelControlSlotType, string> = {
  textModel: "文案规划",
  imageModel: "图片模型",
  videoModel: "视频模型",
  ttsProvider: "系统配音",
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
  secretConfigured?: boolean
  secretPreview?: string | null
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
  providerType?: string | null
  slotType: ModelControlSlotType
  providerModelId: string
  displayName: string
  lifecycleStatus: ModelControlLifecycleStatus
  capabilityJson: Record<string, unknown>
  routingProfile?: Record<string, unknown>
  selectableReason?: {
    selectable: boolean
    label: string
    detail: string
  }
  lastValidatedAt?: string | null
  lastValidationError?: string | null
  createdAt?: string
  updatedAt?: string
}

export type ModelDiagnosticRecord = {
  id: string
  providerId: string
  providerDisplayName: string
  providerType: string
  modelId: string | null
  modelDisplayName: string | null
  slotType: ModelControlSlotType | null
  providerModelId: string | null
  transport: string
  wireApi: string
  requestPath: string
  smokeMode: "config" | "connectivity" | "minimal_generation"
  status: "success" | "failed" | "skipped"
  statusCode: number | null
  durationMs: number
  errorCategory: string | null
  errorMessage: string | null
  createdAt: string
}

export type ModelQualitySummaryItem = {
  slotType: ModelControlSlotType
  slotLabel: string
  modelId: string
  modelDisplayName: string
  providerModelId: string | null
  providerDisplayName: string | null
  issueCategory: QualityIssueCategory
  reasonLabel: string
  count: number
  latestAt: string
}

export type ModelQualitySummaryResponse = {
  totalCount: number
  items: ModelQualitySummaryItem[]
  updatedAt: string | null
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
  providerType?: string
  providerModelId?: string
  slotType: ModelControlSlotType
  capabilityJson?: Record<string, unknown>
  routingProfile?: Record<string, unknown>
  selectableReason?: {
    selectable: boolean
    label: string
    detail: string
  }
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

export type ModelRoutingSlotPolicy = {
  enabled: boolean
  strategy: ModelRoutingStrategy
  primary: { modelId?: string; providerId?: string } | null
  fallbacks: Array<{ modelId?: string; providerId?: string }>
  fallbackTriggers: ModelFallbackTrigger[]
  operatorNote: string
}

export type ModelRoutingPolicies = {
  global: Record<ModelControlSlotType, ModelRoutingSlotPolicy>
  modes: Record<ModelControlModeId, Record<ModelControlSlotType, ModelRoutingSlotPolicy>>
  updatedAt: string | null
}

export type ModelRoutingSlotResolved = {
  enabled: boolean
  strategy: ModelRoutingStrategy
  strategyLabel: string
  primary: (ModelControlSelection & {
    valueId?: string
    providerType?: string | null
    providerModelId?: string | null
    warning?: string
  }) | null
  fallbacks: Array<ModelControlSelection & {
    valueId?: string
    providerType?: string | null
    providerModelId?: string | null
    warning?: string
  }>
  fallbackTriggers: ModelFallbackTrigger[]
  fallbackTriggerLabels: string[]
  operatorNote: string
  warnings: string[]
  summary: string
}

export type ModelRoutingPoliciesResponse = {
  policies: ModelRoutingPolicies
  resolved: {
    global: Record<ModelControlSlotType, ModelRoutingSlotResolved>
    mass_production: Record<ModelControlSlotType, ModelRoutingSlotResolved>
    high_quality: Record<ModelControlSlotType, ModelRoutingSlotResolved>
  }
  strategyOptions: Array<{ value: ModelRoutingStrategy; label: string }>
  triggerOptions: Array<{ value: ModelFallbackTrigger; label: string }>
  updatedAt: string | null
}

export type ModelRoutePreviewSlot = {
  slotType: ModelControlSlotType
  displayName: string
  provider: string
  wireApi: string
  requestPath: string
  selectionReason: string
  routingStrategy?: ModelRoutingStrategy
  fallbackCandidates: Array<{
    displayName: string
    provider: string
    wireApi: string
    requestPath: string
    fallbackTriggers?: ModelFallbackTrigger[]
  }>
  warnings: string[]
}

export type ModelRoutePreviewResponse = {
  modeId: ModelControlModeId
  summary: string
  slots: ModelRoutePreviewSlot[]
  warnings: string[]
}

export type UpdateModelRoutingPoliciesPayload = {
  global?: Partial<Record<ModelControlSlotType, Partial<ModelRoutingSlotPolicy>>>
  modes?: Partial<Record<ModelControlModeId, Partial<Record<ModelControlSlotType, Partial<ModelRoutingSlotPolicy>>>>>
}

export type BilingualText = {
  zh: string
  en: string
}

export type BilingualUnderstandingPreview = {
  version: "understanding-preview-v1"
  generatedAt: string
  sourceBriefHash: string
  topic: BilingualText
  targetAudience: BilingualText
  corePainPoint: BilingualText
  mainPromise: BilingualText
  conversionGoal: BilingualText
  emotionalArc: BilingualText
  recommendedStructure: BilingualText
  visualBrief: {
    subject: BilingualText
    setting: BilingualText
    style: BilingualText
    mood: BilingualText
    negativeRules: BilingualText[]
    consistencyRules: BilingualText[]
  }
  riskWarnings: Array<{
    severity: "info" | "warning" | "blocking"
    message: BilingualText
    suggestedFix?: BilingualText
  }>
  status: "draft" | "confirmed" | "edited"
}

export type EnglishExecutionBrief = {
  version: "execution-brief-v1"
  sourceBrief: string
  topic: string
  targetAudience: string
  corePainPoint: string
  mainPromise: string
  conversionGoal: string
  emotionalArc: string
  visualBrief: {
    subject: string
    setting: string
    style: string
    mood: string
    negativeRules: string[]
    consistencyRules: string[]
  }
  narrativeStructure: string[]
  keyframePlan: Array<{
    index: number
    timestampRange: string
    narrativeRole: string
    visualGoal: string
    imagePrompt: string
    videoPrompt: string
  }>
  finalPromptLanguage: "en"
}

export type UnderstandingPreviewResponse = {
  understandingPreview: BilingualUnderstandingPreview
  executionBrief: EnglishExecutionBrief
}

export type CreateTaskPayload = {
  projectId: string
  modeId?: ModelControlModeId
  title: string
  script: string
  terminalPresetId: TerminalPresetId
  targetDurationSec: number
  visualSeedInput?: string | null
  keepCharacterConsistent?: boolean
  keyframeGenerationMode?: KeyframeGenerationMode
  keyframeCount?: number
  understandingPreview?: BilingualUnderstandingPreview | null
  executionBrief?: EnglishExecutionBrief | null
  audioStrategy: AudioStrategy
  subtitleStrategy: SubtitleStrategy
  modelOverrides?: Partial<Record<ModelControlSlotType, { modelId?: string; providerId?: string }>>
}

export function getAudioStrategyLabel(strategy: AudioStrategy | null | undefined) {
  return strategy === "native_plus_tts_ducked" ? "保留环境音 + 系统配音" : "系统配音"
}

export function getSubtitleStrategyLabel(strategy: SubtitleStrategy | null | undefined) {
  return strategy === "whisper_cpp" ? "从成片音频识别字幕" : "跟随配音生成字幕"
}

export function getExecutionModeLabel(mode: ExecutionMode | null | undefined) {
  return mode === "review_required" ? "先审后生成" : "自动生成"
}

export function getBlueprintStatusLabel(status: BlueprintStatus | null | undefined) {
  switch (status) {
    case "ready_for_review":
      return "待审核"
    case "approved":
      return "已通过"
    case "rejected":
      return "已驳回"
    case "pending_generation":
      return "准备方案中"
    case "queued_for_video":
      return "待生成正片"
    case "video_generating":
      return "正片生成中"
    case "completed":
      return "已完成"
    default:
      return status || "未知"
  }
}

export function normalizeOperatorCopy(text: string | null | undefined) {
  if (!text) {
    return ""
  }

  return text
    .replace(/蓝图/g, "生成方案")
    .replace(/提示词/g, "生成说明")
    .replace(/母本/g, "画面参考")
    .replace(/\bworker\b/gi, "生成服务")
    .replace(/\bredis\b/gi, "排队服务")
    .replace(/\bprovider\b/gi, "接入方")
    .replace(/\bwaiting_review\b/g, "待审核")
    .replace(/\bready_for_review\b/g, "待审核")
    .replace(/\brunning\b/g, "生成中")
    .replace(/\bqueued\b/g, "排队中")
    .replace(/\bblocked\b/g, "卡住")
    .replace(/\bfailed\b/g, "失败")
    .replace(/\bcompleted\b/g, "已完成")
    .replace(/\bTTS\b/g, "系统配音")
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
  createTestUser: (payload?: { expiresInHours?: number }) =>
    request<{ user: UserRecord; password: string; expiresAt: string }>("/api/users/test-account", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
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
  listTasks: (options?: { includeArchived?: boolean }) =>
    request<{ tasks: TaskSummary[] }>(options?.includeArchived ? "/api/tasks?includeArchived=1" : "/api/tasks"),
  previewTaskBulkOperation: (payload: { taskIds: string[]; operation: TaskBulkOperation }) =>
    request<TaskBulkPreviewResponse>("/api/tasks/bulk/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteTaskBulk: (payload: {
    taskIds: string[]
    operation: "archive" | "restore" | "delete_task_with_assets" | "delete_assets_only"
    reason?: string
    confirmationText?: string
  }) =>
    request<TaskBulkResultResponse>("/api/tasks/bulk/delete", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  cancelTaskBulk: (payload: { taskIds: string[]; reason?: string }) =>
    request<TaskBulkResultResponse>("/api/tasks/bulk/cancel", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  resumeTaskBulk: (payload: { taskIds: string[]; reason?: string }) =>
    request<TaskBulkResultResponse>("/api/tasks/bulk/resume", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getTaskDetail: (taskId: string) => request<{ detail: TaskDetail }>(`/api/tasks/${taskId}`),
  getTaskBlueprints: (taskId: string) => request<{ blueprints: TaskBlueprintRecord[] }>(`/api/tasks/${taskId}/blueprints`),
  getTaskCurrentBlueprint: (taskId: string) =>
    request<BlueprintCurrentResponse>(`/api/tasks/${taskId}/blueprints/current`),
  getTaskDiagnostics: (taskId: string) =>
    request<{ diagnostics: TaskDiagnostics }>(`/api/tasks/${taskId}/diagnostics`),
  getTaskTimeline: (taskId: string) =>
    request<{ timeline: TaskTimelineEvent[] }>(`/api/tasks/${taskId}/timeline`),
  getTaskRetryRequests: (taskId: string) =>
    request<{ retryRequests: RetryRequest[] }>(`/api/tasks/${taskId}/retry-requests`),
  getTaskDelivery: (taskId: string) =>
    request<TaskDeliveryResponse>(`/api/tasks/${taskId}/delivery`),
  retryTask: (taskId: string, payload: { scope?: RetryRequestScope; sceneId?: string; reason?: string }) =>
    request<TaskRetryResponse>(`/api/tasks/${taskId}/retry`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getProductionSchedule: () => request<ProductionScheduleResponse>("/api/production/schedule"),
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
  deleteTask: (taskId: string) =>
    request<{ deleted: boolean; taskId: string }>(`/api/tasks/${taskId}`, {
      method: "DELETE",
    }),
  deleteTaskAssets: (taskId: string) =>
    request<{ deleted: boolean; taskId: string }>(`/api/tasks/${taskId}/assets`, {
      method: "DELETE",
    }),
  deleteTaskAsset: (taskId: string, assetId: string) =>
    request<{ deleted: boolean; taskId: string; assetId: string }>(`/api/tasks/${taskId}/assets/${assetId}`, {
      method: "DELETE",
    }),
  cancelTask: (taskId: string) =>
    request<TaskCancelResponse>(`/api/tasks/${taskId}/cancel`, {
      method: "POST",
    }),
  resumeFailedTask: (taskId: string) =>
    request<TaskResumeResponse>(`/api/tasks/${taskId}/resume`, {
      method: "POST",
    }),
  updateTaskAudioStrategy: (taskId: string, payload: { audioStrategy: AudioStrategy }) =>
    request<TaskAudioStrategyResponse>(`/api/tasks/${taskId}/audio-strategy`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  createUnderstandingPreview: (payload: {
    sourceBrief: string
    visualSeedInput?: string | null
    targetDurationSec: number
    keyframeCount?: number
    keepCharacterConsistent?: boolean
  }) =>
    request<UnderstandingPreviewResponse>("/api/tasks/understanding-preview", {
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
  listModelDiagnostics: (options?: { modelId?: string; providerId?: string; limit?: number }) =>
    request<{ diagnostics: ModelDiagnosticRecord[] }>(buildApiUrl("/api/model-control/diagnostics", {
      modelId: options?.modelId,
      providerId: options?.providerId,
      limit: options?.limit ? String(options.limit) : undefined,
    })),
  getModelQualitySummary: (options?: { limit?: number }) =>
    request<ModelQualitySummaryResponse>(buildApiUrl("/api/model-control/quality-summary", {
      limit: options?.limit ? String(options.limit) : undefined,
    })),
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
  getModelRoutingPolicies: () => request<ModelRoutingPoliciesResponse>("/api/model-control/routing"),
  updateModelRoutingPolicies: (payload: UpdateModelRoutingPoliciesPayload) =>
    request<ModelRoutingPoliciesResponse>("/api/model-control/routing", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  getModelRoutePreview: (modeId: ModelControlModeId) =>
    request<ModelRoutePreviewResponse>(buildApiUrl("/api/model-control/route-preview", { modeId })),
  getSelectableModelPools: (modeId: ModelControlModeId) =>
    request<SelectableModelPoolsResponse>(buildApiUrl("/api/model-control/selectable", { modeId })),
}
