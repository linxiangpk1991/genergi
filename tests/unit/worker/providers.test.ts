import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mergeSceneReviewMetadata, replaceProviderRecords, type TaskDetail } from "@genergi/shared"

describe("worker provider helpers", () => {
  let tempDir = ""

  function createTaskDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
    return {
      taskId: "task_review_preservation",
      projectId: "project_default",
      title: "Desk charger launch",
      script: "Hook the viewer fast. Reveal the desk upgrade. End with a clear CTA.",
      taskRunConfig: {
        projectId: "project_default",
        modeId: "high_quality",
        executionMode: "review_required",
        channelId: "reels",
        terminalPresetId: "phone_portrait",
        renderSpecJson: {
          terminalPresetId: "phone_portrait",
          width: 1080,
          height: 1920,
          aspectRatio: "9:16",
          safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
          compositionGuideline: "主体保持在竖屏中心安全区",
          motionGuideline: "优先轻推拉",
        },
        targetDurationSec: 15,
        generationMode: "system_enhanced",
        enhancementMode: "system_enhanced",
        generationRoute: "multi_scene",
        routeReason: "target duration exceeds the current model single-shot limit of 8s",
        planningVersion: "v1",
        blueprintVersion: 1,
        blueprintStatus: "pending_generation",
        textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
        imageModel: { id: "image.premium", label: "Gemini 3 Pro Image Preview 2k", provider: "openai-compatible" },
        videoModel: { id: "video.hd", label: "Veo 3.1 Portrait HD", provider: "openai-compatible" },
        ttsProvider: "edge-tts",
        contentLocale: "en",
        operatorLocale: "zh-CN",
        requireStoryboardReview: true,
        requireKeyframeReview: true,
        budgetLimitCny: 5,
        aspectRatio: "9:16",
        slotSnapshots: [],
      },
      blueprintVersion: 1,
      blueprintStatus: "pending_generation",
      scenes: [],
      updatedAt: "2026-04-19T00:00:00.000Z",
      ...overrides,
    }
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = ""
    }
  })

  it("constrains rewritten text into a plain voiceover script for a 15 second target", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const script = providers.normalizeRewriteToVoiceoverScript(
      `Here's a tighter, platform-native rewrite:

**Hook (0-2s):** Call out the pain point hard.

**CTA (13-15s):** Grab yours before it's gone.

A few notes to make it hit:
- Lead with tension
- Keep it under 15 seconds`,
      15,
    )

    expect(script).not.toContain("A few notes")
    expect(script).not.toContain("**")
    expect(script.split(/\s+/).length).toBeLessThanOrEqual(33)
    expect(script).toContain("Call out the pain point hard")
  })

  it("preserves review metadata when rewrite rebuilds scenes with matching stable ids", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const detail = createTaskDetail({
      scenes: [
        {
          id: "scene_1",
          index: 0,
          title: "Legacy hook",
          script: "Legacy hook.",
          imagePrompt: "Legacy hook image.",
          videoPrompt: "Legacy hook video.",
          durationSec: 8,
          startLabel: "00:00",
          endLabel: "00:08",
          reviewStatus: "rejected",
          keyframeStatus: "approved",
          reviewNote: "Hook still needs stronger contrast.",
          reviewedAt: "2026-04-19T01:00:00.000Z",
          keyframeReviewNote: "Keyframe composition is approved.",
          keyframeReviewedAt: "2026-04-19T02:00:00.000Z",
        },
        {
          id: "scene_2",
          index: 1,
          title: "Legacy CTA",
          script: "Legacy CTA.",
          imagePrompt: "Legacy CTA image.",
          videoPrompt: "Legacy CTA video.",
          durationSec: 7,
          startLabel: "00:08",
          endLabel: "00:15",
          reviewStatus: "approved",
          keyframeStatus: "rejected",
          reviewNote: "Approved after copy tweak.",
          reviewedAt: "2026-04-19T03:00:00.000Z",
          keyframeReviewNote: "Need a cleaner final frame.",
          keyframeReviewedAt: "2026-04-19T04:00:00.000Z",
        },
      ] as TaskDetail["scenes"],
    }) as TaskDetail & {
      scenes: Array<
        TaskDetail["scenes"][number] & {
          reviewNote?: string
          reviewedAt?: string
          keyframeReviewNote?: string
          keyframeReviewedAt?: string
        }
      >
    }

    const rewritten = (await providers.rewriteTaskWithTextProvider(detail)) as typeof detail

    expect(rewritten.scenes).toHaveLength(2)
    expect(rewritten.scenes[0].reviewStatus).toBe("rejected")
    expect(rewritten.scenes[0].keyframeStatus).toBe("approved")
    expect(rewritten.scenes[0].reviewNote).toBe("Hook still needs stronger contrast.")
    expect(rewritten.scenes[0].reviewedAt).toBe("2026-04-19T01:00:00.000Z")
    expect(rewritten.scenes[0].keyframeReviewNote).toBe("Keyframe composition is approved.")
    expect(rewritten.scenes[0].keyframeReviewedAt).toBe("2026-04-19T02:00:00.000Z")
    expect(rewritten.scenes[1].reviewStatus).toBe("approved")
    expect(rewritten.scenes[1].keyframeStatus).toBe("rejected")
    expect(rewritten.scenes[1].reviewNote).toBe("Approved after copy tweak.")
    expect(rewritten.scenes[1].keyframeReviewNote).toBe("Need a cleaner final frame.")
  })

  it("falls back to scene index when rewrite scene ids change", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const detail = createTaskDetail({
      scenes: [
        {
          id: "legacy_hook",
          index: 0,
          title: "Legacy hook",
          script: "Legacy hook.",
          imagePrompt: "Legacy hook image.",
          videoPrompt: "Legacy hook video.",
          durationSec: 8,
          startLabel: "00:00",
          endLabel: "00:08",
          reviewStatus: "approved",
          keyframeStatus: "rejected",
          reviewNote: "Keep the opener pacing.",
          reviewedAt: "2026-04-19T05:00:00.000Z",
          keyframeReviewNote: "Keyframe needs a cleaner crop.",
          keyframeReviewedAt: "2026-04-19T06:00:00.000Z",
        },
        {
          id: "legacy_cta",
          index: 1,
          title: "Legacy CTA",
          script: "Legacy CTA.",
          imagePrompt: "Legacy CTA image.",
          videoPrompt: "Legacy CTA video.",
          durationSec: 7,
          startLabel: "00:08",
          endLabel: "00:15",
          reviewStatus: "rejected",
          keyframeStatus: "approved",
          reviewNote: "CTA needs a stronger ask.",
          reviewedAt: "2026-04-19T07:00:00.000Z",
          keyframeReviewNote: "Final keyframe is ready.",
          keyframeReviewedAt: "2026-04-19T08:00:00.000Z",
        },
      ] as TaskDetail["scenes"],
    }) as TaskDetail & {
      scenes: Array<
        TaskDetail["scenes"][number] & {
          reviewNote?: string
          reviewedAt?: string
          keyframeReviewNote?: string
          keyframeReviewedAt?: string
        }
      >
    }

    const rewritten = (await providers.rewriteTaskWithTextProvider(detail)) as typeof detail

    expect(rewritten.scenes.map((scene) => scene.id)).toEqual(["scene_1", "scene_2"])
    expect(rewritten.scenes[0].reviewStatus).toBe("approved")
    expect(rewritten.scenes[0].keyframeStatus).toBe("rejected")
    expect(rewritten.scenes[0].reviewNote).toBe("Keep the opener pacing.")
    expect(rewritten.scenes[0].keyframeReviewNote).toBe("Keyframe needs a cleaner crop.")
    expect(rewritten.scenes[1].reviewStatus).toBe("rejected")
    expect(rewritten.scenes[1].keyframeStatus).toBe("approved")
    expect(rewritten.scenes[1].reviewNote).toBe("CTA needs a stronger ask.")
    expect(rewritten.scenes[1].reviewedAt).toBe("2026-04-19T07:00:00.000Z")
    expect(rewritten.scenes[1].keyframeReviewedAt).toBe("2026-04-19T08:00:00.000Z")
  })

  it("merges latest persisted review metadata back into rewritten scenes for worker upserts", () => {
    const rewrittenScenes = [
      {
        id: "scene_1",
        index: 0,
        title: "New hook",
        script: "New hook.",
        imagePrompt: "New hook image.",
        videoPrompt: "New hook video.",
        durationSec: 8,
        startLabel: "00:00",
        endLabel: "00:08",
        reviewStatus: "pending" as const,
        keyframeStatus: "pending" as const,
      },
      {
        id: "scene_2_rebuilt",
        index: 1,
        title: "New CTA",
        script: "New CTA.",
        imagePrompt: "New CTA image.",
        videoPrompt: "New CTA video.",
        durationSec: 7,
        startLabel: "00:08",
        endLabel: "00:15",
        reviewStatus: "pending" as const,
        keyframeStatus: "pending" as const,
      },
    ]

    const persistedScenes = [
      {
        id: "scene_1",
        index: 0,
        reviewStatus: "approved" as const,
        keyframeStatus: "rejected" as const,
        reviewNote: "Opening beat approved.",
        reviewedAt: "2026-04-19T09:00:00.000Z",
        keyframeReviewNote: "Keyframe needs more contrast.",
        keyframeReviewedAt: "2026-04-19T10:00:00.000Z",
      },
      {
        id: "scene_2",
        index: 1,
        reviewStatus: "rejected" as const,
        keyframeStatus: "approved" as const,
        reviewNote: "CTA copy still needs work.",
        reviewedAt: "2026-04-19T11:00:00.000Z",
        keyframeReviewNote: "Final frame is approved.",
        keyframeReviewedAt: "2026-04-19T12:00:00.000Z",
      },
    ]

    const merged = mergeSceneReviewMetadata(rewrittenScenes, persistedScenes)

    expect(merged[0].reviewStatus).toBe("approved")
    expect(merged[0].keyframeStatus).toBe("rejected")
    expect(merged[0].reviewNote).toBe("Opening beat approved.")
    expect(merged[0].keyframeReviewNote).toBe("Keyframe needs more contrast.")
    expect(merged[1].reviewStatus).toBe("rejected")
    expect(merged[1].keyframeStatus).toBe("approved")
    expect(merged[1].reviewNote).toBe("CTA copy still needs work.")
    expect(merged[1].reviewedAt).toBe("2026-04-19T11:00:00.000Z")
    expect(merged[1].keyframeReviewedAt).toBe("2026-04-19T12:00:00.000Z")
  })

  it("builds planned execution blueprints from planning output with render-spec aware prompts", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const detail = createTaskDetail()
    const blueprint = providers.buildPlannedExecutionBlueprint(detail, {
      generationRoute: "multi_scene",
      targetDurationSec: 15,
      finalVoiceoverScript: "Hook. Reveal. CTA.",
      visualStyleGuide: "Premium vertical composition.",
      ctaLine: "Upgrade today.",
      scenePlan: [
        {
          sceneIndex: 0,
          scenePurpose: "Open on the problem",
          durationSec: 5,
          script: "The desk starts cluttered.",
          voiceoverScript: "The desk starts cluttered.",
          startFrameDescription: "Cluttered desk opening frame",
          imagePrompt: "Phone portrait 1080x1920, cluttered desk, centered subject.",
          videoPrompt: "Use the input frame and slowly push into the clutter before reveal.",
          startFrameIntent: "Introduce the problem",
          endFrameIntent: "Hold on clutter",
          transitionHint: "open",
          continuityConstraints: ["product hidden"],
        },
      ],
      blueprint: {
        executionMode: "review_required",
        renderSpec: detail.taskRunConfig.renderSpecJson,
        globalTheme: "Desk refresh",
        visualStyleGuide: "Premium vertical composition.",
        subjectProfile: "Single desk hero",
        productProfile: "Fast charging dock",
        backgroundConstraints: ["clean desk"],
        negativeConstraints: ["no subtitles"],
        totalVoiceoverScript: "Hook. Reveal. CTA.",
        sceneContracts: [],
      },
    })

    expect(blueprint.renderSpec.width).toBe(1080)
    expect(blueprint.renderSpec.height).toBe(1920)
    expect(blueprint.sceneContracts[0]?.imagePrompt).toContain("1080x1920")
    expect(blueprint.sceneContracts[0]?.videoPrompt).toContain("input frame")
    expect(blueprint.sceneContracts[0]?.imagePrompt).toContain("subject anchor: Single desk hero")
    expect(blueprint.sceneContracts[0]?.videoPrompt).toContain("background anchor: clean desk")
    expect(blueprint.sceneContracts[0]?.videoPrompt).toContain("negative constraints: no subtitles")
    expect(blueprint.sceneContracts[0]?.videoPrompt).toContain("continuity constraints: product hidden")
  })

  it("builds scene video inputs from keyframe manifests and falls back honestly when frames are missing", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    tempDir = await mkdtemp(path.join(os.tmpdir(), "genergi-scene-video-inputs-"))
    const manifestPath = path.join(tempDir, "manifest.json")
    const keyframePath = path.join(tempDir, "scene-01.png")

    await writeFile(keyframePath, "png", "utf8")
    await writeFile(
      manifestPath,
      JSON.stringify({
        frames: [
          {
            sceneId: "scene_1",
            sceneIndex: 0,
            filePath: keyframePath,
          },
        ],
      }),
      "utf8",
    )

    const detail = createTaskDetail({
      scenes: [
        {
          id: "scene_1",
          index: 0,
          title: "Hook",
          sceneGoal: "Hook",
          voiceoverScript: "Desk clutter.",
          startFrameDescription: "Cluttered desk",
          script: "Desk clutter.",
          imagePrompt: "clutter prompt",
          videoPrompt: "motion prompt",
          startFrameIntent: "introduce clutter",
          endFrameIntent: "hold clutter",
          durationSec: 8,
          startLabel: "00:00",
          endLabel: "00:08",
          reviewStatus: "pending",
          keyframeStatus: "pending",
          continuityConstraints: ["same desk"],
          reviewNote: null,
          reviewedAt: null,
          keyframeReviewNote: null,
          keyframeReviewedAt: null,
        },
        {
          id: "scene_2",
          index: 1,
          title: "Reveal",
          sceneGoal: "Reveal",
          voiceoverScript: "Show the charger.",
          startFrameDescription: "Product reveal",
          script: "Show the charger.",
          imagePrompt: "reveal prompt",
          videoPrompt: "reveal motion",
          startFrameIntent: "introduce product",
          endFrameIntent: "hold reveal",
          durationSec: 7,
          startLabel: "00:08",
          endLabel: "00:15",
          reviewStatus: "pending",
          keyframeStatus: "pending",
          continuityConstraints: ["same product"],
          reviewNote: null,
          reviewedAt: null,
          keyframeReviewNote: null,
          keyframeReviewedAt: null,
        },
      ],
    })

    const inputs = await providers.buildSceneVideoGenerationInputs({
      detail,
      blueprintRecord: {
        taskId: detail.taskId,
        version: 1,
        status: "queued_for_video",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
        blueprint: {
          taskId: detail.taskId,
          projectId: detail.projectId,
          version: 1,
          createdAt: "2026-04-20T00:00:00.000Z",
          executionMode: detail.taskRunConfig.executionMode,
          renderSpec: detail.taskRunConfig.renderSpecJson,
          globalTheme: detail.title,
          visualStyleGuide: "Premium vertical composition.",
          subjectProfile: "Single desk hero",
          productProfile: "Fast charging dock",
          backgroundConstraints: ["clean desk"],
          negativeConstraints: ["no subtitles"],
          totalVoiceoverScript: detail.script,
          sceneContracts: detail.scenes.map((scene) => ({
            id: scene.id,
            index: scene.index,
            sceneGoal: scene.sceneGoal ?? scene.title,
            voiceoverScript: scene.voiceoverScript ?? scene.script,
            startFrameDescription: scene.startFrameDescription ?? scene.title,
            imagePrompt: scene.imagePrompt,
            videoPrompt: scene.videoPrompt,
            startFrameIntent: scene.startFrameIntent ?? scene.title,
            endFrameIntent: scene.endFrameIntent ?? scene.title,
            durationSec: scene.durationSec,
            transitionHint: "cut",
            continuityConstraints: scene.continuityConstraints ?? [],
          })),
        },
        keyframeManifestPath: manifestPath,
      },
    })

    expect(inputs[0]?.inputStrategy).toBe("keyframe_plus_prompt")
    expect(inputs[0]?.keyframePath).toBe(keyframePath)
    expect(inputs[1]?.inputStrategy).toBe("prompt_only")
    expect(inputs[1]?.keyframePath).toBeNull()
  })

  it("prefers the text model's final scene scripts and prompts when they are already structured", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const baseScenes = [
      {
        id: "scene_1",
        index: 0,
        title: "Scene 1",
        sceneGoal: "Scene 1",
        voiceoverScript: "Explain the BaZi cycle.",
        startFrameDescription: "A calm Chinese-style reading desk.",
        script: "Explain the BaZi cycle.",
        imagePrompt: "Explain the BaZi cycle. Create a 9:16 key visual that matches this exact beat of the script.",
        videoPrompt: "Explain the BaZi cycle. Generate a 9:16 short-form social video shot for this exact script beat.",
        startFrameIntent: "Explain the cycle",
        endFrameIntent: "Hold on the reading desk",
        durationSec: 8,
        startLabel: "00:00",
        endLabel: "00:08",
        reviewStatus: "pending" as const,
        keyframeStatus: "pending" as const,
        continuityConstraints: ["same room"],
        reviewNote: null,
        reviewedAt: null,
        keyframeReviewNote: null,
        keyframeReviewedAt: null,
      },
    ]

    const canonical = providers.buildCanonicalScenePlanFromBaseScenes(baseScenes as any, {
      generationRoute: "multi_scene",
      targetDurationSec: 8,
      finalVoiceoverScript: "Explain the BaZi cycle.",
      visualStyleGuide: "Preserve original tone.",
      ctaLine: "Link in bio.",
      scenePlan: [
        {
          sceneIndex: 0,
          scenePurpose: "Show a panda mascot selling desk products",
          durationSec: 8,
          script: "Buy this desk lamp now.",
          voiceoverScript: "Buy this desk lamp now.",
          startFrameDescription: "Chinese-style room with a reader at a desk",
          imagePrompt: "A panda mascot with a desk lamp",
          videoPrompt: "Sell the desk lamp with flashy camera moves",
          startFrameIntent: "Sell product",
          endFrameIntent: "Close on product CTA",
          transitionHint: "open",
          continuityConstraints: ["same room"],
        },
      ],
      blueprint: {
        executionMode: "review_required",
        renderSpec: createTaskDetail().taskRunConfig.renderSpecJson,
        globalTheme: "BaZi",
        visualStyleGuide: "Preserve original tone.",
        subjectProfile: "Reader at desk",
        productProfile: "BaZi report",
        backgroundConstraints: ["Chinese-style room"],
        negativeConstraints: ["no product swap"],
        totalVoiceoverScript: "Explain the BaZi cycle.",
        sceneContracts: [],
      },
    })

    expect(canonical[0]?.script).toBe("Buy this desk lamp now.")
    expect(canonical[0]?.voiceoverScript).toBe("Buy this desk lamp now.")
    expect(canonical[0]?.imagePrompt).toBe("A panda mascot with a desk lamp")
    expect(canonical[0]?.videoPrompt).toBe("Sell the desk lamp with flashy camera moves")
    expect(canonical[0]?.startFrameDescription).toBe("Chinese-style room with a reader at a desk")
    expect(canonical[0]?.scenePurpose).toBe("Show a panda mascot selling desk products")
    expect(canonical[0]?.endFrameIntent).toBe("Close on product CTA")
  })

  it("applies structured planning output as the final narration and prompt contract instead of resetting to the source script", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const detail = createTaskDetail({
      script: "Original source script.",
      scenes: [
        {
          id: "scene_1",
          index: 0,
          title: "Scene 1",
          sceneGoal: "Scene 1",
          voiceoverScript: "Original source script.",
          startFrameDescription: "Original frame",
          script: "Original source script.",
          imagePrompt: "Original image prompt",
          videoPrompt: "Original video prompt",
          startFrameIntent: "Original start intent",
          endFrameIntent: "Original end intent",
          durationSec: 15,
          startLabel: "00:00",
          endLabel: "00:15",
          reviewStatus: "pending" as const,
          keyframeStatus: "pending" as const,
          continuityConstraints: ["same setting"],
          reviewNote: null,
          reviewedAt: null,
          keyframeReviewNote: null,
          keyframeReviewedAt: null,
        },
      ] as TaskDetail["scenes"],
    })

    const applied = providers.applyModelPlanningOutput(detail, {
      generationRoute: "single_shot",
      targetDurationSec: 15,
      finalVoiceoverScript: "Model-approved final narration.",
      visualStyleGuide: "Premium cinematic lighting.",
      ctaLine: "Tap to learn more.",
      scenePlan: [
        {
          sceneIndex: 0,
          scenePurpose: "Open with the strongest visual hook",
          durationSec: 15,
          script: "Model scene script.",
          voiceoverScript: "Model scene narration.",
          startFrameDescription: "A premium product hero shot.",
          imagePrompt: "Final polished image prompt from the text model.",
          videoPrompt: "Final polished video prompt from the text model.",
          startFrameIntent: "Hook instantly",
          endFrameIntent: "Land on the CTA",
          transitionHint: "close",
          continuityConstraints: ["same hero product"],
        },
      ],
      blueprint: {
        executionMode: "review_required",
        renderSpec: detail.taskRunConfig.renderSpecJson,
        globalTheme: "Hero product launch",
        visualStyleGuide: "Premium cinematic lighting.",
        subjectProfile: "Single hero product",
        productProfile: "Desk charger",
        backgroundConstraints: ["clean premium studio"],
        negativeConstraints: ["no subtitles"],
        totalVoiceoverScript: "Model-approved final narration.",
        sceneContracts: [],
      },
    })

    expect(applied.detail.script).toBe("Model-approved final narration.")
    expect(applied.detail.scenes[0]?.script).toBe("Model scene narration.")
    expect(applied.detail.scenes[0]?.voiceoverScript).toBe("Model scene narration.")
    expect(applied.blueprint.totalVoiceoverScript).toBe("Model-approved final narration.")
    expect(applied.blueprint.sceneContracts[0]?.imagePrompt).toContain("Final polished image prompt from the text model.")
    expect(applied.blueprint.sceneContracts[0]?.videoPrompt).toContain("Final polished video prompt from the text model.")
    expect(applied.blueprint.sceneContracts[0]?.videoPrompt).toContain("negative constraints: no subtitles")
  })

  it("strips markdown separators and drops trailing incomplete sentence fragments", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const script = providers.normalizeRewriteToVoiceoverScript(
      `---
Feel like you're falling behind? You scroll and everyone your age is buying houses, getting promoted, launching businesses.
And you're still figuring it out. You put in the work. You're trying to level up. But it feels like everyone's lapping you.
Here's the thing. In Chinese destiny analysis, there's a pattern called "late bloomer energy." People with this pattern spend their early years learning, stacking`,
      30,
    )

    expect(script.startsWith("---")).toBe(false)
    expect(script).not.toContain("learning, stacking")
    expect(/[.!?"]$/.test(script)).toBe(true)
    expect(script).toContain("Here's the thing.")
  })

  it("keeps the ending CTA instead of spending the whole budget on the opening hook", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const script = providers.normalizeRewriteToVoiceoverScript(
      `Feel like you're falling behind? You scroll and see people your age buying houses, landing promotions, launching businesses. And you're still figuring it out. You put in the work. You're trying to level up. But it feels like everyone's moving faster than you. Here's the thing. In Chinese destiny analysis, some people peak later. They build quietly before the breakthrough. When the window opens, they rise fast. If you want to know your own timing, check the link in bio.`,
      30,
    )

    expect(script).toContain("Feel like you're falling behind?")
    expect(script).toContain("check the link in bio")
    expect(script).toContain("some people peak later")
    expect(script.endsWith("bio.")).toBe(true)
  })

  it("computes a slower tts rate when generated narration is shorter than target duration", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    expect(providers.resolveTtsRateForTargetDuration(10, 15, 0)).toBeLessThan(0)
  })

  it("computes a faster tts rate when generated narration is longer than target duration", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    expect(providers.resolveTtsRateForTargetDuration(20, 15, 0)).toBeGreaterThan(0)
  })

  it("normalizes provider base urls before appending text or gemini api paths", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    expect(providers.resolveProviderApiBaseUrl("https://code.77code.fun/v1")).toBe("https://code.77code.fun")
    expect(providers.resolveProviderApiBaseUrl("https://code.77code.fun")).toBe("https://code.77code.fun")
    expect(providers.resolveProviderApiBaseUrl("https://code.77code.fun/v1/")).toBe("https://code.77code.fun")
  })

  it("normalizes legacy video aliases into gateway-supported upstream ids", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    expect(providers.normalizeVideoModel("video.draft")).toBe("veo3.1-fast")
    expect(providers.normalizeVideoModel("video.final")).toBe("veo3.1")
    expect(providers.normalizeVideoModel("video.hd")).toBe("veo3.1")
    expect(providers.normalizeVideoModel("veo3.1")).toBe("veo3.1")
  })

  it("resolves runtime generation models from the frozen unified task config", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const runtime = providers.resolveRuntimeGenerationConfig(createTaskDetail())

    expect(runtime.textModelId).toBe("text.default")
    expect(runtime.textProvider).toBe("anthropic-compatible")
    expect(runtime.imageModelId).toBe("image.premium")
    expect(runtime.videoModelId).toBe("video.hd")
    expect(runtime.ttsProvider).toBe("edge-tts")
  })

  it("formats a frozen runtime summary from task snapshot labels instead of static defaults", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const runtime = providers.resolveRuntimeGenerationConfig(
      createTaskDetail({
        taskRunConfig: {
          ...createTaskDetail().taskRunConfig,
          textModel: { id: "text.alt", label: "Claude Sonnet Runtime", provider: "anthropic-compatible" },
          imageModel: { id: "image.alt", label: "Gemini Runtime Image", provider: "openai-compatible" },
          videoModel: { id: "video.alt", label: "Veo Runtime Video", provider: "openai-compatible" },
          ttsProvider: "edge-tts",
        },
      }),
    )

    expect(providers.describeRuntimeGenerationConfig(runtime)).toContain("Claude Sonnet Runtime")
    expect(providers.describeRuntimeGenerationConfig(runtime)).toContain("Gemini Runtime Image")
    expect(providers.describeRuntimeGenerationConfig(runtime)).toContain("Veo Runtime Video")
    expect(providers.describeRuntimeGenerationConfig(runtime)).toContain("edge-tts")
  })

  it("builds worker asset labels from the frozen runtime snapshot", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const runtime = providers.resolveRuntimeGenerationConfig(
      createTaskDetail({
        taskRunConfig: {
          ...createTaskDetail().taskRunConfig,
          imageModel: { id: "image.alt", label: "Gemini Runtime Image", provider: "openai-compatible" },
          videoModel: { id: "video.alt", label: "Veo Runtime Video", provider: "openai-compatible" },
        },
      }),
    )

    const labels = providers.buildWorkerRuntimeLabels(runtime, {
      sceneCount: 2,
      targetDurationSec: 15,
      keyframeCount: 2,
    })

    expect(labels.audio).toContain("Edge TTS")
    expect(labels.keyframes).toContain("Gemini Runtime Image")
    expect(labels.video).toContain("Veo Runtime Video")
    expect(labels.video).toContain("15s")
  })

  it("rejects unsupported tts providers instead of silently falling back to edge tts", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    expect(() =>
      providers.resolveRuntimeGenerationConfig(
        createTaskDetail({
          taskRunConfig: {
            ...createTaskDetail().taskRunConfig,
            ttsProvider: "azure-tts",
          },
        }),
      ),
    ).toThrow(/Unsupported TTS provider/i)
  })

  it("builds a distinct fallback script for system-enhanced mode when structured planning fails", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const enhanced = providers.buildSystemEnhancedFallbackScript(
      "A wooden desk is messy with cables everywhere. A compact charger appears and instantly organizes the setup. The mood changes from stressed to calm. End by inviting viewers to upgrade their desk today.",
      15,
    )

    expect(enhanced).not.toContain("A wooden desk is messy with cables everywhere")
    expect(enhanced.toLowerCase()).toContain("upgrade")
    expect(enhanced.split(/\s+/).length).toBeLessThanOrEqual(33)
  })

  it("creates fallback keyframes for all scenes when image generation fails", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    tempDir = await mkdtemp(path.join(os.tmpdir(), "genergi-fallback-keyframes-"))
    process.env.GENERGI_DATA_DIR = tempDir

    const sceneVideos = [
      {
        sceneId: "scene_1",
        sceneIndex: 0,
        durationSec: 8,
        videoPath: path.join(tempDir, "scene-1.mp4"),
      },
      {
        sceneId: "scene_2",
        sceneIndex: 1,
        durationSec: 7,
        videoPath: path.join(tempDir, "scene-2.mp4"),
      },
    ]

    const scenes = [
      { id: "scene_1", index: 0, title: "Scene 1" },
      { id: "scene_2", index: 1, title: "Scene 2" },
    ]

    await writeFile(sceneVideos[0].videoPath, "video-1", "utf8")
    await writeFile(sceneVideos[1].videoPath, "video-2", "utf8")

    const result = await providers.createFallbackKeyframeBundleFromVideos(
      {
        taskId: "task_fallback_multi",
        scenes,
        sceneVideos,
      },
      {
        extractor: async ({ outputPath }) => {
          await writeFile(outputPath, "frame", "utf8")
        },
      },
    )

    expect(result.frameCount).toBe(2)
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      sceneCount: number
      frames: Array<{ sceneIndex: number; derivedFrom: string }>
    }
    expect(manifest.sceneCount).toBe(2)
    expect(manifest.frames).toHaveLength(2)
    expect(manifest.frames[0].sceneIndex).toBe(0)
    expect(manifest.frames[1].sceneIndex).toBe(1)
  })

  it("keeps review-gated keyframe generation on the long timeout path without fallback wording", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const policy = providers.resolveKeyframeGenerationTimeoutPolicy({
      detail: createTaskDetail({
        taskRunConfig: {
          ...createTaskDetail().taskRunConfig,
          executionMode: "review_required",
        },
      }),
      continueExecution: false,
    })

    expect(policy.timeoutMs).toBe(300000)
    expect(policy.onTimeoutMessage).toBe("Image generation timed out before review assets were ready")
  })

  it("keeps automated keyframe generation on the short fallback timeout path", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const policy = providers.resolveKeyframeGenerationTimeoutPolicy({
      detail: createTaskDetail({
        taskRunConfig: {
          ...createTaskDetail().taskRunConfig,
          executionMode: "automated",
        },
      }),
      continueExecution: false,
    })

    expect(policy.timeoutMs).toBe(30000)
    expect(policy.onTimeoutMessage).toBe("Image generation timeout, switching to video-derived keyframe")
  })

  it("writes planning trace files and exposes them as supporting assets", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    tempDir = await mkdtemp(path.join(os.tmpdir(), "genergi-planning-trace-assets-"))
    process.env.GENERGI_DATA_DIR = tempDir

    const detail = createTaskDetail({
      taskId: "task_trace_assets",
      script: "Final rewritten narration.",
    })

    const taskDir = await providers.writeTaskSourceFiles(detail, {
      sourceScript: "Original source script.",
      planningPrompt: "Full planning prompt.",
      planningResponse: "{\"finalVoiceoverScript\":\"Final rewritten narration.\"}",
      planningAudit: {
        provider: "anthropic-compatible",
        model: "claude-opus-4-6",
        usedFallback: false,
      },
    })

    const assets = await providers.buildTaskDocumentAssetRecords({
      taskId: detail.taskId,
      taskDir,
      createdAt: "2026-04-20T00:00:00.000Z",
    })

    expect(assets.map((asset) => asset.assetType)).toEqual([
      "script",
      "source_script",
      "planning_prompt",
      "planning_response",
      "planning_audit",
      "storyboard",
    ])
  })

  it("builds individual keyframe image assets from the keyframe manifest", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    tempDir = await mkdtemp(path.join(os.tmpdir(), "genergi-keyframe-image-assets-"))
    const keyframeDir = path.join(tempDir, "keyframes")
    await mkdir(keyframeDir, { recursive: true })
    await writeFile(path.join(keyframeDir, "scene-01.jpg"), "frame-1", "utf8")
    await writeFile(path.join(keyframeDir, "scene-02.jpg"), "frame-2", "utf8")
    const manifestPath = path.join(keyframeDir, "manifest.json")
    await writeFile(
      manifestPath,
      JSON.stringify({
        frames: [
          {
            sceneId: "scene_1",
            sceneIndex: 0,
            title: "Hook",
            fileName: "scene-01.jpg",
            filePath: path.join(keyframeDir, "scene-01.jpg"),
          },
          {
            sceneId: "scene_2",
            sceneIndex: 1,
            title: "Reveal",
            fileName: "scene-02.jpg",
            filePath: path.join(keyframeDir, "scene-02.jpg"),
          },
        ],
      }),
      "utf8",
    )

    const assets = await providers.buildKeyframeAssetRecords({
      taskId: "task_keyframe_assets",
      manifestPath,
      label: "关键帧包",
      createdAt: "2026-04-20T00:00:00.000Z",
    })

    expect(assets.map((asset) => asset.assetType)).toEqual([
      "keyframe_bundle",
      "keyframe_image",
      "keyframe_image",
    ])
    expect(assets[1]?.path).toContain("scene-01.jpg")
    expect(assets[2]?.path).toContain("scene-02.jpg")
  })

  it("prepares styled subtitles and passes them into final video muxing", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    tempDir = await mkdtemp(path.join(os.tmpdir(), "genergi-final-video-subtitles-"))
    process.env.GENERGI_DATA_DIR = tempDir

    const sceneOnePath = path.join(tempDir, "scene-1.mp4")
    const sceneTwoPath = path.join(tempDir, "scene-2.mp4")
    const narrationPath = path.join(tempDir, "narration.mp3")
    const subtitlesPath = path.join(tempDir, "subtitles.srt")
    await writeFile(sceneOnePath, "scene-1", "utf8")
    await writeFile(sceneTwoPath, "scene-2", "utf8")
    await writeFile(narrationPath, "audio", "utf8")
    await writeFile(subtitlesPath, "1\n00:00:00,000 --> 00:00:01,000\nHello\n", "utf8")

    let muxInput: {
      videoPath: string
      audioPath: string
      outputPath: string
      subtitlePath?: string | null
    } | null = null

    const result = await providers.buildFinalVideoWithNarration(
      {
        taskId: "task_final_subtitles",
        sourceVideoPaths: [sceneOnePath, sceneTwoPath],
        narrationPath,
        subtitlesPath,
        renderSpec: createTaskDetail().taskRunConfig.renderSpecJson,
        targetDurationSec: 15,
      },
      {
        concatVideos: async ({ outputPath }) => {
          await writeFile(outputPath, "stitched", "utf8")
        },
        trimVideoDuration: async ({ outputPath }) => {
          await writeFile(outputPath, "trimmed", "utf8")
        },
        writeStyledAssSubtitleFile: async ({ assPath }) => {
          await writeFile(assPath, "[Script Info]", "utf8")
          return assPath
        },
        muxNarrationIntoVideo: async (input) => {
          muxInput = input
          await writeFile(input.outputPath, "final", "utf8")
        },
        getMediaDurationSeconds: async () => 14.8,
      },
    )

    expect(muxInput?.subtitlePath).toContain("subtitles.ass")
    expect(result.outputPath).toContain("final-with-audio.mp4")
    expect(result.actualDurationSec).toBe(14.8)
  })

  it("uses Gemini native image generation for flash-image models that declare gemini transport", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")
    const { encryptControlPlaneSecret } = await import("../../../apps/api/src/lib/model-control/crypto")

    tempDir = await mkdtemp(path.join(os.tmpdir(), "genergi-gemini-native-image-"))
    process.env.GENERGI_DATA_DIR = tempDir
    process.env.GENERGI_MODEL_CONTROL_MASTER_KEY = "0123456789abcdef0123456789abcdef"

    await replaceProviderRecords([
      {
        id: "provider_77code",
        providerKey: "77code-openai",
        providerType: "openai-compatible",
        displayName: "77Code OpenAI Gateway",
        authType: "bearer_token",
        endpointUrl: "https://code.77code.fun/v1",
        encryptedEndpoint: null,
        encryptedSecret: encryptControlPlaneSecret("77code-secret"),
        endpointHint: "https://code.77code.fun/v1",
        secretHint: "****cret",
        status: "available",
        lastValidatedAt: "2026-04-19T00:00:00.000Z",
        lastValidationError: null,
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      },
    ] as any)

    const detail = createTaskDetail({
      taskRunConfig: {
        ...createTaskDetail().taskRunConfig,
        imageModel: {
          id: "gemini-3.1-flash-image-77code",
          label: "Gemini 3.1 Flash Image (77Code)",
          provider: "openai-compatible",
        },
        slotSnapshots: [
          {
            slotType: "imageModel",
            providerId: "provider_77code",
            providerKey: "77code-openai",
            providerType: "openai-compatible",
            modelId: "model_flash_image_77code",
            modelKey: "gemini-3.1-flash-image-77code",
            providerModelId: "gemini-3.1-flash-image",
            displayName: "Gemini 3.1 Flash Image (77Code)",
            capabilityJson: {
              imageTransport: "gemini-generate-content",
            },
            validatedAt: "2026-04-19T00:00:00.000Z",
          },
        ],
      },
      scenes: [
        {
          id: "scene_1",
          index: 0,
          title: "Hero shot",
          script: "Show a red cube.",
          imagePrompt: "A simple red cube on a white background.",
          videoPrompt: "A simple red cube on a white background.",
          durationSec: 8,
          startLabel: "00:00",
          endLabel: "00:08",
          reviewStatus: "pending",
          keyframeStatus: "pending",
          reviewNote: null,
          reviewedAt: null,
          keyframeReviewNote: null,
          keyframeReviewedAt: null,
        },
      ],
    })

    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const artifact = await providers.createGeminiNativeImageArtifact(
      {
        baseUrl: "https://code.77code.fun/v1",
        apiKey: "77code-secret",
        model: "gemini-3.1-flash-image",
        prompt: "A simple red cube on a white background.",
      },
      {
        postJson: async (url: string, body: Record<string, unknown>) => {
          requests.push({ url, body })
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        data: Buffer.from("gemini-image-bytes").toString("base64"),
                        mimeType: "image/png",
                      },
                    },
                  ],
                },
              },
            ],
          }
        },
      },
    )

    const runtime = await providers.resolveImageGenerationRuntime(detail, "gemini-3.1-flash-image-77code")

    expect(runtime.kind).toBe("gemini-native")
    expect(artifact.extension).toBe("png")
    expect(artifact.bytes.toString()).toBe("gemini-image-bytes")
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toContain("/v1beta/models/gemini-3.1-flash-image:generateContent")
    expect(requests[0]?.body?.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"] })
  })

  it("keeps using the existing gateway image path for legacy image models", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const detail = createTaskDetail()
    const runtime = await providers.resolveImageGenerationRuntime(detail, "image.premium")

    expect(runtime.kind).toBe("gateway")
    expect(runtime.model).toBe("gemini-3-pro-image-preview-2k")
  })
})
