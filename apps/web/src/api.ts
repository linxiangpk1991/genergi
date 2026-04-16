export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
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

export type CreateTaskPayload = {
  title: string
  script: string
  modeId: string
  channelId: string
  aspectRatio: string
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  bootstrap: () => request<BootstrapResponse>("/api/bootstrap"),
  listTasks: () => request<{ tasks: TaskSummary[] }>("/api/tasks"),
  createTask: (payload: CreateTaskPayload) =>
    request<{ task: TaskSummary }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
}
