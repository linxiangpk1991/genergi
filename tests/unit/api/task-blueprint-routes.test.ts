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

describe("API task blueprint routes", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
    process.env.GENERGI_SESSION_SECRET = "test-secret"
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
    enqueueTaskMock.mockResolvedValue({
      queued: true,
      jobId: "job_resume_1",
      reason: "resume_after_blueprint_approval",
      continueExecution: true,
    })
    assertQueueAvailableMock.mockResolvedValue(undefined)
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

  it("creates a new blueprint version and returns the current blueprint bundle", async () => {
    const { app, taskId, cookie } = await createAuthenticatedTask()

    const createResponse = await app.request(`/api/tasks/${taskId}/blueprints`, {
      method: "POST",
      body: JSON.stringify({
        blueprint: {
          globalTheme: "Desk setup refresh",
          visualStyleGuide: "Premium silver, soft daylight, crisp desk reflections",
          subjectProfile: "Single hero product",
          productProfile: "Fast charging dock",
          backgroundConstraints: ["clean desk"],
          negativeConstraints: ["no subtitles"],
          totalVoiceoverScript: "Show the clutter, reveal the product, end with the clean setup.",
          sceneContracts: [
            {
              id: "scene_1",
              index: 0,
              sceneGoal: "Open on desk clutter",
              voiceoverScript: "Your desk starts like this.",
              startFrameDescription: "Cable clutter on desk",
              imagePrompt: "Vertical product ad frame, cable clutter on desk",
              videoPrompt: "Slow push-in over the clutter before the product appears",
              startFrameIntent: "Introduce the problem",
              endFrameIntent: "Hold the problem state",
              durationSec: 5,
              transitionHint: "hard cut",
              continuityConstraints: ["product hidden"],
            },
          ],
        },
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    })
    expect(createResponse.status).toBe(201)
    const createPayload = (await createResponse.json()) as {
      blueprint: { version: number; status: string }
    }
    expect(createPayload.blueprint.version).toBe(2)
    expect(createPayload.blueprint.status).toBe("ready_for_review")

    const listResponse = await app.request(`/api/tasks/${taskId}/blueprints`, {
      headers: { Cookie: cookie },
    })
    expect(listResponse.status).toBe(200)
    const listPayload = (await listResponse.json()) as {
      blueprints: Array<{ version: number; status: string; blueprint: { projectId: string } }>
    }
    expect(listPayload.blueprints).toHaveLength(2)
    expect(listPayload.blueprints.at(-1)?.version).toBe(2)
    expect(listPayload.blueprints.at(-1)?.status).toBe("ready_for_review")
    expect(listPayload.blueprints.at(-1)?.blueprint.projectId).toBe("project_default")

    const currentResponse = await app.request(`/api/tasks/${taskId}/blueprints/current`, {
      headers: { Cookie: cookie },
    })
    expect(currentResponse.status).toBe(200)
    const currentPayload = (await currentResponse.json()) as {
      blueprint: { version: number; status: string }
      review: null
      nextStage: { canResumeExecution: boolean }
    }
    expect(currentPayload.blueprint.version).toBe(2)
    expect(currentPayload.blueprint.status).toBe("ready_for_review")
    expect(currentPayload.review).toBeNull()
    expect(currentPayload.nextStage.canResumeExecution).toBe(false)
  }, 10000)

  it("approves the current blueprint, syncs it, and exposes a separate resume step", async () => {
    const { app, taskId, cookie } = await createAuthenticatedTask()

    await app.request(`/api/tasks/${taskId}/blueprints`, {
      method: "POST",
      body: JSON.stringify({
        blueprint: {
          globalTheme: "Desk setup refresh",
          visualStyleGuide: "Premium silver, soft daylight, crisp desk reflections",
          subjectProfile: "Single hero product",
          productProfile: "Fast charging dock",
          backgroundConstraints: ["clean desk"],
          negativeConstraints: ["no subtitles"],
          totalVoiceoverScript: "Show the clutter, reveal the product, end with the clean setup.",
          sceneContracts: [
            {
              id: "scene_1",
              index: 0,
              sceneGoal: "Open on desk clutter",
              voiceoverScript: "Your desk starts like this.",
              startFrameDescription: "Cable clutter on desk",
              imagePrompt: "Vertical product ad frame, cable clutter on desk",
              videoPrompt: "Slow push-in over the clutter before the product appears",
              startFrameIntent: "Introduce the problem",
              endFrameIntent: "Hold the problem state",
              durationSec: 5,
              transitionHint: "hard cut",
              continuityConstraints: ["product hidden"],
            },
          ],
        },
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    })

    const response = await app.request(`/api/tasks/${taskId}/blueprints/2/review`, {
      method: "POST",
      body: JSON.stringify({ decision: "approved", note: "整体通过" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      blueprint: { status: string }
      review: { decision: string }
      projectLibraryEntry: { projectId: string; blueprintVersion: number }
      nextStage: { canResumeExecution: boolean; resumePath: string | null }
    }

    expect(payload.blueprint.status).toBe("approved")
    expect(payload.review.decision).toBe("approved")
    expect(payload.projectLibraryEntry.projectId).toBe("project_default")
    expect(payload.projectLibraryEntry.blueprintVersion).toBe(2)
    expect(payload.nextStage.canResumeExecution).toBe(true)
    expect(payload.nextStage.resumePath).toBe(`/api/tasks/${taskId}/blueprints/current/resume`)
    expect(enqueueTaskMock).not.toHaveBeenCalled()

    const resumeResponse = await app.request(`/api/tasks/${taskId}/blueprints/current/resume`, {
      method: "POST",
      headers: {
        Cookie: cookie,
      },
    })

    expect(resumeResponse.status).toBe(202)
    const resumePayload = (await resumeResponse.json()) as {
      blueprint: { status: string }
      queue: { queued: boolean; reason: string; continueExecution: boolean }
      nextStage: { canResumeExecution: boolean }
    }

    expect(resumePayload.blueprint.status).toBe("queued_for_video")
    expect(resumePayload.queue).toMatchObject({
      queued: true,
      reason: "resume_after_blueprint_approval",
      continueExecution: true,
    })
    expect(resumePayload.nextStage.canResumeExecution).toBe(false)
    expect(enqueueTaskMock).toHaveBeenCalledWith(taskId, {
      reason: "resume_after_blueprint_approval",
      continueExecution: true,
      blueprintVersion: 2,
      stage: "video_generation",
    })
  }, 10000)
})
