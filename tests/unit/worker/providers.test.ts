import { describe, expect, it } from "vitest"

describe("worker provider helpers", () => {
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
})
