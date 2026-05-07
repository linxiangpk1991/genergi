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
      getTaskTimeline: vi.fn(),
      deleteTask: vi.fn(),
      deleteTaskAsset: vi.fn(),
      deleteTaskAssets: vi.fn(),
    },
  }
})

import { api } from "../../../apps/web/src/api"
import { AssetsPage } from "../../../apps/web/src/pages/AssetsPage"

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

describe("AssetsPage inline preview", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        {
          id: "task_assets",
          projectId: "project_default",
          title: "Asset task",
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
          targetDurationSec: 15,
          generationMode: "system_enhanced",
          generationRoute: "multi_scene",
          routeReason: "target duration exceeds single-shot limit",
          planningVersion: "v1",
          blueprintVersion: 1,
          blueprintStatus: "completed",
          actualDurationSec: 14.8,
          status: "completed",
          progressPct: 100,
          retryCount: 0,
          estimatedCostCny: 4.2,
          modelUsage: {
            textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
            imageModel: { id: "gemini-3-pro-image-preview-2k", label: "Gemini 3 Pro Image Preview 2k", provider: "openai-compatible" },
            videoModel: { id: "veo3.1", label: "Veo 3.1 Portrait HD", provider: "openai-compatible" },
            ttsProvider: "edge-tts",
          },
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    } as any)

    vi.mocked(api.runtimeStatus).mockResolvedValue({
      runtime: {
        api: { name: "api", status: "healthy", updatedAt: "2026-04-20T00:00:00.000Z", message: "ok" },
        worker: { name: "worker", status: "healthy", updatedAt: "2026-04-20T00:00:00.000Z", message: "ok" },
        redis: { name: "redis", status: "healthy", updatedAt: "2026-04-20T00:00:00.000Z", message: "ok" },
      },
    } as any)

    vi.mocked(api.getTaskAssets).mockResolvedValue({
      assets: [
        {
          id: "task_assets_source",
          taskId: "task_assets",
          assetType: "source_script",
          label: "任务原始文案",
          status: "ready",
          path: "/tmp/source-script.txt",
          createdAt: "2026-04-20T00:00:00.000Z",
          fileName: "source-script.txt",
          directoryName: "/tmp",
          displayPath: "/tmp/source-script.txt",
          extension: ".txt",
          mimeType: "text/plain; charset=utf-8",
          sizeBytes: 30,
          sizeLabel: "30 B",
          exists: true,
          isDirectory: false,
          previewable: true,
          previewKind: "text",
          modifiedAt: "2026-04-20T00:00:00.000Z",
          downloadFileName: "source-script.txt",
        },
      ],
    } as any)
    vi.mocked(api.getTaskTimeline).mockResolvedValue({
      timeline: [
        {
          id: "timeline_1",
          taskId: "task_assets",
          sequence: 1,
          type: "stage",
          stage: "keyframe_generation",
          label: "关键画面生成中 3/4",
          level: "info",
          summary: "关键画面生成中 3/4",
          createdAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    } as any)
    vi.mocked(api.deleteTaskAsset).mockResolvedValue({ deleted: true, taskId: "task_assets", assetId: "task_assets_source" } as any)
    vi.mocked(api.deleteTask).mockResolvedValue({ deleted: true, taskId: "task_assets" } as any)

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "Original source script.",
    } as any)
    vi.spyOn(window, "confirm").mockReturnValue(true)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
  })

  it("shows text assets inline instead of forcing download flow", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/asset-center?taskId=task_assets"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/asset-center", element: createElement(AssetsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(vi.mocked(api.getTaskAssets)).toHaveBeenCalledWith("task_assets")
      expect(container.textContent ?? "").toContain("任务时间线")
      expect(container.textContent ?? "").toContain("关键画面生成中 3/4")
      expect(container.textContent ?? "").toContain("本次使用的模型")
      expect(container.textContent ?? "").toContain("Claude Opus 4.6")
      expect(container.textContent ?? "").toContain("Gemini 3 Pro Image Preview 2k")
      expect(container.textContent ?? "").toContain("Veo 3.1 Portrait HD")
    })

    const previewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("预览"),
    )
    expect(previewButton).toBeTruthy()

    await act(async () => {
      previewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("Original source script.")
    })
  })

  it("confirms asset deletion, refreshes the asset list, and shows success feedback", async () => {
    vi.mocked(api.getTaskAssets)
      .mockResolvedValueOnce({
        assets: [
          {
            id: "task_assets_source",
            taskId: "task_assets",
            assetType: "source_script",
            label: "任务原始文案",
            status: "ready",
            path: "/tmp/source-script.txt",
            createdAt: "2026-04-20T00:00:00.000Z",
            fileName: "source-script.txt",
            directoryName: "/tmp",
            displayPath: "/tmp/source-script.txt",
            extension: ".txt",
            mimeType: "text/plain; charset=utf-8",
            sizeBytes: 30,
            sizeLabel: "30 B",
            exists: true,
            isDirectory: false,
            previewable: true,
            previewKind: "text",
            modifiedAt: "2026-04-20T00:00:00.000Z",
            downloadFileName: "source-script.txt",
          },
        ],
      } as any)
      .mockResolvedValueOnce({ assets: [] } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/asset-center?taskId=task_assets"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/asset-center", element: createElement(AssetsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("任务原始文案")
    })

    const moreButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("更多"),
    )
    expect(moreButton).toBeTruthy()

    await act(async () => {
      moreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const deleteButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("删除素材"),
    )
    expect(deleteButton).toBeTruthy()

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("任务原始文案"))
      expect(vi.mocked(api.deleteTaskAsset)).toHaveBeenCalledWith("task_assets", "task_assets_source")
      expect(container.textContent ?? "").toContain("已删除素材：任务原始文案")
      expect(container.textContent ?? "").toContain("当前暂无记录")
    })
  })

  it("keeps the full task cleanup button visible even when no assets are listed", async () => {
    vi.mocked(api.getTaskAssets)
      .mockResolvedValueOnce({ assets: [] } as any)
      .mockResolvedValueOnce({ assets: [] } as any)
    vi.mocked(api.deleteTaskAssets).mockResolvedValue({
      deleted: true,
      taskId: "task_assets",
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/asset-center?taskId=task_assets"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/asset-center", element: createElement(AssetsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("当前暂无记录")
    })

    const clearButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("清空当前任务素材"),
    )
    expect(clearButton).toBeTruthy()

    await act(async () => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("全部素材文件"))
      expect(vi.mocked(api.deleteTaskAssets)).toHaveBeenCalledWith("task_assets")
      expect(container.textContent ?? "").toContain("已清空任务素材：Asset task")
    })
  })

  it("lets operators delete the whole current task from asset center", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/asset-center?taskId=task_assets"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/asset-center", element: createElement(AssetsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("Asset task")
    })

    const deleteTaskButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("删除当前任务"),
    )
    expect(deleteTaskButton).toBeTruthy()

    await act(async () => {
      deleteTaskButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("删除整个任务"))
      expect(vi.mocked(api.deleteTask)).toHaveBeenCalledWith("task_assets")
      expect(container.textContent ?? "").toContain("已删除任务：Asset task")
      expect(container.textContent ?? "").toContain("请先从任务列表中选择一条任务。")
    })
  })

  it("separates failure reason from scene routing basis on failed tasks", async () => {
    vi.mocked(api.listTasks).mockResolvedValueOnce({
      tasks: [
        {
          id: "task_failed",
          projectId: "project_default",
          title: "Failed asset task",
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
          routeReason: "target duration 30s exceeds the current model single-shot limit of 8s",
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
        },
      ],
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
      const text = container.textContent ?? ""
      expect(text).toContain("失败原因")
      expect(text).toContain("Scene 2 video generation timeout")
      expect(text).toContain("视频结构依据")
      expect(text).toContain("target duration 30s exceeds the current model single-shot limit of 8s")
    })
  })

  it("shows asset loading failures as errors instead of normal empty output", async () => {
    vi.mocked(api.getTaskAssets).mockRejectedValueOnce(new Error("asset index unavailable"))

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/asset-center?taskId=task_assets"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/asset-center", element: createElement(AssetsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("素材列表加载失败")
      expect(text).toContain("素材加载失败")
      expect(text).toContain("请先处理上方错误")
      expect(text).not.toContain("当前暂无记录 · 等待任务继续产出")
    })
  })
})
