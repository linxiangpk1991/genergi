import type { ModelControlSlotType, ModelRegistryRecord, ProviderRegistryRecord } from "../api"

export const PROVIDER_TYPE_OPTIONS = [
  {
    value: "direct-openai",
    label: "OpenAI 官方",
    description: "直接连接 OpenAI 官方接口，GPT-5/GPT-5.5 文案规划会走 Responses API。",
  },
  {
    value: "openai-compatible",
    label: "OpenAI 兼容代理",
    description: "适合自建网关、LiteLLM、聚合代理等兼容 OpenAI 路径的服务。",
  },
  {
    value: "litellm-proxy",
    label: "LiteLLM 网关",
    description: "适合统一接入多家模型、后续做 fallback、预算和路由策略。",
  },
  {
    value: "portkey-gateway",
    label: "Portkey 网关",
    description: "适合外部网关治理、策略路由和审计场景。",
  },
  {
    value: "helicone-gateway",
    label: "Helicone 网关",
    description: "适合加强调用观测、成本追踪和请求日志。",
  },
  {
    value: "anthropic-compatible",
    label: "Anthropic / Claude 兼容",
    description: "适合 Claude Messages API 或兼容代理。",
  },
  {
    value: "anthropic-native",
    label: "Anthropic 官方",
    description: "直接连接 Claude Messages API。",
  },
  {
    value: "gemini-compatible",
    label: "Gemini / Google 兼容",
    description: "适合 Gemini Generate Content 或兼容服务。",
  },
  { value: "edge-tts", label: "Edge TTS", description: "本地/免费配音兜底，不需要接口地址和密钥。" },
  { value: "azure-tts", label: "Azure TTS", description: "Azure 语音服务接入。" },
  { value: "custom-http", label: "自定义 HTTP", description: "有固定 HTTP 接口但不完全兼容现有协议，需要工程确认。" },
  { value: "custom", label: "自定义接入", description: "特殊服务或临时代理，需工程确认调用方式。" },
]

export const AUTH_TYPE_OPTIONS = [
  { value: "bearer_token", label: "Bearer Token", description: "请求头 Authorization: Bearer <token>。" },
  { value: "api_key_header", label: "API Key Header", description: "使用服务指定的 API Key 请求头。" },
  { value: "x_api_key", label: "x-api-key", description: "常见于部分兼容服务。" },
  { value: "custom_header", label: "自定义请求头", description: "需要工程侧确认 header 名称。" },
  { value: "none", label: "无需密钥", description: "只适合本地服务或无需鉴权的服务。" },
]

export const TEXT_WIRE_API_OPTIONS = [
  {
    value: "responses",
    label: "Responses API",
    endpoint: "/v1/responses",
    description: "OpenAI GPT-5/GPT-5.5 文案规划推荐方式，支持结构化、多模态和工具化响应。",
  },
  {
    value: "chat_completions",
    label: "Chat Completions",
    endpoint: "/v1/chat/completions",
    description: "旧式 OpenAI 兼容聊天接口，适合仍只支持 chat 的代理。",
  },
  {
    value: "messages",
    label: "Messages API",
    endpoint: "/v1/messages",
    description: "Claude / Anthropic 兼容文本接口。",
  },
]

export const IMAGE_TRANSPORT_OPTIONS = [
  {
    value: "openai-images-generations",
    label: "OpenAI Images",
    endpoint: "/v1/images/generations",
    description: "适合 gpt-image 系列生图模型。",
  },
  {
    value: "gemini-generate-content",
    label: "Gemini Generate Content",
    endpoint: ":generateContent",
    description: "适合 Gemini 原生图片生成接口。",
  },
  {
    value: "openai-chat-completions",
    label: "Chat 图片兼容",
    endpoint: "/v1/chat/completions",
    description: "少数私有图片代理通过 chat 接口返回图片。",
  },
]

function normalizeCapabilityValue(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : ""
}

export function normalizeTextWireApiForUi(value: unknown, providerModelId = "") {
  const normalized = normalizeCapabilityValue(value)
  if (
    normalized === "responses" ||
    normalized === "response" ||
    normalized === "responses_compatible_openai_chat" ||
    normalized === "openai_responses"
  ) {
    return "responses"
  }
  if (normalized === "chat_completions" || normalized === "chat_completion" || normalized === "chat") {
    return "chat_completions"
  }
  if (normalized === "messages" || normalized === "anthropic_messages" || normalized === "anthropic") {
    return "messages"
  }
  return providerModelId.trim().toLowerCase().startsWith("gpt-5") ? "responses" : "chat_completions"
}

