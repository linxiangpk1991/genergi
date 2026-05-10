import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("API task understanding preview route", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
    process.env.GENERGI_SESSION_SECRET = "test-secret"
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
  })

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
    delete process.env.GENERGI_SESSION_SECRET
    delete process.env.GENERGI_ADMIN_USERNAME
    delete process.env.GENERGI_ADMIN_PASSWORD
    dataDir = ""
    vi.resetModules()
  })

  it("returns bilingual preview and an English-only execution brief before task creation", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-understanding-preview-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ buildSessionValue }, { app }] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
    ])

    const response = await app.request("/api/tasks/understanding-preview", {
      method: "POST",
      body: JSON.stringify({
        sourceBrief:
          "If you've been working hard for years but still feel stuck, your BaZi luck cycle may explain why. Link in bio for the full report.",
        visualSeedInput:
          "主角：28 岁亚洲女性。场景：深夜办公室。风格：柔和电影感插画。情绪：疲惫、反思、希望。禁止项：不要文字水印。",
        targetDurationSec: 60,
        keyframeCount: 4,
        keepCharacterConsistent: true,
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
      },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      understandingPreview: {
        topic: { zh: string; en: string }
        visualBrief: { subject: { zh: string; en: string } }
      }
      executionBrief: {
        finalPromptLanguage: string
        keyframePlan: Array<{ imagePrompt: string; videoPrompt: string }>
      }
    }

    expect(payload.understandingPreview.topic.zh).toContain("内容主题")
    expect(payload.understandingPreview.topic.en).toContain("Short video")
    expect(payload.understandingPreview.visualBrief.subject.zh).toContain("28 岁亚洲女性")
    expect(payload.executionBrief.finalPromptLanguage).toBe("en")
    expect(payload.executionBrief.keyframePlan).toHaveLength(4)
    expect(payload.executionBrief.keyframePlan[0]?.imagePrompt).toContain("no text overlays")
    expect(JSON.stringify(payload.executionBrief)).not.toMatch(/主角|场景|禁止项/)
  })
})
