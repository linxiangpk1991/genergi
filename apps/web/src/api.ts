export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ""

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
    throw new Error(`Request failed: ${response.status}`)
  }

  return (await response.json()) as T
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
    imageFinalModel: {
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

export type CreateTaskPayload = {
  title: string
  script: string
  modeId: string
  channelId: string
  aspectRatio: string
  targetDurationSec: number
  generationMode?: GenerationPreferenceId
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
}
