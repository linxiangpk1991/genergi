import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const enqueueTaskMock = vi.fn()
const assertQueueAvailableMock = vi.fn()
const cancelTaskJobsMock = vi.fn()

vi.mock("../../../apps/api/src/lib/queue/enqueue", () => ({
  enqueueTask: enqueueTaskMock,
  assertQueueAvailable: assertQueueAvailableMock,
  cancelTaskJobs: cancelTaskJobsMock,
  QueueUnavailableError: class QueueUnavailableError extends Error {
    readonly code = "TASK_QUEUE_UNAVAILABLE"
  },
}))

describe("API task cancel route", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
    process.env.GENERGI_SESSION_SECRET = "test-secret"
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
    cancelTaskJobsMock.mockResolvedValue({
      removedJobIds: ["job_1"],
      hadActiveJob: false,
    })
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
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-cancel-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ buildSessionValue }, { app }, store] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/task-store"),
    ])

    const created = await store.createTask({
      projectId: "project_default",
      title: "Cancelable task",
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
      store,
      taskId: created.task.id,
      cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
    }
  }

  it("cancels a queued task immediately and removes queued jobs", async () => {
    const { app, store, taskId, cookie } = await createAuthenticatedTask()

    const response = await app.request(`http://localhost/api/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      task: { status: string; statusDetail?: string | null; cancelRequestedAt?: string | null }
      detail: { statusDetail?: string | null; cancelRequestedAt?: string | null }
      queue: { removedJobIds: string[]; hadActiveJob: boolean }
    }

    expect(payload.task.status).toBe("canceled")
    expect(payload.task.statusDetail).toBe("任务已终止")
    expect(payload.task.cancelRequestedAt).toEqual(expect.any(String))
    expect(payload.detail.statusDetail).toBe("任务已终止")
    expect(payload.queue.removedJobIds).toEqual(["job_1"])
    expect(payload.queue.hadActiveJob).toBe(false)
    expect(cancelTaskJobsMock).toHaveBeenCalledWith(taskId)

    const task = (await store.listTasks()).find((item: { id: string }) => item.id === taskId)
    expect(task?.status).toBe("canceled")
    expect(task?.statusDetail).toBe("任务已终止")
  })

  it("marks a running task as canceling when an active job is already held by the worker", async () => {
    const { app, store, taskId, cookie } = await createAuthenticatedTask()
    const shared = await import("../../../packages/shared/src/index")
    cancelTaskJobsMock.mockResolvedValueOnce({
      removedJobIds: [],
      hadActiveJob: true,
    })

    await shared.updateTaskSummary(taskId, (task: any) => ({
      ...task,
      status: "running",
      statusDetail: "正在生成 scene 2/4",
    }))

    const detail = await store.getTaskDetail(taskId)
    await shared.upsertTaskDetail({
      ...detail!,
      statusDetail: "正在生成 scene 2/4",
    })

    const response = await app.request(`http://localhost/api/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      task: { status: string; statusDetail?: string | null; cancelRequestedAt?: string | null }
      detail: { statusDetail?: string | null; cancelRequestedAt?: string | null }
      queue: { removedJobIds: string[]; hadActiveJob: boolean }
    }

    expect(payload.task.status).toBe("canceled")
    expect(payload.task.statusDetail).toBe("正在终止当前任务")
    expect(payload.detail.statusDetail).toBe("正在终止当前任务")
    expect(payload.queue.hadActiveJob).toBe(true)
    expect(payload.task.cancelRequestedAt).toEqual(expect.any(String))
  })
})
