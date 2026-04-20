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
      getModelDefaults: vi.fn(),
      getSelectableModelPools: vi.fn(),
      updateGlobalModelDefaults: vi.fn(),
      updateModeModelDefaults: vi.fn(),
      listModelProviders: vi.fn(),
      listModelRegistry: vi.fn(),
    },
  }
})

import { api } from "../../../apps/web/src/api"
import { ModelControlCenterPage } from "../../../apps/web/src/pages/ModelControlCenterPage"
import { ModelDefaultsPage } from "../../../apps/web/src/pages/ModelDefaultsPage"

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

function createDefaultsResponse() {
  return {
    global: {
      textModel: { recordId: "text-global", displayName: "Global Text", providerDisplayName: "Anthropic" },
      imageModel: { recordId: "image-global", displayName: "Global Image", providerDisplayName: "Google" },
      videoModel: { recordId: "video-global", displayName: "Global Video", providerDisplayName: "Google" },
      ttsProvider: { recordId: "tts-global", displayName: "Edge TTS", providerDisplayName: "edge-tts" },
    },
    modes: {
      mass_production: {
        textModel: { recordId: "text-mass", displayName: "Mass Text", providerDisplayName: "Anthropic" },
      },
      high_quality: {
        textModel: { recordId: "text-hq", displayName: "HQ Text", providerDisplayName: "Anthropic" },
        imageModel: { recordId: "image-hq", displayName: "HQ Image", providerDisplayName: "Google" },
        videoModel: { recordId: "video-hq", displayName: "HQ Video", providerDisplayName: "Google" },
        ttsProvider: { recordId: "tts-hq", displayName: "HeadTTS", providerDisplayName: "headtts" },
      },
    },
  }
}

function createSelectablePoolsResponse() {
  return {
    modeId: "high_quality",
    pools: {
      textModel: {
        slotType: "textModel",
        options: [
          { recordId: "text-global", displayName: "Global Text", providerDisplayName: "Anthropic" },
          { recordId: "text-hq", displayName: "HQ Text", providerDisplayName: "Anthropic" },
        ],
        globalDefaultId: "text-global",
        modeDefaultId: "text-hq",
        effectiveId: "text-hq",
      },
      imageModel: {
        slotType: "imageModel",
        options: [
          { recordId: "image-global", displayName: "Global Image", providerDisplayName: "Google" },
          { recordId: "image-hq", displayName: "HQ Image", providerDisplayName: "Google" },
        ],
        globalDefaultId: "image-global",
        modeDefaultId: "image-hq",
        effectiveId: "image-hq",
      },
      videoModel: {
        slotType: "videoModel",
        options: [
          { recordId: "video-global", displayName: "Global Video", providerDisplayName: "Google" },
          { recordId: "video-hq", displayName: "HQ Video", providerDisplayName: "Google" },
        ],
        globalDefaultId: "video-global",
        modeDefaultId: "video-hq",
        effectiveId: "video-hq",
      },
      ttsProvider: {
        slotType: "ttsProvider",
        options: [
          { recordId: "tts-global", displayName: "Edge TTS", providerDisplayName: "edge-tts" },
          { recordId: "tts-hq", displayName: "HeadTTS", providerDisplayName: "headtts" },
        ],
        globalDefaultId: "tts-global",
        modeDefaultId: "tts-hq",
        effectiveId: "tts-hq",
      },
    },
  }
}

describe("model control single-path surfaces", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(api.getModelDefaults).mockResolvedValue(createDefaultsResponse() as any)
    vi.mocked(api.getSelectableModelPools).mockResolvedValue(createSelectablePoolsResponse() as any)
    vi.mocked(api.updateGlobalModelDefaults).mockResolvedValue(createDefaultsResponse() as any)
    vi.mocked(api.updateModeModelDefaults).mockResolvedValue(createDefaultsResponse() as any)
    vi.mocked(api.listModelProviders).mockResolvedValue({
      providers: [
        {
          id: "provider_openai_compatible",
          providerKey: "openai-compatible",
          providerType: "openai-compatible",
          displayName: "OpenAI Compatible",
          endpointUrl: "https://example.com",
          authType: "bearer_token",
          status: "available",
        },
      ],
    } as any)
    vi.mocked(api.listModelRegistry).mockResolvedValue({
      models: [
        {
          id: "model_text_hq",
          modelKey: "claude-opus",
          providerId: "provider_openai_compatible",
          providerDisplayName: "OpenAI Compatible",
          slotType: "textModel",
          providerModelId: "claude-opus",
          displayName: "Claude Opus",
          lifecycleStatus: "available",
          capabilityJson: {},
        },
      ],
    } as any)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it("loads defaults page around one task-creation default instead of dual modes", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center/defaults"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center/defaults", element: createElement(ModelDefaultsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(vi.mocked(api.getSelectableModelPools)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(api.getSelectableModelPools)).toHaveBeenCalledWith("high_quality")
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("任务创建默认值")
      expect(text).not.toContain("量产模式")
      expect(text).not.toContain("高质量模式")
      expect(text).not.toContain("模式默认")
    })
  })

  it("shows model control overview in terms of task-creation defaults rather than mode pairs", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center", element: createElement(ModelControlCenterPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("任务创建默认值")
      expect(text).not.toContain("量产模式")
      expect(text).not.toContain("高质量模式")
      expect(text).not.toContain("模式默认值")
    })
  })
})
