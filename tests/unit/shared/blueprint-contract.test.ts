import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  blueprintStatusSchema,
  executionBlueprintSchema,
  executionModeSchema,
  projectRecordSchema,
  renderSpecSchema,
  taskBlueprintRecordSchema,
  taskBlueprintReviewRecordSchema,
  terminalPresetIdSchema,
  writeProjectApprovedBlueprintLibrary,
  writeProjects,
  writeTaskBlueprintRecords,
  writeTaskBlueprintReviewRecords,
  readProjectApprovedBlueprintLibrary,
  readProjects,
  readTaskBlueprintRecords,
  readTaskBlueprintReviewRecords,
} from "../../../packages/shared/src/index"
import {
  CHANNEL_DEFAULT_TERMINAL_PRESETS,
  MODE_MODELS,
  TERMINAL_PRESETS,
  resolveRenderSpec,
} from "../../../packages/config/src/index"

describe("blueprint contracts and render presets", () => {
  let dataDir = ""

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-blueprint-contract-"))
    process.env.GENERGI_DATA_DIR = dataDir
  })

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
  })

  it("defines execution mode, terminal presets, render spec, and blueprint schemas", () => {
    expect(executionModeSchema.options).toEqual(["automated", "review_required"])
    expect(terminalPresetIdSchema.options).toEqual([
      "phone_portrait",
      "phone_landscape",
      "tablet_portrait",
      "tablet_landscape",
    ])
    expect(blueprintStatusSchema.options).toContain("ready_for_review")

    const renderSpec = renderSpecSchema.parse({
      terminalPresetId: "phone_portrait",
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
      compositionGuideline: "主体居中",
      motionGuideline: "轻推拉",
    })

    expect(renderSpec.width).toBe(1080)

    const blueprint = executionBlueprintSchema.parse({
      taskId: "task_demo",
      projectId: "project_demo",
      version: 1,
      createdAt: "2026-04-20T00:00:00.000Z",
      executionMode: "review_required",
      renderSpec,
      globalTheme: "科技整洁桌面",
      visualStyleGuide: "冷色高级科技感",
      subjectProfile: "单主体产品展示",
      productProfile: "多合一充电器",
      backgroundConstraints: ["桌面整洁"],
      negativeConstraints: ["无字幕", "无水印"],
      totalVoiceoverScript: "完整旁白稿",
      sceneContracts: [
        {
          id: "scene_1",
          index: 0,
          sceneGoal: "建立问题场景",
          voiceoverScript: "桌面很乱。",
          startFrameDescription: "凌乱桌面开场",
          imagePrompt: "手机竖屏，凌乱桌面，充电线缠绕。",
          videoPrompt: "从输入图片开始，镜头缓慢推进，强调凌乱感。",
          startFrameIntent: "问题建立",
          endFrameIntent: "停留在凌乱状态",
          durationSec: 5,
          transitionHint: "open",
          continuityConstraints: ["主体不变"],
        },
      ],
    })

    expect(blueprint.sceneContracts[0]?.imagePrompt).toContain("手机竖屏")
    expect(projectRecordSchema.shape.id).toBeTruthy()
    expect(taskBlueprintRecordSchema.shape.blueprint).toBeTruthy()
    expect(taskBlueprintReviewRecordSchema.shape.decision).toBeTruthy()
  })

  it("exposes mode execution defaults and terminal preset mapping", () => {
    expect(MODE_MODELS.mass_production.executionMode).toBe("automated")
    expect(MODE_MODELS.high_quality.executionMode).toBe("review_required")
    expect(CHANNEL_DEFAULT_TERMINAL_PRESETS.tiktok).toBe("phone_portrait")
    expect(TERMINAL_PRESETS.phone_portrait.width).toBe(1080)
    expect(resolveRenderSpec("tablet_landscape").height).toBe(1536)
  })

  it("persists projects, blueprint records, review records, and approved library entries", async () => {
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

    const renderSpec = resolveRenderSpec("phone_portrait")
    const blueprint = {
      taskId: "task_demo",
      projectId: "project_demo",
      version: 1,
      createdAt: "2026-04-20T00:00:00.000Z",
      executionMode: "review_required" as const,
      renderSpec,
      globalTheme: "科技整洁桌面",
      visualStyleGuide: "冷色高级科技感",
      subjectProfile: "单主体产品展示",
      productProfile: "多合一充电器",
      backgroundConstraints: ["桌面整洁"],
      negativeConstraints: ["无字幕", "无水印"],
      totalVoiceoverScript: "完整旁白稿",
      sceneContracts: [
        {
          id: "scene_1",
          index: 0,
          sceneGoal: "建立问题场景",
          voiceoverScript: "桌面很乱。",
          startFrameDescription: "凌乱桌面开场",
          imagePrompt: "手机竖屏，凌乱桌面，充电线缠绕。",
          videoPrompt: "从输入图片开始，镜头缓慢推进，强调凌乱感。",
          startFrameIntent: "问题建立",
          endFrameIntent: "停留在凌乱状态",
          durationSec: 5,
          transitionHint: "open",
          continuityConstraints: ["主体不变"],
        },
      ],
    }

    await writeTaskBlueprintRecords({
      task_demo: [
        {
          taskId: "task_demo",
          version: 1,
          status: "ready_for_review",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
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
          decidedAt: "2026-04-20T00:05:00.000Z",
        },
      ],
    })

    await writeProjectApprovedBlueprintLibrary({
      project_demo: [
        {
          projectId: "project_demo",
          taskId: "task_demo",
          blueprintVersion: 1,
          approvedAt: "2026-04-20T00:05:00.000Z",
          blueprint,
        },
      ],
    })

    expect((await readProjects())).toHaveLength(1)
    expect((await readTaskBlueprintRecords()).task_demo).toHaveLength(1)
    expect((await readTaskBlueprintReviewRecords()).task_demo?.[0]?.decision).toBe("approved")
    expect((await readProjectApprovedBlueprintLibrary()).project_demo?.[0]?.blueprintVersion).toBe(1)
  })
})
