import { describe, expect, it } from "vitest"

describe("worker planning prompt", () => {
  it("builds a user-locked planning prompt without system enhancement keywords", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const prompt = providers.buildPlanningPromptContext({
      originalScript: "A user-supplied whole-video script.",
      targetDurationSec: 30,
      platform: "tiktok",
      generationMode: "user_locked",
      generationRoute: "multi_scene",
      routeReason: "target duration exceeds single-shot capability",
      maxSingleShotSec: 8,
      enhancementKeywords: [],
    })

    expect(prompt).toContain("A user-supplied whole-video script.")
    expect(prompt).toContain("generation route: multi_scene")
    expect(prompt).not.toContain("stronger hook")
  })

  it("builds a system-enhanced planning prompt with enhancement keywords and explicit output rules", async () => {
    const providers = await import("../../../apps/worker/src/lib/providers")

    const prompt = providers.buildPlanningPromptContext({
      originalScript: "A user-supplied whole-video script.",
      targetDurationSec: 15,
      platform: "reels",
      generationMode: "system_enhanced",
      generationRoute: "multi_scene",
      routeReason: "current model max single-shot length is 8 seconds",
      maxSingleShotSec: 8,
      enhancementKeywords: ["stronger hook", "native pacing", "clear CTA"],
    })

    expect(prompt).toContain("stronger hook")
    expect(prompt).toContain("native pacing")
    expect(prompt).toContain("clear CTA")
    expect(prompt).toContain("do not output explanations")
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
})
