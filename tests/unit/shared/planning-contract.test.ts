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
          imagePrompt: "Hook image prompt.",
          videoPrompt: "Hook video prompt.",
          transitionHint: "hard cut",
        },
      ],
    })

    expect(parsed.generationRoute).toBe("multi_scene")
  })
})
