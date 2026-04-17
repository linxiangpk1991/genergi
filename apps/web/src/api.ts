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

export type BootstrapResponse = {
  brand: { productName: string; companyName: string; domain: string }
  channels: Array<{ id: string; label: string; description: string }>
  modes: Array<{ id: string; label: string; description: string; budgetLimitCny: number }>
}

export type SessionResponse = {
  authenticated: boolean
  operator: string | null
  auth: {
    configured: boolean
    localDevFallback: boolean
  }
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
  status: string
  progressPct: number
  retryCount: number
  estimatedCostCny: number
  createdAt: string
  updatedAt: string
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
}

export type TaskDetail = {
  taskId: string
  title: string
  script: string
  taskRunConfig: {
    modeId: string
    channelId: string
    imageFinalModel: {
      label: string
    }
  }
  scenes: StoryboardScene[]
  updatedAt: string
}

export type CreateTaskPayload = {
  title: string
  script: string
  modeId: string
  channelId: string
  aspectRatio: string
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
  listTasks: () => request<{ tasks: TaskSummary[] }>("/api/tasks"),
  getTaskDetail: (taskId: string) => request<{ detail: TaskDetail }>(`/api/tasks/${taskId}`),
  createTask: (payload: CreateTaskPayload) =>
    request<{ task: TaskSummary }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
}
