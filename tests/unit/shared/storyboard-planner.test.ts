import { describe, expect, it } from "vitest"

describe("storyboard planner", () => {
  it("builds 3 scenes that sum exactly to 15 seconds", async () => {
    const planner = await import("../../../packages/shared/src/storyboard-planner")

    const scenes = planner.buildStoryboardScenes({
      script:
        "Open by showing the desk chaos. Show the charger snapping into place. End on the premium clean setup and direct call to action.",
      targetDurationSec: 15,
      maxSceneDurationSec: 8,
      aspectRatio: "9:16",
    })

    expect(scenes).toHaveLength(2)
    expect(scenes.reduce((total: number, scene: { durationSec: number }) => total + scene.durationSec, 0)).toBe(15)
    expect(scenes[0].script.toLowerCase()).toContain("desk chaos")
    expect(scenes[0].script.toLowerCase()).toContain("charger")
    expect(scenes[1].script.toLowerCase()).toContain("call to action")
  })

  it("builds more scenes for longer final durations and keeps timeline labels contiguous", async () => {
    const planner = await import("../../../packages/shared/src/storyboard-planner")

    const scenes = planner.buildStoryboardScenes({
      script:
        "Hook with the mess. Explain why cable clutter hurts the premium look. Introduce the charger. Show the before state. Show the after state. Highlight the neat desk aesthetic. Close with a short CTA.",
      targetDurationSec: 45,
      maxSceneDurationSec: 8,
      aspectRatio: "9:16",
    })

    expect(scenes).toHaveLength(6)
    expect(scenes[0].startLabel).toBe("00:00")
    expect(scenes.at(-1)?.endLabel).toBe("00:45")
    expect(
      scenes.every((scene: { videoPrompt: string; imagePrompt: string }) =>
        scene.videoPrompt.includes(scene.script) && scene.imagePrompt.includes(scene.script),
      ),
    ).toBe(true)
  })

  it("keeps script beats in source order instead of wrapping later beats back into the first scene", async () => {
    const planner = await import("../../../packages/shared/src/storyboard-planner")

    const scenes = planner.buildStoryboardScenes({
      script:
        "Beat one introduces the problem. Beat two introduces the product. Beat three shows the transformation. Beat four closes with the CTA.",
      targetDurationSec: 15,
      maxSceneDurationSec: 8,
      aspectRatio: "9:16",
    })

    expect(scenes[0].script).toContain("Beat one")
    expect(scenes[0].script).not.toContain("Beat four")
    expect(scenes.at(-1)?.script).toContain("Beat four")
  })
})
