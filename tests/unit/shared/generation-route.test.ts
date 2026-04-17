import { describe, expect, it } from "vitest"

describe("generation route selection", () => {
  it("forces multi-scene when target duration exceeds the single-shot limit", async () => {
    const route = await import("../../../packages/shared/src/generation-route")

    expect(
      route.resolveGenerationRoute({
        targetDurationSec: 15,
        maxSingleShotSec: 8,
      }),
    ).toMatchObject({
      generationRoute: "multi_scene",
    })
  })

  it("allows single-shot when target duration fits the model capability", async () => {
    const route = await import("../../../packages/shared/src/generation-route")

    expect(
      route.resolveGenerationRoute({
        targetDurationSec: 8,
        maxSingleShotSec: 8,
      }),
    ).toMatchObject({
      generationRoute: "single_shot",
    })
  })
})
