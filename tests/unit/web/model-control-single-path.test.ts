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
      listModelDiagnostics: vi.fn(),
      getModelQualitySummary: vi.fn(),
      createModelRegistryEntry: vi.fn(),
      updateModelRegistryEntry: vi.fn(),
      validateModelRegistryEntry: vi.fn(),
      getModelRoutingPolicies: vi.fn(),
      updateModelRoutingPolicies: vi.fn(),
    },
  }
})

import { api } from "../../../apps/web/src/api"
import { ModelControlCenterPage } from "../../../apps/web/src/pages/ModelControlCenterPage"
import { ModelDefaultsPage } from "../../../apps/web/src/pages/ModelDefaultsPage"
import { ModelDiagnosticsPage } from "../../../apps/web/src/pages/ModelDiagnosticsPage"
import { ModelRegistryPage } from "../../../apps/web/src/pages/ModelRegistryPage"
import { ModelRoutingPage } from "../../../apps/web/src/pages/ModelRoutingPage"

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

function createRoutingPoliciesResponse() {
  const emptyPolicy = {
    enabled: false,
    strategy: "balanced",
    primary: null,
    fallbacks: [],
    fallbackTriggers: ["timeout", "rate_limit", "provider_error"],
    operatorNote: "",
  }
  const slots = {
    textModel: emptyPolicy,
    imageModel: {
      ...emptyPolicy,
      enabled: true,
      strategy: "quality_first",
      primary: { modelId: "image-hq" },
      fallbacks: [{ modelId: "image-global" }],
      operatorNote: "图片优先保证人物一致。",
    },
    videoModel: emptyPolicy,
    ttsProvider: emptyPolicy,
  }
  return {
    policies: {
      global: slots,
      modes: {
        mass_production: slots,
        high_quality: slots,
      },
      updatedAt: "2026-05-09T08:00:00.000Z",
    },
    resolved: {
      global: {
        textModel: { ...emptyPolicy, strategyLabel: "均衡", primary: null, fallbacks: [], fallbackTriggerLabels: [], warnings: [], summary: "全局未启用路由策略，将继续使用默认模型。" },
        imageModel: { ...emptyPolicy, enabled: true, strategyLabel: "高质量优先", primary: { recordId: "image-hq", displayName: "HQ Image" }, fallbacks: [{ recordId: "image-global", displayName: "Global Image" }], fallbackTriggerLabels: ["调用超时"], warnings: [], summary: "全局启用高质量优先，主模型HQ Image，备用1个。" },
        videoModel: { ...emptyPolicy, strategyLabel: "均衡", primary: null, fallbacks: [], fallbackTriggerLabels: [], warnings: [], summary: "全局未启用路由策略，将继续使用默认模型。" },
        ttsProvider: { ...emptyPolicy, strategyLabel: "均衡", primary: null, fallbacks: [], fallbackTriggerLabels: [], warnings: [], summary: "全局未启用路由策略，将继续使用默认模型。" },
      },
      mass_production: {
        textModel: { ...emptyPolicy, strategyLabel: "均衡", primary: null, fallbacks: [], fallbackTriggerLabels: [], warnings: [], summary: "量产模式未启用路由策略，将继续使用默认模型。" },
        imageModel: { ...emptyPolicy, enabled: true, strategyLabel: "高质量优先", primary: { recordId: "image-hq", displayName: "HQ Image" }, fallbacks: [{ recordId: "image-global", displayName: "Global Image" }], fallbackTriggerLabels: ["调用超时"], warnings: [], summary: "量产模式启用高质量优先，主模型HQ Image，备用1个。" },
        videoModel: { ...emptyPolicy, strategyLabel: "均衡", primary: null, fallbacks: [], fallbackTriggerLabels: [], warnings: [], summary: "量产模式未启用路由策略，将继续使用默认模型。" },
        ttsProvider: { ...emptyPolicy, strategyLabel: "均衡", primary: null, fallbacks: [], fallbackTriggerLabels: [], warnings: [], summary: "量产模式未启用路由策略，将继续使用默认模型。" },
      },
      high_quality: {
        textModel: { ...emptyPolicy, strategyLabel: "均衡", primary: null, fallbacks: [], fallbackTriggerLabels: [], warnings: [], summary: "高质量模式未启用路由策略，将继续使用默认模型。" },
        imageModel: { ...emptyPolicy, enabled: true, strategyLabel: "高质量优先", primary: { recordId: "image-hq", displayName: "HQ Image" }, fallbacks: [{ recordId: "image-global", displayName: "Global Image" }], fallbackTriggerLabels: ["调用超时"], warnings: [], summary: "高质量模式启用高质量优先，主模型HQ Image，备用1个。" },
        videoModel: { ...emptyPolicy, strategyLabel: "均衡", primary: null, fallbacks: [], fallbackTriggerLabels: [], warnings: [], summary: "高质量模式未启用路由策略，将继续使用默认模型。" },
        ttsProvider: { ...emptyPolicy, strategyLabel: "均衡", primary: null, fallbacks: [], fallbackTriggerLabels: [], warnings: [], summary: "高质量模式未启用路由策略，将继续使用默认模型。" },
      },
    },
    strategyOptions: [
      { value: "balanced", label: "均衡" },
      { value: "quality_first", label: "高质量优先" },
      { value: "speed_first", label: "速度优先" },
      { value: "cost_first", label: "成本优先" },
    ],
    triggerOptions: [
      { value: "timeout", label: "调用超时" },
      { value: "rate_limit", label: "限流" },
      { value: "provider_error", label: "接入方错误" },
    ],
    updatedAt: "2026-05-09T08:00:00.000Z",
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
    vi.mocked(api.listModelDiagnostics).mockResolvedValue({ diagnostics: [] } as any)
    vi.mocked(api.getModelQualitySummary).mockResolvedValue({ totalCount: 0, items: [], updatedAt: null } as any)
    vi.mocked(api.getModelRoutingPolicies).mockResolvedValue(createRoutingPoliciesResponse() as any)
    vi.mocked(api.updateModelRoutingPolicies).mockResolvedValue(createRoutingPoliciesResponse() as any)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it("loads defaults page with a visible high-quality and mass-production mode switch", async () => {
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
      expect(text).toContain("高质量模式默认")
      expect(text).toContain("量产模式")
      expect(text).toContain("当前新任务生效组合")
      expect(text).toContain("默认与覆盖")
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

  it("shows GPT-5 family text models as Responses API instead of chat completions", async () => {
    vi.mocked(api.listModelRegistry).mockResolvedValue({
      models: [
        {
          id: "model_gpt_55",
          modelKey: "gpt-5-5",
          providerId: "provider_openai_compatible",
          providerDisplayName: "OpenAI Responses",
          slotType: "textModel",
          providerModelId: "gpt-5.5",
          displayName: "GPT-5.5",
          lifecycleStatus: "available",
          capabilityJson: {
            family: "gpt",
            usage: "text-planning",
            endpointStyle: "responses",
            wireApi: "responses",
          },
        },
      ],
    } as any)
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center/registry"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center/registry", element: createElement(ModelRegistryPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("GPT-5.5")
      expect(text).toContain("Responses API")
      expect(text).toContain("/v1/responses")
      expect(text).not.toContain("endpointStyle: chat-completions")
    })
  })

  it("labels older Gemini image records by model id when image transport is missing", async () => {
    vi.mocked(api.listModelRegistry).mockResolvedValue({
      models: [
        {
          id: "model_gemini_image",
          modelKey: "gemini-image",
          providerId: "provider_gemini",
          providerDisplayName: "Gemini Image",
          slotType: "imageModel",
          providerModelId: "gemini-3.1-flash-image-preview",
          displayName: "Gemini 3.1 Flash Image Preview",
          lifecycleStatus: "available",
          capabilityJson: {
            provider: "openai-compatible",
          },
        },
      ],
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center/registry"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center/registry", element: createElement(ModelRegistryPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("Gemini 3.1 Flash Image Preview")
      expect(text).toContain("Gemini Generate Content")
      expect(text).toContain(":generateContent")
      expect(text).not.toContain("图片调用方式未标注")
    })
  })

  it("shows the latest model smoke diagnostic on the model registry page", async () => {
    vi.mocked(api.listModelRegistry).mockResolvedValue({
      models: [
        {
          id: "model_gpt_55",
          modelKey: "gpt-5-5",
          providerId: "provider_openai_compatible",
          providerDisplayName: "OpenAI Direct",
          slotType: "textModel",
          providerModelId: "gpt-5.5",
          displayName: "GPT-5.5",
          lifecycleStatus: "invalid",
          capabilityJson: {
            wireApi: "responses",
          },
        },
      ],
    } as any)
    vi.mocked(api.listModelDiagnostics).mockResolvedValue({
      diagnostics: [
        {
          id: "diag_1",
          providerId: "provider_openai_compatible",
          providerDisplayName: "OpenAI Direct",
          providerType: "direct-openai",
          modelId: "model_gpt_55",
          modelDisplayName: "GPT-5.5",
          slotType: "textModel",
          providerModelId: "gpt-5.5",
          transport: "direct-openai",
          wireApi: "responses",
          requestPath: "/v1/responses",
          smokeMode: "connectivity",
          status: "failed",
          statusCode: 401,
          durationMs: 238,
          errorCategory: "auth_error",
          errorMessage: "密钥错误: Incorrect API key provided",
          createdAt: "2026-05-08T09:00:00.000Z",
        },
        {
          id: "diag_0",
          providerId: "provider_openai_compatible",
          providerDisplayName: "OpenAI Direct",
          providerType: "direct-openai",
          modelId: "model_gpt_55",
          modelDisplayName: "GPT-5.5",
          slotType: "textModel",
          providerModelId: "gpt-5.5",
          transport: "direct-openai",
          wireApi: "responses",
          requestPath: "/v1/responses",
          smokeMode: "connectivity",
          status: "success",
          statusCode: 200,
          durationMs: 180,
          errorCategory: null,
          errorMessage: null,
          createdAt: "2026-05-08T08:00:00.000Z",
        },
      ],
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center/registry"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center/registry", element: createElement(ModelRegistryPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("最近检查")
      expect(text).toContain("Responses API")
      expect(text).toContain("/v1/responses")
      expect(text).toContain("238ms")
      expect(text).toContain("密钥错误")
      expect(text).toContain("最近一次成功")
    })
  })

  it("shows model diagnostic records with classified errors and request paths", async () => {
    vi.mocked(api.listModelDiagnostics).mockResolvedValue({
      diagnostics: [
        {
          id: "diag_1",
          providerId: "provider_openai_direct",
          providerDisplayName: "OpenAI Direct",
          providerType: "direct-openai",
          modelId: "model_gpt_55",
          modelDisplayName: "GPT-5.5",
          slotType: "textModel",
          providerModelId: "gpt-5.5",
          transport: "direct-openai",
          wireApi: "responses",
          requestPath: "/v1/responses",
          smokeMode: "connectivity",
          status: "failed",
          statusCode: 401,
          durationMs: 311,
          errorCategory: "auth_error",
          errorMessage: "密钥错误: Incorrect API key provided",
          createdAt: "2026-05-08T09:00:00.000Z",
        },
      ],
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center/diagnostics"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center/diagnostics", element: createElement(ModelDiagnosticsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("模型检查记录")
      expect(text).toContain("GPT-5.5")
      expect(text).toContain("密钥或权限问题")
      expect(text).toContain("/v1/responses")
      expect(text).toContain("密钥错误")
      expect(text).not.toContain("sk-live-secret")
    })
  })

  it("shows recent operator quality issues on the diagnostics page", async () => {
    vi.mocked(api.getModelQualitySummary).mockResolvedValue({
      totalCount: 3,
      updatedAt: "2026-05-10T08:00:00.000Z",
      items: [
        {
          slotType: "imageModel",
          slotLabel: "图片模型",
          modelId: "image-hq",
          modelDisplayName: "HQ Image",
          providerModelId: "gemini-3-pro-image-preview",
          providerDisplayName: "Google",
          issueCategory: "character_unstable",
          reasonLabel: "人物不稳定",
          count: 3,
          latestAt: "2026-05-10T08:00:00.000Z",
        },
      ],
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center/diagnostics"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center/diagnostics", element: createElement(ModelDiagnosticsPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("最近质量问题")
      expect(text).toContain("HQ Image")
      expect(text).toContain("人物不稳定")
      expect(text).toContain("3 次")
    })
  })

  it("shows a routing strategy center with primary models, fallback models, and plain-language rules", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center/routing"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center/routing", element: createElement(ModelRoutingPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(vi.mocked(api.getModelRoutingPolicies)).toHaveBeenCalled()
      const text = container.textContent ?? ""
      expect(text).toContain("路由策略")
      expect(text).toContain("主模型")
      expect(text).toContain("备用模型")
      expect(text).toContain("什么时候切备用")
      expect(text).toContain("高质量模式启用高质量优先")
      expect(text).toContain("密钥错、模型不存在不会悄悄切走")
    })
  })
})
