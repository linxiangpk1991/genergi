import { describe, expect, it } from "vitest"

describe("worker planning prompt", () => {
  it("builds a fidelity-first planning prompt without enhancement language", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const prompt = providers.buildPlanningPromptContext({
      originalScript: "A user-supplied whole-video script.",
      projectId: "project_default",
      targetDurationSec: 30,
      platform: "tiktok",
      executionMode: "review_required",
      terminalPresetId: "phone_portrait",
      renderSpec: {
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        compositionGuideline: "Keep the subject centered",
        motionGuideline: "Prefer slow push-ins",
      },
      generationMode: "user_locked",
      generationRoute: "multi_scene",
      routeReason: "target duration exceeds single-shot capability",
      maxSingleShotSec: 8,
      enhancementKeywords: [],
    })

    expect(prompt).toContain("A user-supplied whole-video script.")
    expect(prompt).toContain("generation route: multi_scene")
    expect(prompt).not.toContain("stronger hook")
    expect(prompt).not.toContain("generation mode:")
    expect(prompt).not.toContain("platform:")
    expect(prompt).toContain("do not add new products, offers, commercial angles, or environments")
    expect(prompt).toContain("preserve the user's original topic, domain, subject, scene, and CTA intent")
    expect(prompt).toContain("scenePlan.script and scenePlan.voiceoverScript are the final narration draft")
    expect(prompt).toContain("scenePlan.imagePrompt and scenePlan.videoPrompt are the final downstream prompts")
  })

  it("still enforces exact scene count and machine-usable output rules", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const prompt = providers.buildPlanningPromptContext({
      originalScript: "A user-supplied whole-video script.",
      projectId: "project_default",
      targetDurationSec: 15,
      platform: "reels",
      executionMode: "review_required",
      terminalPresetId: "phone_portrait",
      renderSpec: {
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        compositionGuideline: "Keep the subject centered",
        motionGuideline: "Prefer slow push-ins",
      },
      generationMode: "system_enhanced",
      generationRoute: "multi_scene",
      routeReason: "current model max single-shot length is 8 seconds",
      maxSingleShotSec: 8,
      enhancementKeywords: ["stronger hook", "native pacing", "clear CTA"],
    })

    expect(prompt).toContain("do not output explanations")
    expect(prompt).toContain("exactly 2 scenes")
    expect(prompt).toContain("finalVoiceoverScript must be direct voiceover text")
  })

  it("rejects planning output that includes commentary instead of machine-usable fields", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const result = providers.validatePlanningOutput(
      {
        generationRoute: "multi_scene",
        targetDurationSec: 30,
        finalVoiceoverScript: "Valid script.",
        visualStyleGuide: "Native pacing.",
        ctaLine: "Link in bio.",
        commentary: "What changed and why",
        scenePlan: [
          {
            sceneIndex: 0,
            scenePurpose: "Hook",
            durationSec: 10,
            script: "Hook line.",
            imagePrompt: "Image prompt.",
            videoPrompt: "Video prompt.",
            transitionHint: "cut",
          },
          {
            sceneIndex: 1,
            scenePurpose: "Body",
            durationSec: 10,
            script: "Body line.",
            imagePrompt: "Image prompt.",
            videoPrompt: "Video prompt.",
            transitionHint: "cut",
          },
          {
            sceneIndex: 2,
            scenePurpose: "CTA",
            durationSec: 10,
            script: "CTA line.",
            imagePrompt: "Image prompt.",
            videoPrompt: "Video prompt.",
            transitionHint: "cut",
          },
        ],
      },
      {
        generationRoute: "multi_scene",
        targetDurationSec: 30,
      },
    )

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected validation failure")
    }
    expect(result.reason).toContain("commentary")
  })

  it("rejects multi-scene output when the model returns more scenes than the system route allows", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const result = providers.validatePlanningOutput(
      {
        generationRoute: "multi_scene",
        targetDurationSec: 15,
        finalVoiceoverScript: "Valid script.",
        visualStyleGuide: "Native pacing.",
        ctaLine: "Link in bio.",
        blueprint: {
          executionMode: "review_required",
          renderSpec: {
            terminalPresetId: "phone_portrait",
            width: 1080,
            height: 1920,
            aspectRatio: "9:16",
            safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
            compositionGuideline: "Keep the subject centered",
            motionGuideline: "Prefer slow push-ins",
          },
          globalTheme: "Theme",
          visualStyleGuide: "Native pacing.",
          subjectProfile: "Single subject",
          productProfile: "Consistent product",
          backgroundConstraints: [],
          negativeConstraints: [],
          totalVoiceoverScript: "Valid script.",
          sceneContracts: [
            { id: "scene_1", index: 0, sceneGoal: "Hook", voiceoverScript: "A", startFrameDescription: "A", imagePrompt: "A", videoPrompt: "A", startFrameIntent: "A", endFrameIntent: "A", durationSec: 4, transitionHint: "cut", continuityConstraints: [] },
            { id: "scene_2", index: 1, sceneGoal: "Body", voiceoverScript: "B", startFrameDescription: "B", imagePrompt: "B", videoPrompt: "B", startFrameIntent: "B", endFrameIntent: "B", durationSec: 4, transitionHint: "cut", continuityConstraints: [] },
            { id: "scene_3", index: 2, sceneGoal: "Body", voiceoverScript: "C", startFrameDescription: "C", imagePrompt: "C", videoPrompt: "C", startFrameIntent: "C", endFrameIntent: "C", durationSec: 4, transitionHint: "cut", continuityConstraints: [] },
            { id: "scene_4", index: 3, sceneGoal: "CTA", voiceoverScript: "D", startFrameDescription: "D", imagePrompt: "D", videoPrompt: "D", startFrameIntent: "D", endFrameIntent: "D", durationSec: 3, transitionHint: "close", continuityConstraints: [] },
          ],
        },
        scenePlan: [
          { sceneIndex: 0, scenePurpose: "Hook", durationSec: 4, script: "A", voiceoverScript: "A", startFrameDescription: "A", imagePrompt: "A", videoPrompt: "A", startFrameIntent: "A", endFrameIntent: "A", transitionHint: "cut" },
          { sceneIndex: 1, scenePurpose: "Body", durationSec: 4, script: "B", voiceoverScript: "B", startFrameDescription: "B", imagePrompt: "B", videoPrompt: "B", startFrameIntent: "B", endFrameIntent: "B", transitionHint: "cut" },
          { sceneIndex: 2, scenePurpose: "Body", durationSec: 4, script: "C", voiceoverScript: "C", startFrameDescription: "C", imagePrompt: "C", videoPrompt: "C", startFrameIntent: "C", endFrameIntent: "C", transitionHint: "cut" },
          { sceneIndex: 3, scenePurpose: "CTA", durationSec: 3, script: "D", voiceoverScript: "D", startFrameDescription: "D", imagePrompt: "D", videoPrompt: "D", startFrameIntent: "D", endFrameIntent: "D", transitionHint: "close" },
        ],
      },
      {
        generationRoute: "multi_scene",
        targetDurationSec: 15,
        maxSceneCount: 2,
        maxSingleShotSec: 8,
      },
    )

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected validation failure")
    }
    expect(result.reason).toContain("scene count")
  })

})
