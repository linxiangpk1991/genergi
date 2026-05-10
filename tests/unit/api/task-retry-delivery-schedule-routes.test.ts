import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const enqueueTaskMock = vi.fn()
const assertQueueAvailableMock = vi.fn()
const cancelTaskJobsMock = vi.fn()
const recoverTaskJobsMock = vi.fn()
const inspectTaskJobsMock = vi.fn()

vi.mock("../../../apps/api/src/lib/queue/enqueue", () => ({
  enqueueTask: enqueueTaskMock,
  assertQueueAvailable: assertQueueAvailableMock,
  cancelTaskJobs: cancelTaskJobsMock,
  recoverTaskJobs: recoverTaskJobsMock,
  inspectTaskJobs: inspectTaskJobsMock,
  QueueUnavailableError: class QueueUnavailableError extends Error {
    readonly code = "TASK_QUEUE_UNAVAILABLE"
  },
}))

describe("API retry, delivery, and production schedule routes", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
    process.env.GENERGI_SESSION_SECRET = "test-secret"
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
    assertQueueAvailableMock.mockResolvedValue(undefined)
    enqueueTaskMock.mockResolvedValue({
      queued: true,
      jobId: "job_retry_1",
      reason: "retry_failed_scene",
      continueExecution: true,
      blueprintVersion: 1,
      stage: "retry_scene",
      resumeFrom: "scene_2",
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
    inspectTaskJobsMock.mockResolvedValue({
      waiting: [],
      delayed: [],
      prioritized: [],
      paused: [],
      active: [],
      completed: [],
      failed: [],
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

  async function createAuthenticatedFailedTask(title = "Retryable task") {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-retry-api-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ buildSessionValue }, { app }, store, shared] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/task-store"),
      import("../../../packages/shared/src/index"),
    ])

    const created = await store.createTask({
      projectId: "project_default",
      title,
      script: "Show the product. Explain the benefit. End with the CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
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
      shared,
      taskId: created.task.id,
      cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
    }
  }

  it("records a scene retry request and enqueues recoverable failed task metadata", async () => {
    const { app, shared, taskId, cookie } = await createAuthenticatedFailedTask()

    const response = await app.request(`http://localhost/api/tasks/${taskId}/retry`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sceneId: "scene_2",
        reason: "Regenerate the timed-out scene",
      }),
    })

    expect(response.status).toBe(202)
    const payload = (await response.json()) as {
      retryRequest: { scope: string; sceneId: string | null; status: string; queue?: { reason: string } | null }
      task: { status: string; statusDetail?: string | null }
    }

    expect(payload.retryRequest).toMatchObject({
      scope: "scene",
      sceneId: "scene_2",
      status: "accepted",
      queue: { reason: "retry_failed_scene" },
    })
    expect(payload.task.status).toBe("queued")
    expect(payload.task.statusDetail).toBe("等待 worker 局部重试")
    expect(enqueueTaskMock).toHaveBeenCalledWith(taskId, {
      reason: "retry_failed_scene",
      continueExecution: true,
      blueprintVersion: 1,
      stage: "retry_scene",
      resumeFrom: "scene_2",
    })

    const requests = await shared.readTaskRetryRequests(taskId)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.sceneId).toBe("scene_2")
  })

  it("records a video retry request with narrow worker queue metadata", async () => {
    const { app, shared, taskId, cookie } = await createAuthenticatedFailedTask()
    enqueueTaskMock.mockResolvedValueOnce({
      queued: true,
      jobId: "job_retry_video_1",
      reason: "retry_failed_video",
      continueExecution: true,
      blueprintVersion: 1,
      stage: "retry_video",
      resumeFrom: "scene_2",
    })

    const response = await app.request(`http://localhost/api/tasks/${taskId}/retry`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "video",
        sceneId: "scene_2",
        reason: "Regenerate only the timed-out video file",
      }),
    })

    expect(response.status).toBe(202)
    const payload = (await response.json()) as {
      retryRequest: { scope: string; sceneId: string | null; status: string; queue?: { reason: string; stage: string; resumeFrom: string } | null }
    }

    expect(payload.retryRequest).toMatchObject({
      scope: "video",
      sceneId: "scene_2",
      status: "accepted",
      queue: {
        reason: "retry_failed_video",
        stage: "retry_video",
        resumeFrom: "scene_2",
      },
    })
    expect(enqueueTaskMock).toHaveBeenCalledWith(taskId, {
      reason: "retry_failed_video",
      continueExecution: true,
      blueprintVersion: 1,
      stage: "retry_video",
      resumeFrom: "scene_2",
    })

    const requests = await shared.readTaskRetryRequests(taskId)
    expect(requests[0]?.scope).toBe("video")
    expect(requests[0]?.sceneId).toBe("scene_2")
  })

  it("allows a waiting-review task to redo one keyframe without marking the whole task failed", async () => {
    const { app, shared, taskId, cookie } = await createAuthenticatedFailedTask("Review keyframe retry")
    await shared.updateTaskSummary(taskId, (task: any) => ({
      ...task,
      status: "waiting_review",
      failureReason: null,
      statusDetail: "等待审核",
      blueprintStatus: "ready_for_review",
    }))
    const detail = await shared.readTaskDetail(taskId)
    await shared.upsertTaskDetail({
      ...detail!,
      failureReason: null,
      statusDetail: "等待审核",
      blueprintStatus: "ready_for_review",
      taskRunConfig: {
        ...detail!.taskRunConfig,
        blueprintStatus: "ready_for_review",
      },
    })
    enqueueTaskMock.mockResolvedValueOnce({
      queued: true,
      jobId: "job_retry_keyframe_1",
      reason: "retry_failed_keyframe",
      continueExecution: false,
      blueprintVersion: 1,
      stage: "retry_keyframe",
      resumeFrom: "scene_2",
    })

    const response = await app.request(`http://localhost/api/tasks/${taskId}/retry`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "keyframe",
        sceneId: "scene_2",
        reason: "审核时重做单张关键画面",
      }),
    })

    expect(response.status).toBe(202)
    const payload = (await response.json()) as {
      retryRequest: { scope: string; sceneId: string | null; queue?: { stage: string; resumeFrom: string } | null }
      task: { status: string }
    }
    expect(payload.retryRequest).toMatchObject({
      scope: "keyframe",
      sceneId: "scene_2",
      queue: {
        stage: "retry_keyframe",
        resumeFrom: "scene_2",
      },
    })
    expect(payload.task.status).toBe("queued")
    expect(enqueueTaskMock).toHaveBeenCalledWith(taskId, {
      reason: "retry_failed_keyframe",
      continueExecution: false,
      blueprintVersion: 1,
      stage: "retry_keyframe",
      resumeFrom: "scene_2",
    })
  })

  it("returns an explicit scene validation error without enqueueing", async () => {
    const { app, taskId, cookie } = await createAuthenticatedFailedTask()

    const response = await app.request(`http://localhost/api/tasks/${taskId}/retry`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sceneId: "scene_missing" }),
    })

    expect(response.status).toBe(400)
    const payload = (await response.json()) as { message: string; sceneId: string; validSceneIds: string[] }
    expect(payload.message).toBe("RETRY_SCENE_NOT_FOUND")
    expect(payload.sceneId).toBe("scene_missing")
    expect(payload.validSceneIds).toContain("scene_1")
    expect(enqueueTaskMock).not.toHaveBeenCalled()
  })

  it("rejects retry while BullMQ still owns an active running job", async () => {
    const { app, shared, taskId, cookie } = await createAuthenticatedFailedTask()
    inspectTaskJobsMock.mockResolvedValueOnce({
      waiting: [],
      delayed: [],
      prioritized: [],
      paused: [],
      active: ["job_active_1"],
      completed: [],
      failed: [],
    })
    await shared.updateTaskSummary(taskId, (task: any) => ({
      ...task,
      status: "running",
      activeJobId: "job_active_1",
      statusDetail: "视频生成中",
    }))

    const response = await app.request(`http://localhost/api/tasks/${taskId}/retry`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sceneId: "scene_2" }),
    })

    expect(response.status).toBe(409)
    const payload = (await response.json()) as { message: string; activeJobIds: string[] }
    expect(payload.message).toBe("TASK_RUNNING_ACTIVE_JOB")
    expect(payload.activeJobIds).toEqual(["job_active_1"])
    expect(enqueueTaskMock).not.toHaveBeenCalled()
  })

  it("computes delivery and production schedule from task state and existing assets", async () => {
    const { app, taskId, cookie } = await createAuthenticatedFailedTask("Delivery task")
    const exportDir = path.join(dataDir, "exports", taskId)
    await mkdir(path.join(exportDir, "video"), { recursive: true })
    await mkdir(path.join(exportDir, "keyframes"), { recursive: true })
    await writeFile(path.join(exportDir, "script.txt"), "final narration", "utf8")
    await writeFile(path.join(exportDir, "subtitles.srt"), "1\n00:00:00,000 --> 00:00:01,000\nHello", "utf8")
    await writeFile(path.join(exportDir, "video", "final-with-audio.mp4"), "fake video", "utf8")
    await writeFile(path.join(exportDir, "keyframes", "scene-1.png"), "fake image", "utf8")
    await writeFile(
      path.join(exportDir, "keyframes", "manifest.json"),
      JSON.stringify({ frames: [{ sceneId: "scene_1", sceneIndex: 0, fileName: "scene-1.png" }] }),
      "utf8",
    )

    const deliveryResponse = await app.request(`http://localhost/api/tasks/${taskId}/delivery`, {
      headers: { Cookie: cookie },
    })

    expect(deliveryResponse.status).toBe(200)
    const deliveryPayload = (await deliveryResponse.json()) as {
      delivery: {
        taskId: string
        ready: boolean
        finalVideoAssetId: string | null
        manifestUrl: string
        checks: Array<{ key: string; status: string; assetId: string | null }>
        sceneMatrix: Array<{ sceneId: string; keyframe: { status: string }; video: { status: string } }>
        recommendedActions: Array<{ id: string; label: string }>
        publishCopy: { title: string; description: string; channelId: string }
        assetSummary: { readyCount: number; expectedTypes: string[]; missingTypes: string[] }
      }
    }
    expect(deliveryPayload.delivery.taskId).toBe(taskId)
    expect(deliveryPayload.delivery.ready).toBe(true)
    expect(deliveryPayload.delivery.finalVideoAssetId).toBe(`${taskId}_video`)
    expect(deliveryPayload.delivery.manifestUrl).toBe(`/api/tasks/${taskId}/delivery/manifest`)
    expect(deliveryPayload.delivery.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "finalVideo", status: "ready", assetId: `${taskId}_video` }),
        expect.objectContaining({ key: "cover", status: "ready" }),
        expect.objectContaining({ key: "manifest", status: "ready", assetId: `${taskId}_keyframes` }),
      ]),
    )
    expect(deliveryPayload.delivery.sceneMatrix[0]).toEqual(
      expect.objectContaining({
        sceneId: "scene_1",
        keyframe: expect.objectContaining({ status: "ready" }),
        video: expect.objectContaining({ status: "ready" }),
      }),
    )
    expect(deliveryPayload.delivery.recommendedActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "publish_ready" })]),
    )
    expect(deliveryPayload.delivery.publishCopy.title).toContain("Delivery task")
    expect(deliveryPayload.delivery.assetSummary.readyCount).toBeGreaterThanOrEqual(3)
    expect(deliveryPayload.delivery.assetSummary.missingTypes).not.toContain("video_bundle")

    const manifestResponse = await app.request(`http://localhost/api/tasks/${taskId}/delivery/manifest`, {
      headers: { Cookie: cookie },
    })

    expect(manifestResponse.status).toBe(200)
    expect(manifestResponse.headers.get("content-disposition")).toContain(`${taskId}-delivery-manifest.json`)
    const manifestPayload = (await manifestResponse.json()) as { delivery: { taskId: string; ready: boolean } }
    expect(manifestPayload.delivery).toMatchObject({ taskId, ready: true })

    const scheduleResponse = await app.request("http://localhost/api/production/schedule", {
      headers: { Cookie: cookie },
    })

    expect(scheduleResponse.status).toBe(200)
    const schedulePayload = (await scheduleResponse.json()) as {
      schedule: { generatedAt: string; lanes: Record<string, number>; items: Array<{ taskId: string; deliveryReady: boolean }> }
    }
    expect(schedulePayload.schedule.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(schedulePayload.schedule.items.some((item) => item.taskId === taskId && item.deliveryReady)).toBe(true)
    expect(schedulePayload.schedule.lanes.failed).toBeGreaterThanOrEqual(1)
  })
})
