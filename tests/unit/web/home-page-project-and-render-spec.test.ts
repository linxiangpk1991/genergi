import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../apps/web/src/api", async () => {
  const actual = await vi.importActual<typeof import("../../../apps/web/src/api")>(
    "../../../apps/web/src/api",
  )
  return {
    ...actual,
    api: {
      ...actual.api,
      bootstrap: vi.fn(),
      listTasks: vi.fn(),
      listProjects: vi.fn(),
      getSelectableModelPools: vi.fn(),
      createTask: vi.fn(),
    },
  }
})

import {
  api,
  type BootstrapResponse,
  type ProjectRecord,
  type SelectableModelPoolsResponse,
} from "../../../apps/web/src/api"
import { HomePage } from "../../../apps/web/src/pages/HomePage"

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

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

function createBootstrapResponse(): BootstrapResponse {
  return {
    brand: {
      productName: "GENERGI 自动化视频平台",
      companyName: "Genergius",
      domain: "ai.genergius.com",
    },
    durationOptions: [15, 30, 45, 60],
    channels: [
      { id: "tiktok", label: "TikTok", description: "短节奏、强钩子、英语优先" },
      { id: "reels", label: "Instagram Reels", description: "视觉感更强" },
    ],
    modes: [
      {
        id: "mass_production",
        label: "量产模式",
        description: "量产",
        budgetLimitCny: 3,
        maxSingleShotSec: 8,
        executionMode: "automated",
      },
      {
        id: "high_quality",
        label: "高质量模式",
        description: "高质",
        budgetLimitCny: 5,
        maxSingleShotSec: 8,
        executionMode: "review_required",
      },
    ],
    generationPreferences: [
      { id: "user_locked", label: "忠于原脚本", description: "保留原始表达" },
      { id: "system_enhanced", label: "启用系统增强", description: "增强传播表达" },
    ],
  }
}

function createProjects(): ProjectRecord[] {
  return [
    {
      id: "project_default",
      name: "Default Project",
      description: "默认项目",
      brandDirection: "高转化",
      defaultChannelIds: ["tiktok"],
      reusableStyleConstraints: ["高对比"],
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
    },
    {
      id: "project_campaign",
      name: "Campaign Project",
      description: "Campaign rollout",
      brandDirection: "品牌质感",
      defaultChannelIds: ["reels"],
      reusableStyleConstraints: ["产品居中"],
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
    },
  ]
}

function createSelectablePoolsResponse(): SelectableModelPoolsResponse {
  return {
    modeId: "mass_production",
    pools: {
      textModel: {
        slotType: "textModel",
        options: [{ recordId: "text-default", displayName: "Claude Opus 4.6", providerDisplayName: "Anthropic" }],
        globalDefaultId: "text-default",
        modeDefaultId: "text-default",
        effectiveId: "text-default",
      },
      imageModel: {
        slotType: "imageModel",
        options: [{ recordId: "image-default", displayName: "Gemini 3 Pro Image Preview", providerDisplayName: "OpenAI Compatible" }],
        globalDefaultId: "image-default",
        modeDefaultId: "image-default",
        effectiveId: "image-default",
      },
      videoModel: {
        slotType: "videoModel",
        options: [{ recordId: "video-default", displayName: "Veo 3.1 Portrait", providerDisplayName: "OpenAI Compatible" }],
        globalDefaultId: "video-default",
        modeDefaultId: "video-default",
        effectiveId: "video-default",
      },
      ttsProvider: {
        slotType: "ttsProvider",
        options: [{ recordId: "provider_edge_tts", displayName: "Edge TTS", providerDisplayName: "edge-tts" }],
        globalDefaultId: "provider_edge_tts",
        modeDefaultId: "provider_edge_tts",
        effectiveId: "provider_edge_tts",
      },
    },
  }
}

describe("HomePage project and terminal preset flow", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(api.bootstrap).mockResolvedValue(createBootstrapResponse())
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] })
    vi.mocked(api.listProjects).mockResolvedValue({ projects: createProjects() })
    vi.mocked(api.getSelectableModelPools).mockResolvedValue(createSelectablePoolsResponse())
    vi.mocked(api.createTask).mockResolvedValue({
      task: {
        id: "task_created",
        projectId: "project_campaign",
        title: "Campaign launch",
        modeId: "high_quality",
        executionMode: "review_required",
        channelId: "reels",
        terminalPresetId: "tablet_landscape",
        renderSpecJson: {
          terminalPresetId: "tablet_landscape",
          width: 2048,
          height: 1536,
          aspectRatio: "4:3",
          safeArea: { topPct: 7, rightPct: 6, bottomPct: 7, leftPct: 6 },
          compositionGuideline: "适合横向场景展开",
          motionGuideline: "允许横向环境展开",
        },
        targetDurationSec: 30,
        generationMode: "system_enhanced",
        generationRoute: "multi_scene",
        routeReason: "target duration exceeds single-shot limit",
        planningVersion: "v1",
        blueprintVersion: 1,
        blueprintStatus: "pending_generation",
        actualDurationSec: null,
        status: "queued",
        progressPct: 0,
        retryCount: 0,
        estimatedCostCny: 5,
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
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

  it("creates a task with projectId and terminalPresetId while showing execution mode and render spec summary", async () => {
    await act(async () => {
      root.render(createElement(HomePage))
    })

    await waitFor(() => {
      expect(vi.mocked(api.listProjects)).toHaveBeenCalledTimes(1)
    })

    const titleInput = container.querySelector('input[placeholder*="夏季新品种草短视频"]') as HTMLInputElement | null
    const scriptInput = container.querySelector('textarea[placeholder*="直接写你要表达的内容"]') as HTMLTextAreaElement | null
    expect(titleInput).toBeTruthy()
    expect(scriptInput).toBeTruthy()

    await act(async () => {
      setInputValue(titleInput!, "Campaign launch")
      setInputValue(
        scriptInput!,
        "Lead with the problem, show the product, end on a direct CTA.",
      )
    })

    const highQualityButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("高质量模式"),
    )
    expect(highQualityButton).toBeTruthy()

    await act(async () => {
      highQualityButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const selects = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[]
    const projectSelect = selects.find((select) => Array.from(select.options).some((option) => option.value === "project_campaign"))
    const terminalPresetSelect = selects.find((select) => Array.from(select.options).some((option) => option.value === "tablet_landscape"))

    expect(projectSelect).toBeTruthy()
    expect(terminalPresetSelect).toBeTruthy()

    await act(async () => {
      projectSelect!.value = "project_campaign"
      projectSelect!.dispatchEvent(new Event("change", { bubbles: true }))
      terminalPresetSelect!.value = "tablet_landscape"
      terminalPresetSelect!.dispatchEvent(new Event("change", { bubbles: true }))
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("review_required")
      expect(text).toContain("2048 × 1536")
      expect(text).toContain("4:3")
    })

    const submitButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("启动渲染队列"),
    )
    expect(submitButton).toBeTruthy()

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.createTask)).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("提交成功")
      expect(text).toContain("任务“Campaign launch”已提交到渲染队列。关键画面生成完成后，会进入任务审核队列。")
      expect(text).toContain("查看生产看板")
      expect(text).toContain("打开任务资产")
    })

    const payload = vi.mocked(api.createTask).mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      title: "Campaign launch",
      projectId: "project_campaign",
      terminalPresetId: "tablet_landscape",
      modeId: "high_quality",
      channelId: "tiktok",
      generationMode: "user_locked",
    })
    expect(payload).not.toHaveProperty("aspectRatio")
  })
})
