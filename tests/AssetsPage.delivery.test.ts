import { describe, expect, it } from "vitest"
import type { AssetRecord, TaskSummary } from "../apps/web/src/api"
import {
  buildFallbackDeliveryWorkbench,
  classifyDeliveryWorkbench,
  normalizeDeliveryWorkbench,
} from "../apps/web/src/pages/AssetsPage"

function createTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "task_1",
    projectId: "project_1",
    title: "Launch video",
    modeId: "standard",
    executionMode: "automated",
    channelId: "tiktok",
    terminalPresetId: "phone_portrait",
    renderSpecJson: {
      terminalPresetId: "phone_portrait",
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      safeArea: { topPct: 0, rightPct: 0, bottomPct: 0, leftPct: 0 },
      compositionGuideline: "",
      motionGuideline: "",
    },
    targetDurationSec: 30,
    generationMode: "system_enhanced",
    audioStrategy: "tts_only",
    subtitleStrategy: "tts_aligned",
    generationRoute: "multi_scene",
    routeReason: "multi scene",
    planningVersion: "v1",
    blueprintVersion: 1,
    blueprintStatus: "completed",
    actualDurationSec: null,
    status: "completed",
    progressPct: 100,
    retryCount: 0,
    estimatedCostCny: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  }
}

function createAsset(assetType: AssetRecord["assetType"], overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: `${assetType}_1`,
    taskId: "task_1",
    assetType,
    label: assetType,
    status: "ready",
    path: `/tmp/${assetType}`,
    createdAt: "2026-05-01T00:00:00.000Z",
    fileName: `${assetType}.txt`,
    directoryName: null,
    displayPath: `exports/${assetType}.txt`,
    extension: ".txt",
    mimeType: "text/plain",
    sizeBytes: 10,
    sizeLabel: "10 B",
    exists: true,
    isDirectory: false,
    previewable: true,
    previewKind: "text",
    modifiedAt: null,
    downloadFileName: `${assetType}.txt`,
    ...overrides,
  }
}

describe("AssetsPage delivery helpers", () => {
  it("normalizes delivery checks from object maps and scene matrices", () => {
    const delivery = normalizeDeliveryWorkbench({
      checks: {
        finalVideo: { status: "ready", label: "Final video" },
        subtitles: { status: "missing" },
      },
      sceneMatrix: [
        {
          sceneId: "scene_1",
          index: 0,
          title: "Hook",
          keyframe: "ready",
          video: { status: "failed", message: "provider timeout" },
          review: "needs_check",
        },
      ],
      recommendedActions: [{ label: "Retry scene 1" }],
      publishCopy: {
        title: "Launch title",
        description: "Launch description",
        channelId: "tiktok",
      },
      manifestUrl: "/api/tasks/task_1/delivery/manifest",
    })

    expect(delivery.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "finalVideo", status: "ready", label: "Final video" }),
        expect.objectContaining({ key: "subtitles", status: "missing" }),
      ]),
    )
    expect(delivery.scenes[0]).toEqual(
      expect.objectContaining({
        sceneId: "scene_1",
        title: "Hook",
        keyframe: expect.objectContaining({ status: "ready" }),
        video: expect.objectContaining({ status: "failed", message: "provider timeout" }),
        review: expect.objectContaining({ status: "needs_check" }),
      }),
    )
    expect(delivery.recommendedActions[0]?.label).toBe("Retry scene 1")
    expect(delivery.publishCopy).toMatchObject({ title: "Launch title", channelId: "tiktok" })
    expect(delivery.manifestUrl).toBe("/api/tasks/task_1/delivery/manifest")
  })

  it("marks a completed task with missing deliverables as missing assets", () => {
    const workbench = buildFallbackDeliveryWorkbench({
      task: createTask(),
      assets: [
        createAsset("video_bundle"),
        createAsset("subtitles", { exists: false, status: "pending" }),
        createAsset("script"),
      ],
      diagnostics: null,
    })

    expect(classifyDeliveryWorkbench(workbench, createTask()).id).toBe("missing_assets")
  })

  it("marks recoverable failed tasks as failed recovery", () => {
    const task = createTask({ status: "failed", failureReason: "scene video timeout" })
    const workbench = buildFallbackDeliveryWorkbench({
      task,
      assets: [createAsset("script")],
      diagnostics: {
        taskId: task.id,
        recoverable: true,
        recoveryReason: "failed_task",
        stale: { isStale: false, thresholdMs: 600000, ageMs: 1000, sourceUpdatedAt: task.updatedAt },
        queue: {
          available: true,
          activeJobIds: [],
          waitingJobIds: [],
          delayedJobIds: [],
          prioritizedJobIds: [],
          pausedJobIds: [],
          failedJobIds: ["job_1"],
        },
        runtimeTrace: {
          currentStage: "video",
          currentStageLabel: "视频生成",
          currentSceneIndex: 0,
          currentSceneTotal: 1,
          stageStartedAt: task.updatedAt,
          lastHeartbeatAt: task.updatedAt,
          workerId: "worker_1",
          activeJobId: null,
        },
        assets: {
          readyCount: 1,
          missingCount: 2,
          deliverableReadyCount: 1,
          deliverableTotal: 4,
          expectedNextAssetType: "video_bundle",
        },
        operatorMessage: "可恢复",
      },
    })

    expect(classifyDeliveryWorkbench(workbench, task).id).toBe("failed_recovery")
  })
})
