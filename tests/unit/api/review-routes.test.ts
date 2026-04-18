import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("API review routes", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
    process.env.GENERGI_SESSION_SECRET = "test-secret"
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
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
    vi.resetModules()
  })

  async function createAuthenticatedTask() {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-review-routes-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ buildSessionValue }, { app }, store] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
      import("../../../apps/api/src/lib/task-store"),
    ])

    const created = await store.createTask({
      title: "Review route test",
      script:
        "Hook with a strong product opener. Show the feature close-up. Demonstrate social proof. Close with the CTA.",
      modeId: "high_quality",
      channelId: "reels",
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

  it("keeps review routes authenticated", async () => {
    const { app, taskId } = await createAuthenticatedTask()

    const response = await app.request(`/api/tasks/${taskId}/reviews/storyboard_review/missing-scene`, {
      method: "POST",
      body: JSON.stringify({ decision: "approved" }),
      headers: {
        "Content-Type": "application/json",
      },
    })

    expect(response.status).toBe(401)
  })

  it("returns 400 for an invalid review payload", async () => {
    const { app, taskId, cookie } = await createAuthenticatedTask()

    const response = await app.request(`/api/tasks/${taskId}/reviews/storyboard_review/scene_invalid`, {
      method: "POST",
      body: JSON.stringify({ decision: "maybe" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    })

    expect(response.status).toBe(400)
  })

  it("returns 404 when the task does not exist", async () => {
    const { app, cookie } = await createAuthenticatedTask()

    const response = await app.request("/api/tasks/task_missing/reviews/storyboard_review/scene_missing", {
      method: "POST",
      body: JSON.stringify({ decision: "approved" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    })

    expect(response.status).toBe(404)
  })

  it("returns 404 when the scene does not exist", async () => {
    const { app, taskId, cookie } = await createAuthenticatedTask()

    const response = await app.request(`/api/tasks/${taskId}/reviews/storyboard_review/scene_missing`, {
      method: "POST",
      body: JSON.stringify({ decision: "approved" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    })

    expect(response.status).toBe(404)
  })

  it("persists storyboard review decisions and returns updated task detail", async () => {
    const { app, taskId, cookie } = await createAuthenticatedTask()
    const detailResponse = await app.request(`/api/tasks/${taskId}`, {
      headers: {
        Cookie: cookie,
      },
    })
    const detailPayload = (await detailResponse.json()) as {
      detail: {
        scenes: Array<{ id: string }>
      }
    }
    const sceneId = detailPayload.detail.scenes[0]?.id

    const response = await app.request(`/api/tasks/${taskId}/reviews/storyboard_review/${sceneId}`, {
      method: "POST",
      body: JSON.stringify({ decision: "approved", note: "Opening beat is aligned." }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    })

    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      task: {
        status: string
        reviewStage: string | null
        pendingReviewCount: number
      }
      detail: {
        scenes: Array<{
          id: string
          reviewStatus: string
          reviewNote?: string
          reviewedAt?: string
        }>
      }
    }

    expect(payload.task.status).toBe("waiting_review")
    expect(payload.task.reviewStage).toBe("storyboard_review")
    expect(payload.task.pendingReviewCount).toBeGreaterThan(0)
    expect(payload.detail.scenes[0]?.id).toBe(sceneId)
    expect(payload.detail.scenes[0]?.reviewStatus).toBe("approved")
    expect(payload.detail.scenes[0]?.reviewNote).toBe("Opening beat is aligned.")
    expect(payload.detail.scenes[0]?.reviewedAt).toEqual(expect.any(String))
  })

  it("persists keyframe review decisions and returns updated task detail", async () => {
    const { app, taskId, cookie } = await createAuthenticatedTask()
    const detailResponse = await app.request(`/api/tasks/${taskId}`, {
      headers: {
        Cookie: cookie,
      },
    })
    const detailPayload = (await detailResponse.json()) as {
      detail: {
        scenes: Array<{ id: string }>
      }
    }

    for (const scene of detailPayload.detail.scenes) {
      const storyboardResponse = await app.request(`/api/tasks/${taskId}/reviews/storyboard_review/${scene.id}`, {
        method: "POST",
        body: JSON.stringify({ decision: "approved" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
      })

      expect(storyboardResponse.status).toBe(200)
    }

    const sceneId = detailPayload.detail.scenes[1]?.id ?? detailPayload.detail.scenes[0]?.id

    const response = await app.request(`/api/tasks/${taskId}/reviews/keyframe_review/${sceneId}`, {
      method: "POST",
      body: JSON.stringify({ decision: "rejected", note: "Lighting still needs a softer highlight." }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    })

    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      task: {
        status: string
        reviewStage: string | null
        pendingReviewCount: number
      }
      detail: {
        scenes: Array<{
          id: string
          keyframeStatus: string
          keyframeReviewNote?: string
          keyframeReviewedAt?: string
        }>
      }
    }

    const reviewedScene = payload.detail.scenes.find((scene) => scene.id === sceneId)
    expect(payload.task.status).toBe("waiting_review")
    expect(payload.task.reviewStage).toBe("keyframe_review")
    expect(payload.task.pendingReviewCount).toBeGreaterThan(0)
    expect(reviewedScene?.keyframeStatus).toBe("rejected")
    expect(reviewedScene?.keyframeReviewNote).toBe("Lighting still needs a softer highlight.")
    expect(reviewedScene?.keyframeReviewedAt).toEqual(expect.any(String))
  })
})
