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
      cancelTask: vi.fn(),
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
})
