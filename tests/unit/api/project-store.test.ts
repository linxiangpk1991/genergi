import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

describe("API project store", () => {
  let dataDir = ""

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
    dataDir = ""
    vi.resetModules()
  })

  it("seeds a default project when the store is empty", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-project-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/project-store")
    const projects = await store.listProjects()

    expect(projects).toHaveLength(1)
    expect(projects[0]?.id).toBe("project_default")
    expect(projects[0]?.defaultChannelIds).toContain("tiktok")
  })

  it("creates a project and reads project library entries", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-project-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/project-store")
    const shared = await import("../../../packages/shared/src/index")
    const project = await store.createProject({
      name: "Tablet Campaign",
      description: "Campaign project",
      defaultChannelIds: ["reels"],
      reusableStyleConstraints: ["产品居中"],
    })

    await shared.writeProjectApprovedBlueprintLibrary({
      [project.id]: [
        {
          projectId: project.id,
          taskId: "task_demo",
          blueprintVersion: 1,
          approvedAt: "2026-04-20T00:00:00.000Z",
          blueprint: {
            taskId: "task_demo",
            projectId: project.id,
            version: 1,
            createdAt: "2026-04-20T00:00:00.000Z",
            executionMode: "review_required",
            renderSpec: shared.renderSpecSchema.parse({
              terminalPresetId: "phone_portrait",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
              compositionGuideline: "主体居中",
              motionGuideline: "轻推拉",
            }),
            globalTheme: "科技感",
            visualStyleGuide: "统一冷色调",
            subjectProfile: "单主体",
            productProfile: "充电器",
            backgroundConstraints: [],
            negativeConstraints: [],
            totalVoiceoverScript: "完整旁白",
            sceneContracts: [
              {
                id: "scene_1",
                index: 0,
                sceneGoal: "开场",
                voiceoverScript: "开场旁白",
                startFrameDescription: "开场画面",
                imagePrompt: "图片提示词",
                videoPrompt: "视频提示词",
                startFrameIntent: "起始",
                endFrameIntent: "结束",
                durationSec: 5,
                transitionHint: "open",
                continuityConstraints: [],
              },
            ],
          },
        },
      ],
    })

    const library = await store.listProjectApprovedBlueprints(project.id)

    expect(project.id).toContain("project_")
    expect(library).toHaveLength(1)
    expect(library[0]?.taskId).toBe("task_demo")
  })
})
