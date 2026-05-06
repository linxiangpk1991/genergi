import { describe, expect, it } from "vitest"

describe("planning contract", () => {
  it("defines a valid multi-scene planning output schema", async () => {
    const contract = await import("../../../packages/shared/src/planning-contract")

    const parsed = contract.textPlanningOutputSchema.parse({
      generationRoute: "multi_scene",
      targetDurationSec: 30,
      finalVoiceoverScript: "A valid final script.",
      visualStyleGuide: "Native short-video pacing.",
      ctaLine: "Link in bio.",
      scenePlan: [
        {
          sceneIndex: 0,
          scenePurpose: "Hook",
          durationSec: 30,
          script: "Hook line.",
          voiceoverScript: "Hook line.",
          startFrameDescription: "A clean product hook frame.",
          imagePrompt: "Hook image prompt.",
          videoPrompt: "Hook video prompt.",
          startFrameIntent: "Open on the product hook.",
          endFrameIntent: "End on the CTA setup.",
          transitionHint: "hard cut",
        },
      ],
      blueprint: {
        executionMode: "review_required",
        renderSpec: {
          terminalPresetId: "phone_portrait",
          width: 1080,
          height: 1920,
          aspectRatio: "9:16",
          safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
          compositionGuideline: "Keep the subject inside the vertical safe area.",
          motionGuideline: "Use short-form social pacing.",
        },
        globalTheme: "Native short-video pacing.",
        visualStyleGuide: "Native short-video pacing.",
        subjectProfile: "Consistent product narrator.",
        productProfile: "The promoted product remains consistent.",
        backgroundConstraints: ["Clean product background"],
        negativeConstraints: ["No subtitles", "No watermark"],
        totalVoiceoverScript: "A valid final script.",
        sceneContracts: [
          {
            id: "scene_1",
            index: 0,
            sceneGoal: "Hook",
            voiceoverScript: "Hook line.",
            startFrameDescription: "A clean product hook frame.",
            imagePrompt: "Hook image prompt.",
            videoPrompt: "Hook video prompt.",
            startFrameIntent: "Open on the product hook.",
            endFrameIntent: "End on the CTA setup.",
            durationSec: 30,
            transitionHint: "hard cut",
            continuityConstraints: ["Keep the same product."],
          },
        ],
      },
    })

    expect(parsed.generationRoute).toBe("multi_scene")
  })
})
