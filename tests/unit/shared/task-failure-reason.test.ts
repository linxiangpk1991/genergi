import { describe, expect, it } from "vitest"

describe("task failure reason normalization", () => {
  it("preserves failureReason on task summaries and details", async () => {
    const shared = await import("../../../packages/shared/src/task-persistence")

    const summary = shared.normalizeTaskSummaryRecord({
      id: "task_failed",
      projectId: "project_default",
      title: "Failed task",
      modeId: "high_quality",
      executionMode: "review_required",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      renderSpecJson: {
        terminalPresetId: "phone_portrait",
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
        compositionGuideline: "主体保持在竖屏中心安全区",
        motionGuideline: "优先轻推拉",
      },
      targetDurationSec: 30,
      generationMode: "system_enhanced",
      generationRoute: "multi_scene",
      routeReason: "target duration exceeds single-shot limit",
      planningVersion: "v1",
      blueprintVersion: 1,
      blueprintStatus: "queued_for_video",
      actualDurationSec: null,
      status: "failed",
      progressPct: 65,
      retryCount: 1,
      estimatedCostCny: 4.2,
      failureReason: "Scene 2 video generation timeout",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
      reviewStage: null,
      pendingReviewCount: 0,
      reviewUpdatedAt: null,
    } as any)

    const detail = shared.normalizeTaskDetailRecord({
      taskId: "task_failed",
      projectId: "project_default",
      title: "Failed task",
      script: "Failed script",
      taskRunConfig: {
        projectId: "project_default",
        modeId: "high_quality",
        executionMode: "review_required",
        channelId: "reels",
        terminalPresetId: "phone_portrait",
        renderSpecJson: {
          terminalPresetId: "phone_portrait",
          width: 1080,
          height: 1920,
          aspectRatio: "9:16",
          safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
          compositionGuideline: "主体保持在竖屏中心安全区",
          motionGuideline: "优先轻推拉",
        },
        targetDurationSec: 30,
        generationMode: "system_enhanced",
        enhancementMode: "system_enhanced",
        generationRoute: "multi_scene",
        routeReason: "target duration exceeds single-shot limit",
        planningVersion: "v1",
        blueprintVersion: 1,
        blueprintStatus: "queued_for_video",
        textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
        imageModel: { id: "image.default", label: "Gemini", provider: "openai-compatible" },
        videoModel: { id: "video.default", label: "Veo", provider: "openai-compatible" },
        ttsProvider: "edge-tts",
        contentLocale: "en",
        operatorLocale: "zh-CN",
        requireStoryboardReview: true,
        requireKeyframeReview: true,
        budgetLimitCny: 5,
        aspectRatio: "9:16",
        slotSnapshots: [],
      },
      blueprintVersion: 1,
      blueprintStatus: "queued_for_video",
      failureReason: "Scene 2 video generation timeout",
      scenes: [],
      updatedAt: "2026-04-20T00:00:00.000Z",
      reviewStage: null,
      pendingReviewCount: 0,
      reviewUpdatedAt: null,
    } as any)

    expect(summary.failureReason).toBe("Scene 2 video generation timeout")
    expect(detail.failureReason).toBe("Scene 2 video generation timeout")
  })
})
