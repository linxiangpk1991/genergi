import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../apps/web/src/api", async () => {
  const actual = await vi.importActual<typeof import("../../../apps/web/src/api")>(
    "../../../apps/web/src/api",
  )
  return {
    ...actual,
    api: {
      ...actual.api,
      listTasks: vi.fn(),
      runtimeStatus: vi.fn(),
      getTaskAssets: vi.fn(),
      getTaskDiagnostics: vi.fn(),
      cancelTask: vi.fn(),
      resumeFailedTask: vi.fn(),
    },
  }
})

import { api } from "../../../apps/web/src/api"
import { AssetsPage } from "../../../apps/web/src/pages/AssetsPage"
import { BatchDashboardPage } from "../../../apps/web/src/pages/BatchDashboardPage"

async function waitFor(assertion: () => void, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
      })
    }
  }

  throw lastError instanceof Error ? lastError : new Error("waitFor timeout")
}

function createRunningTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_running",
    projectId: "project_default",
    title: "Running task",
    modeId: "high_quality",
    executionMode: "review_required",
    channelId: "tiktok",
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
    generationMode: "user_locked",
    audioStrategy: "tts_only",
    generationRoute: "multi_scene",
    routeReason: "target duration 30s exceeds the current model single-shot limit of 8s",
    planningVersion: "v1",
    blueprintVersion: 1,
    blueprintStatus: "queued_for_video",
    actualDurationSec: null,
    failureReason: null,
    statusDetail: "正在生成 scene 2/4",
    cancelRequestedAt: null,
    status: "running",
    progressPct: 65,
    retryCount: 0,
    estimatedCostCny: 4.25,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  }
}

function createFailedTask(overrides: Record<string, unknown> = {}) {
  return {
    ...createRunningTask({
      id: "task_failed",
      title: "Failed task",
      status: "failed",
      failureReason: "Scene 2 video generation timeout",
      statusDetail: "任务失败",
      retryCount: 1,
      blueprintStatus: "queued_for_video",
      audioStrategy: "native_plus_tts_ducked",
    }),
    ...overrides,
  }
}

