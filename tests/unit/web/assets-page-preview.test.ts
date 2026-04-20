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
          label: "任务母本",
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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "Original source script.",
    } as any)
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
      expect(text).toContain("分镜路由依据")
      expect(text).toContain("target duration 30s exceeds the current model single-shot limit of 8s")
    })
  })
})
