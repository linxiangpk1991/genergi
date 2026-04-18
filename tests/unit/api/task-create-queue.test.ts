import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("API task creation queue hardening", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
    process.env.GENERGI_SESSION_SECRET = "test-secret"
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
    delete process.env.REDIS_URL
  })

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }

    delete process.env.GENERGI_DATA_DIR
    delete process.env.GENERGI_SESSION_SECRET
    delete process.env.GENERGI_ADMIN_USERNAME
    delete process.env.GENERGI_ADMIN_PASSWORD
    delete process.env.REDIS_URL
    process.env.NODE_ENV = "test"
    dataDir = ""
    vi.resetModules()
  })

  it("fails task creation fast when the queue is unavailable and does not persist an orphaned task", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-create-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ buildSessionValue }, { app }, store] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/task-store"),
    ])
    const tasksBefore = await store.listTasks()

    const response = await app.request("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Queue unavailable",
        script: "Lead with the hook, show the product, prove the value, and close with the CTA.",
        modeId: "high_quality",
        channelId: "reels",
        aspectRatio: "9:16",
        targetDurationSec: 30,
        generationMode: "system_enhanced",
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
      },
    })

    const payload = (await response.json()) as {
      message: string
      reason?: string
    }

    expect(response.status).toBe(503)
    expect(payload.message).toBe("TASK_QUEUE_UNAVAILABLE")
    expect(payload.reason).toContain("REDIS_URL")
    const tasksAfter = await store.listTasks()
    expect(tasksAfter).toHaveLength(tasksBefore.length)
    expect(tasksAfter.some((task: { title: string }) => task.title === "Queue unavailable")).toBe(false)
  })

  it("rolls back a created task when enqueue fails after the preflight succeeds", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-create-"))
    process.env.GENERGI_DATA_DIR = dataDir
    process.env.REDIS_URL = "redis://example.com:6379"

    vi.doMock("../../../apps/api/src/lib/queue/enqueue", async () => {
      const actual = await vi.importActual<typeof import("../../../apps/api/src/lib/queue/enqueue")>(
        "../../../apps/api/src/lib/queue/enqueue",
      )

      return {
        ...actual,
        assertQueueAvailable: vi.fn().mockResolvedValue(undefined),
        enqueueTask: vi.fn().mockRejectedValue(new actual.QueueUnavailableError("enqueue add failed")),
      }
    })

    const [{ buildSessionValue }, { app }, store] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/task-store"),
    ])
    const tasksBefore = await store.listTasks()

    const response = await app.request("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Queue rejected after create",
        script: "Lead with the hook, show the product, prove the value, and close with the CTA.",
        modeId: "high_quality",
        channelId: "reels",
        aspectRatio: "9:16",
        targetDurationSec: 30,
        generationMode: "system_enhanced",
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
      },
    })

    const payload = (await response.json()) as {
      message: string
      reason?: string
    }

    expect(response.status).toBe(503)
    expect(payload.message).toBe("TASK_QUEUE_UNAVAILABLE")
    expect(payload.reason).toContain("enqueue add failed")
    const tasksAfter = await store.listTasks()
    expect(tasksAfter).toHaveLength(tasksBefore.length)
    expect(tasksAfter.some((task: { title: string }) => task.title === "Queue rejected after create")).toBe(false)
  })
})