describe("task status details and cancel actions", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [createRunningTask()],
    } as any)
    vi.mocked(api.runtimeStatus).mockResolvedValue({
      runtime: {
        api: { name: "api", status: "healthy", updatedAt: "2026-04-20T00:00:00.000Z", message: "ok" },
        worker: { name: "worker", status: "healthy", updatedAt: "2026-04-20T00:00:00.000Z", message: "ok" },
        redis: { name: "redis", status: "healthy", updatedAt: "2026-04-20T00:00:00.000Z", message: "ok" },
      },
    } as any)
    vi.mocked(api.getTaskAssets).mockResolvedValue({ assets: [] } as any)
    vi.mocked(api.getTaskDiagnostics).mockResolvedValue({
      taskId: "task_running",
      recoverable: false,
      recoveryReason: null,
      stale: {
        isStale: false,
        thresholdMs: 10 * 60 * 1000,
        ageMs: null,
        sourceUpdatedAt: "2026-04-20T00:00:00.000Z",
      },
      queue: {
        available: true,
        activeJobIds: [],
        waitingJobIds: [],
        delayedJobIds: [],
        prioritizedJobIds: [],
        pausedJobIds: [],
        failedJobIds: [],
      },
      assets: {
        readyCount: 0,
        deliverableReadyCount: 0,
        expectedNextAssetType: "keyframe_bundle",
      },
    } as any)
    vi.mocked(api.cancelTask).mockResolvedValue({
      task: createRunningTask({
        status: "canceled",
        statusDetail: "正在终止当前任务",
        cancelRequestedAt: "2026-04-20T00:00:05.000Z",
      }),
      detail: {
        taskId: "task_running",
        projectId: "project_default",
        title: "Running task",
        script: "script",
        blueprintVersion: 1,
        blueprintStatus: "queued_for_video",
        failureReason: null,
        statusDetail: "正在终止当前任务",
        cancelRequestedAt: "2026-04-20T00:00:05.000Z",
        taskRunConfig: createRunningTask().renderSpecJson ? {
          projectId: "project_default",
          modeId: "high_quality",
          executionMode: "review_required",
          channelId: "tiktok",
          terminalPresetId: "phone_portrait",
          renderSpecJson: createRunningTask().renderSpecJson,
          targetDurationSec: 30,
          generationMode: "user_locked",
          generationRoute: "multi_scene",
          routeReason: "target duration 30s exceeds the current model single-shot limit of 8s",
          planningVersion: "v1",
          blueprintVersion: 1,
          blueprintStatus: "queued_for_video",
          textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
          imageModel: { id: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image Preview", provider: "openai-compatible" },
          videoModel: { id: "veo3.1", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
          ttsProvider: "edge-tts",
          contentLocale: "en",
          operatorLocale: "zh-CN",
          requireStoryboardReview: true,
          requireKeyframeReview: true,
          budgetLimitCny: 5,
          aspectRatio: "9:16",
          slotSnapshots: [],
        } : null,
        scenes: [],
        updatedAt: "2026-04-20T00:00:05.000Z",
      },
      queue: {
        removedJobIds: [],
        hadActiveJob: true,
      },
    } as any)
    vi.mocked(api.resumeFailedTask).mockResolvedValue({
      task: createFailedTask({
        status: "queued",
        failureReason: null,
        statusDetail: "等待 worker 恢复处理",
      }),
      detail: {
        taskId: "task_failed",
        projectId: "project_default",
        title: "Failed task",
        script: "script",
        blueprintVersion: 1,
        blueprintStatus: "queued_for_video",
        failureReason: null,
        statusDetail: "等待 worker 恢复处理",
        cancelRequestedAt: null,
        taskRunConfig: {
          projectId: "project_default",
          modeId: "high_quality",
          executionMode: "review_required",
          channelId: "tiktok",
          terminalPresetId: "phone_portrait",
          renderSpecJson: createRunningTask().renderSpecJson,
          targetDurationSec: 30,
          generationMode: "user_locked",
          audioStrategy: "native_plus_tts_ducked",
          generationRoute: "multi_scene",
          routeReason: "target duration 30s exceeds the current model single-shot limit of 8s",
          planningVersion: "v1",
          blueprintVersion: 1,
          blueprintStatus: "queued_for_video",
          textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
          imageModel: { id: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image Preview", provider: "openai-compatible" },
          videoModel: { id: "veo3.1", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
          ttsProvider: "edge-tts",
          contentLocale: "en",
          operatorLocale: "zh-CN",
          requireStoryboardReview: true,
          requireKeyframeReview: true,
          budgetLimitCny: 5,
          aspectRatio: "9:16",
          slotSnapshots: [],
        },
        scenes: [],
        updatedAt: "2026-04-20T00:00:05.000Z",
      },
      queue: {
        queued: true,
        reason: "resume_failed_task",
        continueExecution: true,
        resumeFrom: "failed_task",
      },
    } as any)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it("shows statusDetail on the batch dashboard", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/batch-dashboard"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/batch-dashboard", element: createElement(BatchDashboardPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("正在生成 scene 2/4")
    })
  })

  it("shows a terminate button in asset center and updates the task after cancel", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/asset-center?taskId=task_running"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/asset-center", element: createElement(AssetsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("正在生成 scene 2/4")
    })

    const cancelButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("终止任务"),
    )
    expect(cancelButton).toBeTruthy()

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.cancelTask)).toHaveBeenCalledWith("task_running")
      expect(container.textContent ?? "").toContain("正在终止当前任务")
    })
  })

  it("shows a resume button for failed tasks on the batch dashboard", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [createFailedTask()],
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/batch-dashboard"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/batch-dashboard", element: createElement(BatchDashboardPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("任务失败")
    })

    const resumeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("恢复运行"),
    )
    expect(resumeButton).toBeTruthy()

    await act(async () => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.resumeFailedTask)).toHaveBeenCalledWith("task_failed")
      expect(container.textContent ?? "").toContain("等待 worker 恢复处理")
    })
  })

  it("shows a resume button for stale running tasks on the batch dashboard", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        createRunningTask({
          id: "task_stale_running",
          title: "Stale running task",
          statusDetail: "关键画面生成中 3/4",
          updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          lastHeartbeatAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        }),
      ],
    } as any)
    vi.mocked(api.resumeFailedTask).mockResolvedValueOnce({
      task: createRunningTask({
        id: "task_stale_running",
        title: "Stale running task",
        status: "queued",
        statusDetail: "等待 worker 恢复处理",
        updatedAt: "2026-04-20T00:20:00.000Z",
      }),
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/batch-dashboard"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/batch-dashboard", element: createElement(BatchDashboardPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("关键画面生成中 3/4")
    })

    const resumeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("恢复卡住任务"),
    )
    expect(resumeButton).toBeTruthy()

    await act(async () => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.resumeFailedTask)).toHaveBeenCalledWith("task_stale_running")
      expect(container.textContent ?? "").toContain("等待 worker 恢复处理")
    })
  })

  it("shows production lanes, stuck-task signals, ETA, heartbeat, and capacity guidance", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        createRunningTask({
          id: "task_queued",
          title: "Queued task",
          status: "queued",
          progressPct: 0,
          currentStageLabel: null,
          statusDetail: "等待 worker 接单",
          updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        }),
        createRunningTask({
          id: "task_blocked",
          title: "Blocked task",
          statusDetail: "关键画面生成中 3/4",
          updatedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
          lastHeartbeatAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
          currentStageLabel: "关键画面生成",
          stageStartedAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
          workerId: "worker-a",
          activeJobId: "job-123",
        }),
        createFailedTask({
          id: "task_provider_failed",
          title: "Provider failed task",
          failureReason: "Video provider timeout after 60s",
          statusDetail: "视频 Provider 超时",
          updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        }),
        createRunningTask({
          id: "task_review",
          title: "Waiting review task",
          status: "running",
          progressPct: 45,
          blueprintStatus: "ready_for_review",
          statusDetail: "蓝图待人工审核",
          lastHeartbeatAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        }),
        createRunningTask({
          id: "task_completed",
          title: "Completed task",
          status: "completed",
          progressPct: 100,
          actualDurationSec: 30,
          statusDetail: "已完成",
        }),
      ],
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/batch-dashboard"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/batch-dashboard", element: createElement(BatchDashboardPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      const text = container.textContent ?? ""

      expect(text).toContain("生产调度台")
      expect(text).toContain("queued")
      expect(text).toContain("running")
      expect(text).toContain("waiting_review")
      expect(text).toContain("blocked")
      expect(text).toContain("failed")
      expect(text).toContain("completed")
      expect(text).toContain("卡住任务")
      expect(text).toContain("心跳")
      expect(text).toContain("预计剩余")
      expect(text).toContain("失败分类")
      expect(text).toContain("provider_timeout")
      expect(text).toContain("Worker / Redis 容量")
      expect(text).toContain("保守继续：先打开资产排查，再恢复卡住任务")
    })
  })

  it("shows a resume button for failed tasks in asset center and updates the task after resume", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [createFailedTask()],
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/asset-center?taskId=task_failed"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/asset-center", element: createElement(AssetsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("任务失败")
    })

    const resumeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("恢复运行"),
    )
    expect(resumeButton).toBeTruthy()

    await act(async () => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.resumeFailedTask)).toHaveBeenCalledWith("task_failed")
      expect(container.textContent ?? "").toContain("等待 worker 恢复处理")
    })
  })

  it("shows a resume button for stale running tasks in asset center", async () => {
    vi.mocked(api.getTaskDiagnostics).mockResolvedValueOnce({
      taskId: "task_stale_running",
      recoverable: true,
      recoveryReason: "stale_running_task",
      stale: {
        isStale: true,
        thresholdMs: 10 * 60 * 1000,
        ageMs: 20 * 60 * 1000,
        sourceUpdatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      },
      queue: {
        available: true,
        activeJobIds: [],
        waitingJobIds: [],
        delayedJobIds: [],
        prioritizedJobIds: [],
        pausedJobIds: [],
        failedJobIds: [],
      },
      assets: {
        readyCount: 0,
        deliverableReadyCount: 0,
        expectedNextAssetType: "keyframe_bundle",
      },
    } as any)
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        createRunningTask({
          id: "task_stale_running",
          title: "Stale running task",
          statusDetail: "关键画面生成中 3/4",
          updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        }),
      ],
    } as any)
    vi.mocked(api.resumeFailedTask).mockResolvedValueOnce({
      task: createRunningTask({
        id: "task_stale_running",
        title: "Stale running task",
        status: "queued",
        statusDetail: "等待 worker 恢复处理",
        updatedAt: "2026-04-20T00:20:00.000Z",
      }),
      detail: {
        taskId: "task_stale_running",
        projectId: "project_default",
        title: "Stale running task",
        script: "script",
        blueprintVersion: 1,
        blueprintStatus: "pending_generation",
        failureReason: null,
        statusDetail: "等待 worker 恢复处理",
        cancelRequestedAt: null,
        taskRunConfig: {
          projectId: "project_default",
          modeId: "high_quality",
          executionMode: "review_required",
          channelId: "tiktok",
          terminalPresetId: "phone_portrait",
          renderSpecJson: createRunningTask().renderSpecJson,
          targetDurationSec: 30,
          generationMode: "user_locked",
          audioStrategy: "tts_only",
          generationRoute: "multi_scene",
          routeReason: "target duration 30s exceeds the current model single-shot limit of 8s",
          planningVersion: "v1",
          blueprintVersion: 1,
          blueprintStatus: "pending_generation",
          textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
          imageModel: { id: "gpt-image2-private", label: "GPT-image2", provider: "openai-compatible" },
          videoModel: { id: "veo3.1", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
          ttsProvider: "edge-tts",
          contentLocale: "en",
          operatorLocale: "zh-CN",
          requireStoryboardReview: true,
          requireKeyframeReview: true,
          budgetLimitCny: 5,
          aspectRatio: "9:16",
          slotSnapshots: [],
        },
        scenes: [],
        updatedAt: "2026-04-20T00:20:00.000Z",
      },
      queue: {
        queued: true,
        reason: "resume_stale_running_task",
        continueExecution: false,
        resumeFrom: "stale_running_task",
      },
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/asset-center?taskId=task_stale_running"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/asset-center", element: createElement(AssetsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("关键画面生成中 3/4")
    })

    const resumeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("恢复卡住任务"),
    )
    expect(resumeButton).toBeTruthy()

    await act(async () => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.resumeFailedTask)).toHaveBeenCalledWith("task_stale_running")
      expect(container.textContent ?? "").toContain("等待 worker 恢复处理")
    })
  })
})
