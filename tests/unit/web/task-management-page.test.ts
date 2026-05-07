import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
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
      previewTaskBulkOperation: vi.fn(),
      deleteTaskBulk: vi.fn(),
      cancelTaskBulk: vi.fn(),
      resumeTaskBulk: vi.fn(),
    },
  }
})

import { api } from "../../../apps/web/src/api"
import { TaskManagementPage } from "../../../apps/web/src/pages/TaskManagementPage"

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

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_done",
    projectId: "project_default",
    title: "Completed task",
    modeId: "high_quality",
    executionMode: "automated",
    channelId: "tiktok",
    terminalPresetId: "phone_portrait",
    renderSpecJson: {
      terminalPresetId: "phone_portrait",
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
      compositionGuideline: "主体保持在竖屏中心安全区",
      motionGuideline: "轻推拉",
    },
    targetDurationSec: 30,
    generationMode: "user_locked",
    audioStrategy: "tts_only",
    subtitleStrategy: "tts_aligned",
    generationRoute: "multi_scene",
    routeReason: "多段生成",
    planningVersion: "v1",
    blueprintVersion: 1,
    blueprintStatus: "completed",
    actualDurationSec: 30,
    failureReason: null,
    statusDetail: "任务已完成",
    cancelRequestedAt: null,
    status: "completed",
    progressPct: 100,
    retryCount: 0,
    estimatedCostCny: 2.4,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    ...overrides,
  }
}

describe("TaskManagementPage", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    vi.mocked(api.runtimeStatus).mockResolvedValue({
      runtime: {
        api: { name: "api", status: "healthy", updatedAt: "now", message: "ok" },
        worker: { name: "worker", status: "healthy", updatedAt: "now", message: "ok" },
        redis: { name: "redis", status: "healthy", updatedAt: "now", message: "ok" },
      },
    })
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        createTask(),
        createTask({ id: "task_running", title: "Running task", status: "running", progressPct: 60, actualDurationSec: null }),
      ] as any,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it("previews bulk task deletion before executing it", async () => {
    vi.mocked(api.previewTaskBulkOperation).mockResolvedValue({
      operation: "delete_task_with_assets",
      summary: { total: 2, allowed: 1, blocked: 1 },
      items: [
        {
          taskId: "task_done",
          title: "Completed task",
          status: "completed",
          archived: false,
          allowed: true,
          reason: "可删除任务和素材",
          code: "ALLOWED",
          assetSummary: { assetCount: 3, hasFinalVideo: true, hasSubtitles: true, hasScript: true },
        },
        {
          taskId: "task_running",
          title: "Running task",
          status: "running",
          archived: false,
          allowed: false,
          reason: "任务还在生产或审核中，不能删除任务或素材",
          code: "TASK_ASSETS_LOCKED",
          assetSummary: { assetCount: 1, hasFinalVideo: false, hasSubtitles: false, hasScript: true },
        },
      ],
    })
    vi.mocked(api.deleteTaskBulk).mockResolvedValue({
      operationId: "bulk_1",
      operation: "delete_task_with_assets",
      status: "partially_completed",
      summary: { total: 2, success: 1, skipped: 1, failed: 0 },
      items: [],
    })

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(TaskManagementPage)))
    })

    await waitFor(() => {
      expect(container.textContent).toContain("综合任务管理台")
    })

    const allTasksTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("全部任务"))
    await act(async () => {
      allTasksTab?.click()
    })

    await waitFor(() => {
      expect(container.textContent).toContain("Completed task")
      expect(container.textContent).toContain("Running task")
    })

    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]
    await act(async () => {
      checkboxes[0]?.click()
    })
    const deleteButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "删除任务")
    await act(async () => {
      deleteButton?.click()
    })

    await waitFor(() => {
      expect(vi.mocked(api.previewTaskBulkOperation)).toHaveBeenCalledWith({
        taskIds: ["task_done", "task_running"],
        operation: "delete_task_with_assets",
      })
      expect(container.textContent).toContain("可执行 1 条，需跳过 1 条")
    })

    const textInputs = Array.from(container.querySelectorAll("input")).filter((input) => input.type !== "checkbox") as HTMLInputElement[]
    const confirmationInput = textInputs.at(-1) as HTMLInputElement
    await act(async () => {
      confirmationInput.value = "删除 1 个任务"
      confirmationInput.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const confirmButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "确认执行")
    await act(async () => {
      confirmButton?.click()
    })

    await waitFor(() => {
      expect(vi.mocked(api.deleteTaskBulk)).toHaveBeenCalledWith({
        taskIds: ["task_done", "task_running"],
        operation: "delete_task_with_assets",
        reason: "运营任务管理台批量操作",
        confirmationText: "删除 1 个任务",
      })
    })
  })
})
