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
      summary: "upstream returned bearer sampleSummaryToken123",
      reason: "request failed with token=secret-reason-token",
      provider: {
        provider: "anthropic-native",
        model: "claude-opus-4-6",
        request: {
          method: "POST",
          endpoint: "https://api.example.test/v1/messages?token=secret-token-123",
          headers: {
            Authorization: "Bearer sampleHeaderToken123",
            "x-api-key": "secret-key",
            "content-type": "application/json",
          },
          body: {
            model: "claude-opus-4-6",
            apiKey: "sampleBodySecret123",
            promptLength: 300,
          },
        },
        response: {
          status: 500,
          ok: false,
          body: {
            error: "upstream failed",
            message: "Authorization Bearer sampleMessageToken123",
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
    expect(timeline[0]?.summary).toBe("upstream returned [REDACTED]")
    expect(timeline[0]?.reason).toBe("request failed with [REDACTED]")
    expect(timeline[0]?.provider?.request?.headers).toEqual({
      Authorization: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      "content-type": "application/json",
    })
    expect(rawTimeline).not.toContain("sampleHeaderToken123")
    expect(rawTimeline).not.toContain("secret-key")
    expect(rawTimeline).not.toContain("sampleBodySecret123")
    expect(rawTimeline).not.toContain("secret-token-123")
    expect(rawTimeline).not.toContain("secret-response-token")
    expect(rawTimeline).not.toContain("sampleSummaryToken123")
    expect(rawTimeline).not.toContain("secret-reason-token")
    expect(rawTimeline).not.toContain("sampleMessageToken123")
  })

  it("keeps only the latest timeline events so long-running tasks cannot grow forever", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-timeline-cap-"))
    process.env.GENERGI_DATA_DIR = dataDir
    const shared = await import("../../../packages/shared/src/index")

    for (let index = 1; index <= 205; index += 1) {
      await shared.appendTaskTimelineEvent("task_timeline_cap", {
        type: "stage",
        stage: `stage_${index}`,
        label: `阶段 ${index}`,
        level: "info",
      })
    }

    const timeline = await shared.readTaskTimeline("task_timeline_cap")

    expect(timeline).toHaveLength(200)
    expect(timeline[0]?.sequence).toBe(6)
    expect(timeline.at(-1)?.sequence).toBe(205)
    expect(timeline[0]?.stage).toBe("stage_6")
    expect(timeline.at(-1)?.stage).toBe("stage_205")
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
