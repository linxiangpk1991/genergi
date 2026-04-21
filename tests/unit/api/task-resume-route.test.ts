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

describe("API task resume route", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
    process.env.GENERGI_SESSION_SECRET = "test-secret"
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
    assertQueueAvailableMock.mockResolvedValue(undefined)
    enqueueTaskMock.mockResolvedValue({
      queued: true,
      jobId: "job_resume_1",
      reason: "resume_failed_task",
      continueExecution: true,
      resumeFrom: "failed_task",
    })
    cancelTaskJobsMock.mockResolvedValue({
      removedJobIds: [],
      hadActiveJob: false,
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

  async function createFailedTask() {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-resume-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ buildSessionValue }, { app }, store, shared] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/task-store"),
      import("../../../packages/shared/src/index"),
    ])

    const created = await store.createTask({
      projectId: "project_default",
      title: "Recoverable task",
      script: "Show the product. Explain the benefit. End with the CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
      audioStrategy: "native_plus_tts_ducked",
    })

    await shared.updateTaskSummary(created.task.id, (task: any) => ({
      ...task,
      status: "failed",
      failureReason: "Scene 2 video generation timeout",
      statusDetail: "任务失败",
      blueprintStatus: "queued_for_video",
      retryCount: 1,
    }))

    const detail = await store.getTaskDetail(created.task.id)
    await shared.upsertTaskDetail({
      ...detail!,
      failureReason: "Scene 2 video generation timeout",
      statusDetail: "任务失败",
      blueprintStatus: "queued_for_video",
      taskRunConfig: {
        ...detail!.taskRunConfig,
        blueprintStatus: "queued_for_video",
      },
    })

    return {
      app,
      store,
      taskId: created.task.id,
      cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
    }
  }

  it("requeues a failed task and preserves continueExecution for already approved video generation", async () => {
    const { app, store, taskId, cookie } = await createFailedTask()

    const response = await app.request(`http://localhost/api/tasks/${taskId}/resume`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(202)
    const payload = (await response.json()) as {
      task: { status: string; statusDetail?: string | null; failureReason?: string | null }
      detail: { statusDetail?: string | null; failureReason?: string | null }
      queue: { continueExecution: boolean; reason: string; resumeFrom?: string | null }
    }

    expect(payload.task.status).toBe("queued")
    expect(payload.task.statusDetail).toBe("等待 worker 恢复处理")
    expect(payload.task.failureReason).toBeNull()
    expect(payload.detail.statusDetail).toBe("等待 worker 恢复处理")
    expect(payload.queue.reason).toBe("resume_failed_task")
    expect(payload.queue.resumeFrom).toBe("failed_task")
    expect(payload.queue.continueExecution).toBe(true)
    expect(enqueueTaskMock).toHaveBeenCalledWith(taskId, {
      reason: "resume_failed_task",
      continueExecution: true,
      blueprintVersion: 1,
      stage: "resume_after_failure",
      resumeFrom: "failed_task",
    })

    const task = (await store.listTasks()).find((item: { id: string }) => item.id === taskId)
    expect(task?.status).toBe("queued")
    expect(task?.failureReason).toBeNull()
  })
})