export function getModelCallProfile(model: Pick<ModelRegistryRecord, "slotType" | "providerModelId" | "capabilityJson">) {
  const routingProfile =
    typeof model.capabilityJson.routingProfile === "object" &&
    model.capabilityJson.routingProfile &&
    !Array.isArray(model.capabilityJson.routingProfile)
      ? (model.capabilityJson.routingProfile as Record<string, unknown>)
      : null

  if (model.slotType === "textModel") {
    const gpt5Family = model.providerModelId.trim().toLowerCase().startsWith("gpt-5")
    const wireApi = normalizeTextWireApiForUi(
      routingProfile?.wireApi ??
        model.capabilityJson.wireApi ??
        model.capabilityJson.wire_api ??
        model.capabilityJson.textWireApi ??
        (gpt5Family ? "responses" : model.capabilityJson.endpointStyle),
      model.providerModelId,
    )
    return TEXT_WIRE_API_OPTIONS.find((option) => option.value === wireApi) ?? TEXT_WIRE_API_OPTIONS[1]
  }

  if (model.slotType === "imageModel") {
    const transport = normalizeCapabilityValue(model.capabilityJson.imageTransport)
    const wireApi = normalizeCapabilityValue(routingProfile?.wireApi)
    if (wireApi === "gemini_generate_content") {
      return IMAGE_TRANSPORT_OPTIONS[1]
    }
    if (wireApi === "images_generations") {
      return IMAGE_TRANSPORT_OPTIONS[0]
    }
    if (transport === "gemini_generate_content" || model.providerModelId.toLowerCase().includes("gemini")) {
      return IMAGE_TRANSPORT_OPTIONS[1]
    }
    if (transport === "openai_chat_completions") {
      return IMAGE_TRANSPORT_OPTIONS[2]
    }
    if (transport === "openai_images_generations" || model.providerModelId.toLowerCase().startsWith("gpt-image")) {
      return IMAGE_TRANSPORT_OPTIONS[0]
    }
    return { label: "图片调用方式未标注", endpoint: "待补充", description: "建议在能力说明里选择图片生成方式。" }
  }

  if (model.slotType === "videoModel") {
    return {
      label: "视频生成接口",
      endpoint: String(model.capabilityJson.endpointStyle ?? model.capabilityJson.videoEndpoint ?? "按 worker 适配"),
      description: "视频模型主要看最大单段时长、清晰度和成本档位。",
    }
  }

  return {
    label: "配音接入",
    endpoint: "provider",
    description: "配音槽位默认绑定接入方本身。",
  }
}

export function buildCapabilityPreset(slotType: ModelControlSlotType, providerModelId: string) {
  const modelId = providerModelId.trim().toLowerCase()

  if (slotType === "textModel") {
    const wireApi = modelId.startsWith("gpt-5") ? "responses" : "chat_completions"
    return {
      family: modelId.startsWith("gpt") ? "gpt" : "text",
      usage: "text-planning",
      wireApi,
      endpointStyle: wireApi === "responses" ? "responses" : "chat-completions",
    }
  }

  if (slotType === "imageModel") {
    if (modelId.startsWith("gpt-image")) {
      return {
        family: "gpt-image",
        usage: "image-generation",
        imageTransport: "openai-images-generations",
        endpointStyle: "images-generations",
        quality: "high",
      }
    }
    if (modelId.includes("gemini")) {
      return {
        family: "gemini-image",
        usage: "image-generation",
        imageTransport: "gemini-generate-content",
        endpointStyle: "gemini-generate-content",
      }
    }
  }

  if (slotType === "videoModel") {
    return {
      family: "video",
      usage: "video-generation",
      maxSingleShotSec: modelId.includes("fast") ? 8 : 8,
      qualityTier: modelId.includes("fast") ? "fast" : "high",
    }
  }

  return {}
}

export function formatProviderType(providerType: string) {
  return PROVIDER_TYPE_OPTIONS.find((option) => option.value === providerType)?.label ?? providerType
}

export function formatAuthType(authType: string) {
  return AUTH_TYPE_OPTIONS.find((option) => option.value === authType)?.label ?? authType
}

export function findProviderDisplayName(providerId: string, providers: ProviderRegistryRecord[]) {
  return providers.find((provider) => provider.id === providerId)?.displayName ?? providerId
}
