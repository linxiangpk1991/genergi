import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

describe("task retry request persistence", () => {
  let dataDir = ""

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
    dataDir = ""
    vi.resetModules()
  })

  it("appends retry requests per task and normalizes optional scene fields", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-retry-requests-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const shared = await import("../../../packages/shared/src/index")
    const createdAt = "2026-04-21T01:02:03.000Z"

    const request = await shared.appendTaskRetryRequest("task_retry_001", {
      scope: "scene",
      sceneId: "scene_2",
      sceneIndex: 1,
      sceneTitle: "Product reveal",
      reason: "Scene 2 video timed out",
      status: "accepted",
      statusDetail: "等待 worker 局部重试",
      taskStatusAtRequest: "failed",
      queue: {
        queued: true,
        jobId: "job_retry_001",
        reason: "retry_failed_scene",
        continueExecution: true,
        blueprintVersion: 1,
        stage: "retry_scene",
        resumeFrom: "scene_2",
      },
      createdAt,
      updatedAt: createdAt,
    })

    expect(request).toMatchObject({
      id: "task_retry_001_retry_1",
      taskId: "task_retry_001",
      scope: "scene",
      sceneId: "scene_2",
      sceneIndex: 1,
      sceneTitle: "Product reveal",
      status: "accepted",
      queue: { jobId: "job_retry_001", reason: "retry_failed_scene" },
    })

    const taskRequests = await shared.readTaskRetryRequests("task_retry_001")
    expect(taskRequests).toHaveLength(1)
    expect(taskRequests[0]).toEqual(request)

    const persisted = JSON.parse(
      await readFile(path.join(dataDir, "task-retry-requests.json"), "utf8"),
    ) as Record<string, unknown[]>
    expect(persisted.task_retry_001).toHaveLength(1)
  })

  it("preserves narrow keyframe and video retry scopes for worker execution", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-retry-narrow-scopes-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const shared = await import("../../../packages/shared/src/index")
    const createdAt = "2026-04-21T02:03:04.000Z"

    const keyframeRequest = await shared.appendTaskRetryRequest("task_retry_scope", {
      scope: "keyframe",
      sceneId: "scene_2",
      sceneIndex: 1,
      sceneTitle: "Product reveal",
      reason: "Replace only scene 2 keyframe",
      status: "accepted",
      statusDetail: "等待 worker 局部重试",
      taskStatusAtRequest: "failed",
      queue: {
        queued: true,
        jobId: "job_retry_keyframe",
        reason: "retry_failed_keyframe",
        continueExecution: true,
        blueprintVersion: 1,
        stage: "retry_keyframe",
        resumeFrom: "scene_2",
      },
      createdAt,
      updatedAt: createdAt,
    })
    const videoRequest = await shared.appendTaskRetryRequest("task_retry_scope", {
      scope: "video",
      sceneId: "scene_2",
      sceneIndex: 1,
      sceneTitle: "Product reveal",
      reason: "Replace only scene 2 video",
      status: "accepted",
      statusDetail: "等待 worker 局部重试",
      taskStatusAtRequest: "failed",
      queue: {
        queued: true,
        jobId: "job_retry_video",
        reason: "retry_failed_video",
        continueExecution: true,
        blueprintVersion: 1,
        stage: "retry_video",
        resumeFrom: "scene_2",
      },
      createdAt,
      updatedAt: createdAt,
    })

    expect(keyframeRequest.scope).toBe("keyframe")
    expect(videoRequest.scope).toBe("video")

    const requests = await shared.readTaskRetryRequests("task_retry_scope")
    expect(requests.map((request) => request.scope)).toEqual(["keyframe", "video"])
    expect(requests.map((request) => request.sceneId)).toEqual(["scene_2", "scene_2"])
  })
})
