import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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

describe("API task audio strategy route", () => {
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

  async function createReviewableTask() {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-audio-strategy-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ app }, store, shared] = await Promise.all([
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/task-store"),
      import("../../../packages/shared/src/index"),
    ])

    const created = await store.createTask({
      projectId: "project_default",
      title: "Audio strategy task",
      script: "Show the product. Explain the benefit. End with the CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
      audioStrategy: "tts_only",
    })

    await shared.updateTaskSummary(created.task.id, (task: any) => ({
      ...task,
      status: "waiting_review",
      blueprintStatus: "ready_for_review",
    }))

    const detail = await store.getTaskDetail(created.task.id)
    await shared.upsertTaskDetail({
      ...detail!,
      blueprintStatus: "ready_for_review",
      taskRunConfig: {
        ...detail!.taskRunConfig,
        blueprintStatus: "ready_for_review",
      },
    })

    const blueprintsFile = path.join(dataDir, "task-blueprints.json")
    const blueprintRecords = JSON.parse(await readFile(blueprintsFile, "utf8")) as Record<string, Array<Record<string, unknown>>>
    blueprintRecords[created.task.id][0] = {
      ...blueprintRecords[created.task.id][0],
      status: "ready_for_review",
    }
    await writeFile(blueprintsFile, JSON.stringify(blueprintRecords, null, 2), "utf8")

    return {
      app,
      store,
      shared,
      taskId: created.task.id,
    }
  }

  it("updates task audio strategy during review without touching blueprint status", async () => {
    const { app, store, taskId } = await createReviewableTask()

    const response = await app.request(`http://localhost/api/tasks/${taskId}/audio-strategy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioStrategy: "native_plus_tts_ducked" }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      task: { audioStrategy: string; blueprintStatus: string }
      detail: { blueprintStatus: string; taskRunConfig: { audioStrategy: string; blueprintStatus: string } }
    }

    expect(payload.task.audioStrategy).toBe("native_plus_tts_ducked")
    expect(payload.task.blueprintStatus).toBe("ready_for_review")
    expect(payload.detail.blueprintStatus).toBe("ready_for_review")
    expect(payload.detail.taskRunConfig.audioStrategy).toBe("native_plus_tts_ducked")
    expect(payload.detail.taskRunConfig.blueprintStatus).toBe("ready_for_review")

    const task = (await store.listTasks()).find((item: { id: string }) => item.id === taskId)
    const detail = await store.getTaskDetail(taskId)
    expect(task?.audioStrategy).toBe("native_plus_tts_ducked")
    expect(detail?.taskRunConfig.audioStrategy).toBe("native_plus_tts_ducked")
    expect(detail?.blueprintStatus).toBe("ready_for_review")
  })

  it("locks audio strategy updates after the task enters queued_for_video", async () => {
    const { app, shared, store, taskId } = await createReviewableTask()

    await shared.updateTaskSummary(taskId, (task: any) => ({
      ...task,
      status: "queued",
      blueprintStatus: "queued_for_video",
    }))

    const detail = await store.getTaskDetail(taskId)
    await shared.upsertTaskDetail({
      ...detail!,
      blueprintStatus: "queued_for_video",
      taskRunConfig: {
        ...detail!.taskRunConfig,
        blueprintStatus: "queued_for_video",
      },
    })

    const blueprintsFile = path.join(dataDir, "task-blueprints.json")
    const blueprintRecords = JSON.parse(await readFile(blueprintsFile, "utf8")) as Record<string, Array<Record<string, unknown>>>
    blueprintRecords[taskId][0] = {
      ...blueprintRecords[taskId][0],
      status: "queued_for_video",
    }
    await writeFile(blueprintsFile, JSON.stringify(blueprintRecords, null, 2), "utf8")

    const response = await app.request(`http://localhost/api/tasks/${taskId}/audio-strategy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioStrategy: "native_plus_tts_ducked" }),
    })

    expect(response.status).toBe(409)
    const payload = await response.json() as { message: string }
    expect(payload.message).toBe("TASK_AUDIO_STRATEGY_LOCKED")
  })
})
