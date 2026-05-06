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
    recoverTaskJobsMock.mockResolvedValue({
      activeJobIds: [],
      staleActiveJobIds: [],
      hasActiveJob: false,
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

  async function createStaleRunningTask() {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-stale-resume-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ buildSessionValue }, { app }, store, shared] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/task-store"),
      import("../../../packages/shared/src/index"),
    ])

    const created = await store.createTask({
      projectId: "project_default",
      title: "Stale running task",
      script: "Show the product. Explain the benefit. End with the CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
      audioStrategy: "native_plus_tts_ducked",
    })

    const staleUpdatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    await shared.updateTaskSummary(created.task.id, (task: any) => ({
      ...task,
      status: "running",
      failureReason: null,
      statusDetail: "关键画面生成中 3/4",
      blueprintStatus: "pending_generation",
      retryCount: 0,
      updatedAt: staleUpdatedAt,
      lastHeartbeatAt: staleUpdatedAt,
    }))

    const detail = await store.getTaskDetail(created.task.id)
    await shared.upsertTaskDetail({
      ...detail!,
      failureReason: null,
      statusDetail: "关键画面生成中 3/4",
      blueprintStatus: "pending_generation",
      updatedAt: staleUpdatedAt,
      lastHeartbeatAt: staleUpdatedAt,
      taskRunConfig: {
        ...detail!.taskRunConfig,
        blueprintStatus: "pending_generation",
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

  it("marks the task resume-pending before enqueue so worker start cannot be downgraded afterward", async () => {
    const { app, store, taskId, cookie } = await createFailedTask()
    enqueueTaskMock.mockImplementationOnce(async () => {
      const taskDuringEnqueue = (await store.listTasks()).find((item: { id: string }) => item.id === taskId)
      expect(taskDuringEnqueue?.status).toBe("queued")
      expect(taskDuringEnqueue?.currentStage).toBe("resume_pending")
      return {
        queued: true,
        jobId: "job_resume_after_mark_1",
        reason: "resume_failed_task",
        continueExecution: true,
        resumeFrom: "failed_task",
      }
    })

    const response = await app.request(`http://localhost/api/tasks/${taskId}/resume`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(202)
    expect(enqueueTaskMock).toHaveBeenCalledTimes(1)
  })

  it("restores the original failed state if queue enqueue fails during recovery", async () => {
    enqueueTaskMock.mockRejectedValueOnce(new Error("queue unavailable"))
    const { app, store, taskId, cookie } = await createFailedTask()

    const response = await app.request(`http://localhost/api/tasks/${taskId}/resume`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(503)
    const task = (await store.listTasks()).find((item: { id: string }) => item.id === taskId)
    expect(task?.status).toBe("failed")
    expect(task?.failureReason).toBe("Scene 2 video generation timeout")
  })

  it("requeues a stale running task only when no active queue job is still held", async () => {
    enqueueTaskMock.mockResolvedValueOnce({
      queued: true,
      jobId: "job_resume_stale_1",
      reason: "resume_stale_running_task",
      continueExecution: true,
      resumeFrom: "stale_running_task",
    })
    const { app, store, taskId, cookie } = await createStaleRunningTask()

    const response = await app.request(`http://localhost/api/tasks/${taskId}/resume`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(202)
    const payload = (await response.json()) as {
      task: { status: string; statusDetail?: string | null; failureReason?: string | null }
      detail: { statusDetail?: string | null; failureReason?: string | null }
      queue: { queued: boolean; reason: string; resumeFrom?: string | null }
    }

    expect(payload.task.status).toBe("queued")
    expect(payload.task.statusDetail).toBe("等待 worker 恢复处理")
    expect(payload.task.failureReason).toBeNull()
    expect(payload.detail.statusDetail).toBe("等待 worker 恢复处理")
    expect(payload.queue.reason).toBe("resume_stale_running_task")
    expect(payload.queue.resumeFrom).toBe("stale_running_task")
    expect(recoverTaskJobsMock).toHaveBeenCalledWith(taskId, { minActiveAgeMs: 10 * 60 * 1000 })
    expect(enqueueTaskMock).toHaveBeenCalledWith(taskId, {
      reason: "resume_stale_running_task",
      continueExecution: true,
      blueprintVersion: 1,
      stage: "resume_after_stale_running",
      resumeFrom: "stale_running_task",
    })

    const task = (await store.listTasks()).find((item: { id: string }) => item.id === taskId)
    expect(task?.status).toBe("queued")
    expect(task?.failureReason).toBeNull()
  })

  it("does not enqueue a duplicate stale running job while BullMQ still reports an active job", async () => {
    recoverTaskJobsMock.mockResolvedValueOnce({
      activeJobIds: ["job_stale_running"],
      staleActiveJobIds: ["job_stale_running"],
      hasActiveJob: true,
    })
    const { app, taskId, cookie } = await createStaleRunningTask()

    const response = await app.request(`http://localhost/api/tasks/${taskId}/resume`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(409)
    const payload = (await response.json()) as {
      message: string
      activeJobIds: string[]
      staleActiveJobIds: string[]
    }

    expect(payload.message).toBe("TASK_STALE_ACTIVE_JOB_STILL_HELD")
    expect(payload.activeJobIds).toEqual(["job_stale_running"])
    expect(payload.staleActiveJobIds).toEqual(["job_stale_running"])
    expect(enqueueTaskMock).not.toHaveBeenCalled()
  })
})
