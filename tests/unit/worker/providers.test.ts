import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

describe("worker provider helpers", () => {
  let tempDir = ""

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
