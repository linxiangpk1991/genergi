import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const enqueueTaskMock = vi.fn()
const assertQueueAvailableMock = vi.fn()

vi.mock("../../../apps/api/src/lib/queue/enqueue", () => ({
  enqueueTask: enqueueTaskMock,
  assertQueueAvailable: assertQueueAvailableMock,
  cancelTaskJobs: vi.fn(),
  inspectTaskJobs: vi.fn(),
  recoverTaskJobs: vi.fn(),
  QueueUnavailableError: class QueueUnavailableError extends Error {
    readonly code = "TASK_QUEUE_UNAVAILABLE"
  },
}))

describe("API task list model usage", () => {
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

  it("adds the frozen task model snapshot to task summaries", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-list-models-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ app }, { buildSessionValue }, store] = await Promise.all([
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/lib/task-store"),
    ])

    const created = await store.createTask({
      projectId: "project_default",
      title: "Model visibility task",
      script: "Show the product. Explain the value. End with a CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    const cookie = `genergi_session=${buildSessionValue("admin", "test-secret")}`
    const response = await app.request("/api/tasks", { headers: { Cookie: cookie } })
    const payload = await response.json() as {
      tasks: Array<{
        id: string
        modelUsage?: {
          textModel?: { label: string }
          imageModel?: { label: string }
          videoModel?: { label: string }
          ttsProvider?: string
        }
      }>
    }

    const task = payload.tasks.find((entry) => entry.id === created.task.id)
    expect(task?.modelUsage?.textModel?.label).toBe("Claude Opus 4.6")
    expect(task?.modelUsage?.imageModel?.label).toContain("Gemini")
    expect(task?.modelUsage?.videoModel?.label).toContain("Veo 3.1")
    expect(task?.modelUsage?.ttsProvider).toBe("edge-tts")
  })
})
