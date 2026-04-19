import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../apps/web/src/api", async () => {
  const actual = await vi.importActual<typeof import("../../../apps/web/src/api")>("../../../apps/web/src/api")
  return {
    ...actual,
    api: {
      ...actual.api,
      bootstrap: vi.fn(),
      listTasks: vi.fn(),
      getSelectableModelPools: vi.fn(),
      createTask: vi.fn(),
    },
  }
})

import {
  api,
  type BootstrapResponse,
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
      { id: "mass_production", label: "量产模式", description: "量产", budgetLimitCny: 3, maxSingleShotSec: 8 },
      { id: "high_quality", label: "高质量模式", description: "高质", budgetLimitCny: 5, maxSingleShotSec: 8 },
    ],
    generationPreferences: [
      { id: "user_locked", label: "忠于原脚本", description: "保留原始表达" },
      { id: "system_enhanced", label: "启用系统增强", description: "增强传播表达" },
    ],
  }
}

function createSelectablePoolsResponse(): SelectableModelPoolsResponse {
  return {
    modeId: "mass_production",
    pools: {
      textModel: {
        slotType: "textModel",
        options: [{ recordId: "text-default", valueId: "text-default", displayName: "Claude Opus 4.6", providerDisplayName: "Anthropic" }],
        globalDefaultId: "text-default",
        modeDefaultId: "text-default",
        effectiveId: "text-default",
      },
      imageModel: {
        slotType: "imageModel",
        options: [{ recordId: "image-default", valueId: "image-default", displayName: "Gemini 3 Pro Image Preview", providerDisplayName: "OpenAI Compatible" }],
        globalDefaultId: "image-default",
        modeDefaultId: "image-default",
        effectiveId: "image-default",
      },
      videoModel: {
        slotType: "videoModel",
        options: [{ recordId: "video-default", valueId: "video-default", displayName: "Veo 3.1 Portrait", providerDisplayName: "OpenAI Compatible" }],
        globalDefaultId: "video-default",
        modeDefaultId: "video-default",
        effectiveId: "video-default",
      },
      ttsProvider: {
        slotType: "ttsProvider",
        options: [{ recordId: "provider_edge_tts", valueId: "provider_edge_tts", displayName: "Edge TTS", providerDisplayName: "edge-tts" }],
        globalDefaultId: "provider_edge_tts",
        modeDefaultId: "provider_edge_tts",
        effectiveId: "provider_edge_tts",
      },
    },
  }
}

describe("HomePage four-slot advanced overrides", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(api.bootstrap).mockResolvedValue(createBootstrapResponse())
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] })
    vi.mocked(api.getSelectableModelPools).mockResolvedValue(createSelectablePoolsResponse())
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it("renders only the four runtime slots in the advanced override panel", async () => {
    await act(async () => {
      root.render(createElement(HomePage))
    })

    await waitFor(() => {
      expect(vi.mocked(api.getSelectableModelPools)).toHaveBeenCalledWith("mass_production")
    })

    const toggleButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("展开高级覆盖"),
    )
    expect(toggleButton).toBeTruthy()

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(container.querySelectorAll(".slot-override-card")).toHaveLength(4)
    })

    const text = container.textContent ?? ""
    expect(text).toContain("文案规划")
    expect(text).toContain("图片模型")
    expect(text).toContain("视频模型")
    expect(text).toContain("TTS 配音")
    expect(text).not.toContain("草图出图")
    expect(text).not.toContain("终稿出图")
    expect(text).not.toContain("草稿视频")
    expect(text).not.toContain("终稿视频")
  })
})
