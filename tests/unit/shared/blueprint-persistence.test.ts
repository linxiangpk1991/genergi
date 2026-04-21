import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  readProjectApprovedBlueprintLibrary,
  readProjects,
  readTaskBlueprintRecords,
  readTaskBlueprintReviewRecords,
  writeProjectApprovedBlueprintLibrary,
  writeProjects,
  writeTaskBlueprintRecords,
  writeTaskBlueprintReviewRecords,
} from "../../../packages/shared/src/index"
import { buildRenderSpec } from "../../../packages/config/src/index"

describe("blueprint persistence", () => {
  let dataDir = ""

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-blueprint-persistence-"))
    process.env.GENERGI_DATA_DIR = dataDir
  })

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
  })

  it("round-trips project, blueprint, review, and approved library records", async () => {
    const renderSpec = buildRenderSpec("phone_portrait")
    const blueprint = {
      taskId: "task_demo",
      projectId: "project_demo",
      version: 1,
      createdAt: "2026-04-20T00:00:00.000Z",
      executionMode: "review_required" as const,
      renderSpec,
      globalTheme: "科技桌面",
      visualStyleGuide: "高级科技感",
      subjectProfile: "单主体产品展示",
      productProfile: "多合一充电器",
      backgroundConstraints: ["桌面整洁"],
      negativeConstraints: ["无字幕"],
      totalVoiceoverScript: "完整旁白稿",
      sceneContracts: [
        {
          id: "scene_1",
          index: 0,
          sceneGoal: "建立问题",
          voiceoverScript: "桌面很乱。",
          startFrameDescription: "凌乱桌面",
          imagePrompt: "手机竖屏，凌乱桌面。",
          videoPrompt: "从输入图片开始缓慢推进。",
          startFrameIntent: "建立问题",
          endFrameIntent: "停在凌乱状态",
          durationSec: 5,
          transitionHint: "open",
          continuityConstraints: ["产品未出现"],
        },
      ],
    }

    await writeProjects([
      {
        id: "project_demo",
        name: "Demo Project",
        description: "demo",
        brandDirection: "科技感",
        defaultChannelIds: ["tiktok"],
        reusableStyleConstraints: ["主体统一"],
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
    ])
    await writeTaskBlueprintRecords({
      task_demo: [
        {
          taskId: "task_demo",
          version: 1,
          status: "ready_for_review",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:01:00.000Z",
          blueprint,
          keyframeManifestPath: "exports/task_demo/keyframes/manifest.json",
        },
      ],
    })
    await writeTaskBlueprintReviewRecords({
      task_demo: [
        {
          taskId: "task_demo",
          blueprintVersion: 1,
          decision: "approved",
          note: "通过",
          decidedAt: "2026-04-20T00:02:00.000Z",
        },
      ],
    })
    await writeProjectApprovedBlueprintLibrary({
      project_demo: [
        {
          projectId: "project_demo",
          taskId: "task_demo",
          blueprintVersion: 1,
          approvedAt: "2026-04-20T00:02:00.000Z",
          blueprint,
        },
      ],
    })

    expect((await readProjects())[0]?.id).toBe("project_demo")
    expect((await readTaskBlueprintRecords()).task_demo?.[0]?.status).toBe("ready_for_review")
    expect((await readTaskBlueprintReviewRecords()).task_demo?.[0]?.decision).toBe("approved")
    expect((await readProjectApprovedBlueprintLibrary()).project_demo?.[0]?.blueprint.sceneContracts).toHaveLength(1)
  })
})
