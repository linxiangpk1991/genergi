import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { buildLifecycleTimelineEvent } from "../../../apps/worker/src/lib/task-timeline"

describe("task timeline persistence", () => {
  let dataDir = ""

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
      dataDir = ""
    }
    delete process.env.GENERGI_DATA_DIR
  })

  it("appends timeline events and redacts provider secrets before writing JSON", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-timeline-"))
    process.env.GENERGI_DATA_DIR = dataDir
    const shared = await import("../../../packages/shared/src/index")

    await shared.appendTaskTimelineEvent("task_timeline_security", {
      type: "provider",
      stage: "text_planning",
      label: "文本规划 provider 请求",
      level: "info",
      provider: {
        provider: "anthropic-native",
        model: "claude-opus-4-6",
        request: {
          method: "POST",
          endpoint: "https://api.example.test/v1/messages?token=secret-token-123",
          headers: {
            Authorization: "Bearer sk-live-secret",
            "x-api-key": "secret-key",
            "content-type": "application/json",
          },
          body: {
            model: "claude-opus-4-6",
            apiKey: "sk-body-secret",
            promptLength: 300,
          },
        },
        response: {
          status: 500,
          ok: false,
          body: {
            error: "upstream failed",
            access_token: "secret-response-token",
          },
        },
      },
    })

    const timeline = await shared.readTaskTimeline("task_timeline_security")
    const rawTimeline = await readFile(path.join(dataDir, "task-timelines.json"), "utf8")

    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.sequence).toBe(1)
    expect(timeline[0]?.provider?.request?.endpoint).toBe("https://api.example.test/v1/messages")
    expect(timeline[0]?.provider?.request?.headers).toEqual({
      Authorization: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      "content-type": "application/json",
    })
    expect(rawTimeline).not.toContain("sk-live-secret")
    expect(rawTimeline).not.toContain("secret-key")
    expect(rawTimeline).not.toContain("sk-body-secret")
    expect(rawTimeline).not.toContain("secret-token-123")
    expect(rawTimeline).not.toContain("secret-response-token")
  })
})

describe("worker task timeline events", () => {
  it("builds a stage event from lifecycle state changes", () => {
    const event = buildLifecycleTimelineEvent({
      status: "running",
      progressPct: 40,
      statusDetail: "关键画面生成中 2/4",
      currentStage: "keyframe_generation",
      currentStageLabel: "关键画面生成中 2/4",
      currentSceneIndex: 1,
      currentSceneTotal: 4,
      workerId: "worker-1",
    })

    expect(event).toMatchObject({
      type: "stage",
      stage: "keyframe_generation",
      label: "关键画面生成中 2/4",
      level: "info",
      summary: "关键画面生成中 2/4",
      metadata: {
        status: "running",
        progressPct: 40,
        currentSceneIndex: 1,
        currentSceneTotal: 4,
        workerId: "worker-1",
      },
    })
  })

  it("marks failed lifecycle changes as error timeline events", () => {
    const event = buildLifecycleTimelineEvent({
      status: "failed",
      statusDetail: "任务失败",
      failureReason: "TEXT_PLANNING_OUTPUT_UNAVAILABLE",
      currentStage: "failed",
      currentStageLabel: "任务失败",
    })

    expect(event).toMatchObject({
      type: "error",
      stage: "failed",
      label: "任务失败",
      level: "error",
      reason: "TEXT_PLANNING_OUTPUT_UNAVAILABLE",
    })
  })

  it("does not write heartbeat-only updates as timeline events", () => {
    expect(buildLifecycleTimelineEvent({
      statusDetail: "worker online",
      lastHeartbeatAt: "2026-05-07T00:00:00.000Z",
    })).toBeNull()
  })
})
