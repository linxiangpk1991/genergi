import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

describe("API task store", () => {
  let dataDir = ""

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
    dataDir = ""
    vi.resetModules()
  })

  it("creates a task with a persisted final duration and duration-aware scenes", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")

    const created = await store.createTask({
      title: "Desk charger launch",
      script:
        "Show the messy desk first. Introduce the charger as the upgrade. Demonstrate the clean transformation. End with a short premium CTA.",
      modeId: "high_quality",
      channelId: "reels",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    expect(created.task.targetDurationSec).toBe(30)
    expect(created.taskRunConfig.targetDurationSec).toBe(30)
    expect(created.task.generationMode).toBe("system_enhanced")
    expect(created.taskRunConfig.generationMode).toBe("system_enhanced")
    expect(created.task.generationRoute).toBe("multi_scene")
    expect(created.task.routeReason).toContain("single-shot limit")

    const detail = await store.getTaskDetail(created.task.id)
    expect(detail?.taskRunConfig.targetDurationSec).toBe(30)
    expect(detail?.taskRunConfig.generationRoute).toBe("multi_scene")
    expect(detail?.scenes).toHaveLength(5)
    expect(detail?.scenes.reduce((total, scene) => total + scene.durationSec, 0)).toBe(30)
    expect(detail?.scenes.some((scene) => scene.script.includes("Show the product in action"))).toBe(false)
  })
})
