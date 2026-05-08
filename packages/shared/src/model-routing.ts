import { z } from "zod"
import type { ModelControlStatus, ModelSlotType } from "./model-control.js"

export const providerTransportSchema = z.enum([
  "direct-openai",
  "openai-compatible",
  "anthropic-compatible",
  "anthropic-native",
  "gemini-compatible",
  "edge-tts",
  "azure-tts",
  "litellm-proxy",
  "portkey-gateway",
  "helicone-gateway",
  "custom-http",
  "custom",
])
export type ProviderTransport = z.infer<typeof providerTransportSchema>

export const modelWireApiSchema = z.enum([
  "responses",
  "chat_completions",
  "messages",
  "images_generations",
  "gemini_generate_content",
  "video_generation",
  "tts",
  "custom_http",
])
export type ModelWireApi = z.infer<typeof modelWireApiSchema>

export const modelRoutingProfileSchema = z.object({
  transport: providerTransportSchema,
  wireApi: modelWireApiSchema,
  endpointPath: z.string(),
  timeoutMs: z.number().int().positive(),
  retryCount: z.number().int().nonnegative(),
  smokeProbe: z.enum(["config", "connectivity", "minimal_generation"]).default("config"),
})
export type ModelRoutingProfile = z.infer<typeof modelRoutingProfileSchema>

export const modelFallbackTargetSchema = z.object({
  providerId: z.string().min(1),
  providerModelId: z.string().min(1),
  wireApi: modelWireApiSchema,
  fallbackOn: z.array(z.enum(["rate_limit", "timeout", "provider_error", "invalid_response"])).default([
    "rate_limit",
    "timeout",
    "provider_error",
  ]),
})
export type ModelFallbackTarget = z.infer<typeof modelFallbackTargetSchema>

function normalizeKey(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : ""
}

export function normalizeProviderTransport(value: unknown): ProviderTransport {
  const normalized = normalizeKey(value)
  if (normalized === "direct_openai" || normalized === "openai") {
    return "direct-openai"
  }
  if (normalized === "openai_compatible" || normalized === "openai_proxy") {
    return "openai-compatible"
  }
  if (normalized === "anthropic_compatible") {
    return "anthropic-compatible"
  }
  if (normalized === "anthropic_native") {
    return "anthropic-native"
  }
  if (normalized === "gemini_compatible" || normalized === "google_gemini") {
    return "gemini-compatible"
  }
  if (normalized === "edge_tts") {
    return "edge-tts"
  }
  if (normalized === "azure_tts") {
    return "azure-tts"
  }
  if (normalized === "litellm" || normalized === "litellm_proxy") {
    return "litellm-proxy"
  }
  if (normalized === "portkey" || normalized === "portkey_gateway") {
    return "portkey-gateway"
  }
  if (normalized === "helicone" || normalized === "helicone_gateway") {
    return "helicone-gateway"
  }
  if (normalized === "custom_http") {
    return "custom-http"
  }
  return "custom"
}

export function getEndpointPathForWireApi(wireApi: ModelWireApi) {
  switch (wireApi) {
    case "responses":
      return "/v1/responses"
    case "chat_completions":
      return "/v1/chat/completions"
    case "messages":
      return "/v1/messages"
    case "images_generations":
      return "/v1/images/generations"
    case "gemini_generate_content":
      return ":generateContent"
    case "video_generation":
      return "按视频适配器"
    case "tts":
      return "provider"
    case "custom_http":
      return "自定义接口"
  }
}

export function inferWireApi(input: {
  slotType: ModelSlotType
  providerModelId: string
  providerType?: string | null
  capabilityJson?: Record<string, unknown> | null
}): ModelWireApi {
  const capability = input.capabilityJson ?? {}
  const normalizedWire =
    normalizeKey(capability.wireApi) ||
    normalizeKey(capability.wire_api) ||
    normalizeKey(capability.textWireApi) ||
    normalizeKey(capability.endpointStyle) ||
    normalizeKey(capability.imageTransport)
  const modelId = input.providerModelId.trim().toLowerCase()
  const providerType = normalizeKey(input.providerType)

  if (input.slotType === "ttsProvider") {
    return "tts"
  }
  if (input.slotType === "videoModel") {
    return "video_generation"
  }

  if (input.slotType === "textModel") {
    if (normalizedWire === "responses" || normalizedWire === "response" || normalizedWire === "openai_responses") {
      return "responses"
    }
    if (normalizedWire === "messages" || normalizedWire === "anthropic" || normalizedWire === "anthropic_messages") {
      return "messages"
    }
    if (modelId.startsWith("gpt-5")) {
      return "responses"
    }
    if (providerType.startsWith("anthropic")) {
      return "messages"
    }
    return "chat_completions"
  }

  if (input.slotType === "imageModel") {
    if (normalizedWire === "gemini_generate_content" || modelId.includes("gemini")) {
      return "gemini_generate_content"
    }
    if (
      normalizedWire === "openai_images_generations" ||
      normalizedWire === "images_generations" ||
      modelId.startsWith("gpt-image")
    ) {
      return "images_generations"
    }
    return "chat_completions"
  }

  return "custom_http"
}

