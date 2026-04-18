import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { mergeSceneReviewMetadata, type TaskDetail } from "@genergi/shared"

describe("worker provider helpers", () => {
  let tempDir = ""

  function createTaskDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
    return {
      taskId: "task_review_preservation",
      title: "Desk charger launch",
      script: "Hook the viewer fast. Reveal the desk upgrade. End with a clear CTA.",
      taskRunConfig: {
        modeId: "high_quality",
        channelId: "reels",
        targetDurationSec: 15,
        generationMode: "system_enhanced",
        enhancementMode: "system_enhanced",
        generationRoute: "multi_scene",
        routeReason: "target duration exceeds the current model single-shot limit of 8s",
        planningVersion: "v1",
        textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
        imageDraftModel: { id: "image.final", label: "Gemini 3 Pro Image Preview", provider: "openai-compatible" },
        imageFinalModel: { id: "image.premium", label: "Gemini 3 Pro Image Preview 2k", provider: "openai-compatible" },
        videoDraftModel: { id: "video.final", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
        videoFinalModel: { id: "video.hd", label: "Veo 3.1 Portrait HD", provider: "openai-compatible" },
        ttsProvider: "edge-tts",
        contentLocale: "en",
        operatorLocale: "zh-CN",
        requireStoryboardReview: true,
        requireKeyframeReview: true,
        budgetLimitCny: 5,
        aspectRatio: "9:16",
      },
      scenes: [],
      updatedAt: "2026-04-19T00:00:00.000Z",
      ...overrides,
    }
  }

  afterEach(async () => {
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
})
