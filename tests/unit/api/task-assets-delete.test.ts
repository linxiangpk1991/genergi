import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
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

describe("API task asset deletion", () => {
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

  async function createTaskWithAssets() {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-assets-delete-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ app }, { buildSessionValue }, store, shared] = await Promise.all([
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/lib/task-store"),
      import("../../../packages/shared/src/index"),
    ])

    const created = await store.createTask({
      projectId: "project_default",
      title: "Delete assets task",
      script: "Show the product. Explain the value. End with a CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    const exportDir = path.join(dataDir, "exports", created.task.id)
    const sharedAssetsDir = path.join(dataDir, "assets", created.task.id)
    const unsafeDir = path.join(dataDir, "outside")
    await mkdir(exportDir, { recursive: true })
    await mkdir(sharedAssetsDir, { recursive: true })
    await mkdir(unsafeDir, { recursive: true })
    const scriptPath = path.join(exportDir, "script.txt")
    const generatedImagePath = path.join(sharedAssetsDir, "scene-01.jpg")
    const unsafePath = path.join(unsafeDir, "do-not-delete.txt")
    await writeFile(scriptPath, "final narration", "utf8")
    await writeFile(generatedImagePath, "image-bytes", "utf8")
    await writeFile(unsafePath, "keep me", "utf8")

    await shared.upsertTaskAssets(created.task.id, [
      {
        id: "generated_image",
        taskId: created.task.id,
        assetType: "keyframe_image",
        label: "关键帧",
        status: "ready",
        path: generatedImagePath,
        createdAt: "2026-05-07T00:00:00.000Z",
      },
      {
        id: "unsafe_asset",
        taskId: created.task.id,
        assetType: "script",
        label: "越权路径",
        status: "ready",
        path: unsafePath,
        createdAt: "2026-05-07T00:00:00.000Z",
      },
    ])

    return {
      app,
      cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
      shared,
      store,
      taskId: created.task.id,
      scriptPath,
      generatedImagePath,
      unsafePath,
      exportDir,
      sharedAssetsDir,
    }
  }

  it("deletes one task asset only when its file is under the task exports or assets directory", async () => {
    const { app, cookie, shared, taskId, generatedImagePath, unsafePath } = await createTaskWithAssets()
    await shared.updateTaskSummary(taskId, (task) => ({ ...task, status: "completed" }))

    const response = await app.request(`/api/tasks/${taskId}/assets/generated_image`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(200)
    await expect(stat(generatedImagePath)).rejects.toThrow()
    expect(await readFile(unsafePath, "utf8")).toBe("keep me")
    expect((await shared.readTaskAssets(taskId)).map((asset) => asset.id)).toEqual(["unsafe_asset"])
  })

  it("rejects single-asset deletion when the stored file path is outside the task asset roots", async () => {
    const { app, cookie, shared, taskId, unsafePath } = await createTaskWithAssets()
    await shared.updateTaskSummary(taskId, (task) => ({ ...task, status: "completed" }))

    const response = await app.request(`/api/tasks/${taskId}/assets/unsafe_asset`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(403)
    expect(await readFile(unsafePath, "utf8")).toBe("keep me")
  })

  it("deletes the task export/assets directories and clears persisted asset records", async () => {
    const { app, cookie, shared, taskId, scriptPath, generatedImagePath, unsafePath, exportDir, sharedAssetsDir } =
      await createTaskWithAssets()
    await shared.updateTaskSummary(taskId, (task) => ({ ...task, status: "failed" }))

    const response = await app.request(`/api/tasks/${taskId}/assets`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(200)
    await expect(stat(scriptPath)).rejects.toThrow()
    await expect(stat(generatedImagePath)).rejects.toThrow()
    await expect(stat(exportDir)).rejects.toThrow()
    await expect(stat(sharedAssetsDir)).rejects.toThrow()
    expect(await readFile(unsafePath, "utf8")).toBe("keep me")
    expect(await shared.readTaskAssets(taskId)).toEqual([])
  })

  it("blocks asset deletion while a task is still queued or running through the generation chain", async () => {
    const { app, cookie, shared, taskId, generatedImagePath } = await createTaskWithAssets()

    const queuedResponse = await app.request(`/api/tasks/${taskId}/assets/generated_image`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    })
    expect(queuedResponse.status).toBe(409)
    expect(await queuedResponse.json()).toEqual({ message: "TASK_ASSETS_LOCKED", status: "queued" })
    expect(await readFile(generatedImagePath, "utf8")).toBe("image-bytes")

    await shared.updateTaskSummary(taskId, (task) => ({ ...task, status: "running" }))

    const runningResponse = await app.request(`/api/tasks/${taskId}/assets`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    })
    expect(runningResponse.status).toBe(409)
    expect(await runningResponse.json()).toEqual({ message: "TASK_ASSETS_LOCKED", status: "running" })
    expect(await readFile(generatedImagePath, "utf8")).toBe("image-bytes")
  })

  it("rejects encoded traversal task ids and does not delete sibling directories", async () => {
    const { app, cookie } = await createTaskWithAssets()
    const victimExportDir = path.join(dataDir, "exports", "victim")
    const victimAssetDir = path.join(dataDir, "assets", "victim")
    const victimExportFile = path.join(victimExportDir, "keep.txt")
    const victimAssetFile = path.join(victimAssetDir, "keep.txt")
    await mkdir(victimExportDir, { recursive: true })
    await mkdir(victimAssetDir, { recursive: true })
    await writeFile(victimExportFile, "keep export", "utf8")
    await writeFile(victimAssetFile, "keep asset", "utf8")

    for (const encodedTaskId of ["..%5Cvictim", "..%2Fvictim", "%2e%2e%5cvictim"]) {
      const response = await app.request(`/api/tasks/${encodedTaskId}/assets`, {
        method: "DELETE",
        headers: { Cookie: cookie },
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ message: "TASK_ASSET_TASK_ID_FORBIDDEN" })
      expect(await readFile(victimExportFile, "utf8")).toBe("keep export")
      expect(await readFile(victimAssetFile, "utf8")).toBe("keep asset")
    }
  })

  it("returns not found instead of deleting directories for nonexistent task ids", async () => {
    const { app, cookie } = await createTaskWithAssets()

    const response = await app.request("/api/tasks/task_missing/assets", {
      method: "DELETE",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: "TASK_NOT_FOUND" })
  })

  it("deletes the whole task record with its detail, timeline, and task-owned files", async () => {
    const { app, cookie, shared, taskId, scriptPath, generatedImagePath, unsafePath, exportDir, sharedAssetsDir } =
      await createTaskWithAssets()
    await shared.updateTaskSummary(taskId, (task) => ({ ...task, status: "completed" }))

    const response = await app.request(`/api/tasks/${taskId}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: true, taskId })
    expect((await shared.readTaskSummaries()).some((task) => task.id === taskId)).toBe(false)
    expect(await shared.readTaskDetail(taskId)).toBeNull()
    expect(await shared.readTaskTimeline(taskId)).toEqual([])
    expect(await shared.readTaskAssets(taskId)).toEqual([])
    await expect(stat(scriptPath)).rejects.toThrow()
    await expect(stat(generatedImagePath)).rejects.toThrow()
    await expect(stat(exportDir)).rejects.toThrow()
    await expect(stat(sharedAssetsDir)).rejects.toThrow()
    expect(await readFile(unsafePath, "utf8")).toBe("keep me")
  })
})