export function buildModelRoutingProfile(input: {
  slotType: ModelSlotType
  providerModelId: string
  providerType?: string | null
  capabilityJson?: Record<string, unknown> | null
}): ModelRoutingProfile {
  const transport = normalizeProviderTransport(input.providerType)
  const wireApi = inferWireApi(input)
  const timeoutMs =
    wireApi === "video_generation"
      ? 600_000
      : wireApi === "images_generations" || wireApi === "gemini_generate_content"
        ? 180_000
        : 90_000
  const retryCount = wireApi === "video_generation" ? 0 : 1
  const smokeProbe = wireApi === "responses" || wireApi === "chat_completions" || wireApi === "messages"
    ? "connectivity"
    : "config"

  return {
    transport,
    wireApi,
    endpointPath: getEndpointPathForWireApi(wireApi),
    timeoutMs,
    retryCount,
    smokeProbe,
  }
}

export function normalizeRoutingCapability(input: {
  slotType: ModelSlotType
  providerModelId: string
  providerType?: string | null
  capabilityJson?: Record<string, unknown> | null
}) {
  const capability = { ...(input.capabilityJson ?? {}) }
  const routingProfile = buildModelRoutingProfile(input)

  capability.routingProfile = {
    ...(typeof capability.routingProfile === "object" && capability.routingProfile && !Array.isArray(capability.routingProfile)
      ? capability.routingProfile as Record<string, unknown>
      : {}),
    ...routingProfile,
  }
  capability.wireApi = routingProfile.wireApi
  capability.endpointPath = routingProfile.endpointPath

  if (routingProfile.wireApi === "responses") {
    capability.endpointStyle = "responses"
  } else if (routingProfile.wireApi === "chat_completions") {
    capability.endpointStyle = "chat-completions"
  } else if (routingProfile.wireApi === "messages") {
    capability.endpointStyle = "messages"
  } else if (routingProfile.wireApi === "images_generations") {
    capability.imageTransport = "openai-images-generations"
    capability.endpointStyle = "images-generations"
  } else if (routingProfile.wireApi === "gemini_generate_content") {
    capability.imageTransport = "gemini-generate-content"
    capability.endpointStyle = "gemini-generate-content"
  }

  return capability
}

export function getModelSelectableReason(input: {
  modelStatus: ModelControlStatus
  providerStatus?: ModelControlStatus | null
}) {
  if (input.providerStatus !== "available") {
    return {
      selectable: false,
      label: "接入方不可用",
      detail: "先让绑定接入方通过检查，再把模型加入默认模型池。",
    }
  }
  switch (input.modelStatus) {
    case "available":
      return {
        selectable: true,
        label: "可用于新任务",
        detail: "已通过配置检查，可以被默认模型和任务覆盖选择。",
      }
    case "draft":
      return {
        selectable: false,
        label: "未检查",
        detail: "保存后需要检查配置，检查通过后才会进入默认模型池。",
      }
    case "validating":
      return {
        selectable: false,
        label: "检查中",
        detail: "系统正在检查配置，完成前不会进入默认模型池。",
      }
    case "invalid":
      return {
        selectable: false,
        label: "检查未通过",
        detail: "根据错误信息修正接入方、上游模型 ID 或调用方式后重新检查。",
      }
    case "disabled":
      return {
        selectable: false,
        label: "已停用",
        detail: "该模型不会进入新任务默认模型池。",
      }
    case "deprecated":
      return {
        selectable: false,
        label: "已弃用",
        detail: "保留历史记录，但不建议继续用于新任务。",
      }
  }
}

export function canPatchModelLifecycle(status: ModelControlStatus) {
  return status === "draft" || status === "disabled" || status === "deprecated"
}

export function shouldResetModelValidation(changedKeys: string[]) {
  return changedKeys.some((key) =>
    ["providerId", "slotType", "providerModelId", "capabilityJson"].includes(key),
  )
}
