import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const enqueueTaskMock = vi.fn()
const assertQueueAvailableMock = vi.fn()
const cancelTaskJobsMock = vi.fn()
const recoverTaskJobsMock = vi.fn()

vi.mock("../../../apps/api/src/lib/queue/enqueue", () => ({
  enqueueTask: enqueueTaskMock,
  assertQueueAvailable: assertQueueAvailableMock,
  cancelTaskJobs: cancelTaskJobsMock,
  recoverTaskJobs: recoverTaskJobsMock,
  QueueUnavailableError: class QueueUnavailableError extends Error {
    readonly code = "TASK_QUEUE_UNAVAILABLE"
  },
}))

describe("API task timeline route", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
    process.env.GENERGI_SESSION_SECRET = "test-secret"
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
    assertQueueAvailableMock.mockResolvedValue(undefined)
    enqueueTaskMock.mockResolvedValue({
      queued: true,
      jobId: "job_create_1",
      reason: "initial_create",
      continueExecution: false,
    })
  })

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
    delete process.env.GENERGI_SESSION_SECRET
    delete process.env.GENERGI_ADMIN_USERNAME
    delete process.env.GENERGI_ADMIN_PASSWORD
    process.env.NODE_ENV = "test"
    dataDir = ""
    vi.clearAllMocks()
    vi.resetModules()
  })

  async function createAuthenticatedTask() {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-timeline-route-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ buildSessionValue }, { app }, store, shared] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/task-store"),
      import("../../../packages/shared/src/index"),
    ])

    const created = await store.createTask({
      projectId: "project_default",
      title: "Audited task",
      script: "Show the product. Explain the benefit. End with the CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    return {
      app,
      taskId: created.task.id,
      shared,
      cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
    }
  }

  it("returns persisted task timeline events in append order", async () => {
    const { app, taskId, shared, cookie } = await createAuthenticatedTask()

    await shared.appendTaskTimelineEvent(taskId, {
      type: "stage",
      stage: "job_started",
      label: "开始任务",
      level: "info",
      summary: "worker 已接收任务",
    })
    await shared.appendTaskTimelineEvent(taskId, {
      type: "provider",
      stage: "text_planning",
      label: "规划 provider 响应",
      level: "info",
      provider: {
        provider: "anthropic-native",
        model: "claude-opus-4-6",
        request: { endpoint: "https://provider.example/v1/messages", method: "POST" },
        response: { status: 200, ok: true },
      },
    })

    const response = await app.request(`http://localhost/api/tasks/${taskId}/timeline`, {
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      timeline: Array<{ sequence: number; type: string; stage: string; provider?: { request?: { endpoint?: string } } }>
    }

    expect(payload.timeline.map((event) => [event.sequence, event.type, event.stage])).toEqual([
      [1, "stage", "job_started"],
      [2, "provider", "text_planning"],
    ])
    expect(payload.timeline[1]?.provider?.request?.endpoint).toBe("https://provider.example/v1/messages")
  })

  it("returns TASK_NOT_FOUND when the task does not exist", async () => {
    const { app, cookie } = await createAuthenticatedTask()

    const response = await app.request("http://localhost/api/tasks/task_missing/timeline", {
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: "TASK_NOT_FOUND" })
  })
})
