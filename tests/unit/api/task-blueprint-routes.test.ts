import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const enqueueTaskMock = vi.fn()
const assertQueueAvailableMock = vi.fn()

vi.mock("../../../apps/api/src/lib/queue/enqueue", () => ({
  enqueueTask: enqueueTaskMock,
  assertQueueAvailable: assertQueueAvailableMock,
  QueueUnavailableError: class QueueUnavailableError extends Error {
    readonly code = "TASK_QUEUE_UNAVAILABLE"
  },
}))

describe("API task blueprint routes", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
    process.env.GENERGI_SESSION_SECRET = "test-secret"
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
    enqueueTaskMock.mockResolvedValue({ queued: true, resumeFrom: "blueprint_approved" })
    assertQueueAvailableMock.mockResolvedValue(undefined)
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
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-blueprint-routes-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ buildSessionValue }, { app }, store] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/task-store"),
    ])

    const created = await store.createTask({
      projectId: "project_default",
      title: "Blueprint route test",
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
      cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
    }
  }

  it("lists blueprint versions and returns the current blueprint", async () => {
    const { app, taskId, cookie } = await createAuthenticatedTask()

    const listResponse = await app.request(`/api/tasks/${taskId}/blueprints`, {
      headers: { Cookie: cookie },
    })
    expect(listResponse.status).toBe(200)
    const listPayload = (await listResponse.json()) as {
      blueprints: Array<{ version: number; blueprint: { projectId: string } }>
    }
    expect(listPayload.blueprints).toHaveLength(1)
    expect(listPayload.blueprints[0]?.blueprint.projectId).toBe("project_default")

    const currentResponse = await app.request(`/api/tasks/${taskId}/blueprints/current`, {
      headers: { Cookie: cookie },
    })
    expect(currentResponse.status).toBe(200)
    const currentPayload = (await currentResponse.json()) as {
      blueprint: { version: number }
    }
    expect(currentPayload.blueprint.version).toBe(1)
  })

  it("approves the current blueprint, syncs it, and re-enqueues the task", async () => {
    const { app, taskId, cookie } = await createAuthenticatedTask()

    const response = await app.request(`/api/tasks/${taskId}/blueprints/1/review`, {
      method: "POST",
      body: JSON.stringify({ decision: "approved", note: "整体通过" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      review: { decision: string }
      approvedEntry: { projectId: string; blueprintVersion: number }
      queue: { queued: boolean; resumeFrom: string | null }
    }

    expect(payload.review.decision).toBe("approved")
    expect(payload.approvedEntry.projectId).toBe("project_default")
    expect(payload.approvedEntry.blueprintVersion).toBe(1)
    expect(payload.queue.resumeFrom).toBe("blueprint_approved")
    expect(enqueueTaskMock).toHaveBeenCalledWith(taskId, { resumeFrom: "blueprint_approved" })
  })
})
