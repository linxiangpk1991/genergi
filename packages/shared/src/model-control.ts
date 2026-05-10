import { z } from "zod"
import { modelRoutingProfileSchema, normalizeRoutingCapability } from "./model-routing.js"

export const providerTypeSchema = z.enum([
  "direct-openai",
  "anthropic-compatible",
  "anthropic-native",
  "gemini-compatible",
  "openai-compatible",
  "edge-tts",
  "azure-tts",
  "litellm-proxy",
  "portkey-gateway",
  "helicone-gateway",
  "custom-http",
  "custom",
])
export type ProviderType = z.infer<typeof providerTypeSchema>

export const providerAuthTypeSchema = z.enum([
  "none",
  "bearer_token",
  "api_key_header",
  "x_api_key",
  "custom_header",
])
export type ProviderAuthType = z.infer<typeof providerAuthTypeSchema>

export const modelControlStatusSchema = z.enum([
  "draft",
  "validating",
  "available",
  "invalid",
  "disabled",
  "deprecated",
])
export type ModelControlStatus = z.infer<typeof modelControlStatusSchema>

export const modelSlotTypeSchema = z.enum([
  "textModel",
  "imageModel",
  "videoModel",
  "ttsProvider",
])
export type ModelSlotType = z.infer<typeof modelSlotTypeSchema>

export const modelCapabilitySchema = z.record(z.string(), z.unknown())
export type ModelCapability = z.infer<typeof modelCapabilitySchema>

export type TextWireApi = "responses" | "chat_completions" | "messages"

function normalizeCapabilityString(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : ""
}

export function normalizeTextWireApi(value: unknown, providerModelId = ""): TextWireApi | null {
  const normalized = normalizeCapabilityString(value)
  if (
    normalized === "responses" ||
    normalized === "response" ||
    normalized === "responses_compatible_openai_chat" ||
    normalized === "openai_responses"
  ) {
    return "responses"
  }
  if (
    normalized === "chat_completions" ||
    normalized === "chat_completion" ||
    normalized === "chat" ||
    normalized === "openai_chat_completions"
  ) {
    return "chat_completions"
  }
  if (normalized === "messages" || normalized === "anthropic_messages" || normalized === "anthropic") {
    return "messages"
  }

  return providerModelId.trim().toLowerCase().startsWith("gpt-5") ? "responses" : null
}

function endpointStyleForWireApi(wireApi: TextWireApi) {
  switch (wireApi) {
    case "responses":
      return "responses"
    case "messages":
      return "messages"
    case "chat_completions":
      return "chat-completions"
  }
}

export function normalizeModelCapability(
  slotType: ModelSlotType,
  providerModelId: string,
  capabilityJson: Record<string, unknown> = {},
  providerType?: string | null,
): Record<string, unknown> {
  const capability = { ...capabilityJson }

  if (slotType === "textModel") {
    const wireApi =
      normalizeTextWireApi(capability.wireApi, providerModelId) ??
      normalizeTextWireApi(capability.wire_api, providerModelId) ??
      normalizeTextWireApi(capability.textWireApi, providerModelId) ??
      normalizeTextWireApi(capability.text_wire_api, providerModelId) ??
      normalizeTextWireApi(capability.endpointStyle, providerModelId) ??
      normalizeTextWireApi(capability.endpoint_style, providerModelId)

    if (wireApi) {
      capability.wireApi = wireApi
      capability.endpointStyle = endpointStyleForWireApi(wireApi)
    }
  }

  if (slotType === "imageModel") {
    const transport = normalizeCapabilityString(capability.imageTransport)
    if (transport === "openai_images_generations") {
      capability.imageTransport = "openai-images-generations"
      capability.endpointStyle = "images-generations"
    } else if (transport === "gemini_generate_content") {
      capability.imageTransport = "gemini-generate-content"
      capability.endpointStyle = "gemini-generate-content"
    } else if (transport === "openai_chat_completions") {
      capability.imageTransport = "openai-chat-completions"
      capability.endpointStyle = "chat-completions"
    } else if (providerModelId.trim().toLowerCase().startsWith("gpt-image")) {
      capability.imageTransport = capability.imageTransport ?? "openai-images-generations"
      capability.endpointStyle = capability.endpointStyle ?? "images-generations"
    } else if (providerModelId.trim().toLowerCase().includes("gemini")) {
      capability.imageTransport = capability.imageTransport ?? "gemini-generate-content"
      capability.endpointStyle = capability.endpointStyle ?? "gemini-generate-content"
    }

    if (capability.imageTransport === "openai-images-generations") {
      capability.supportsBatchKeyframes = capability.supportsBatchKeyframes ?? true
      const maxBatchImages = Number(capability.maxBatchImages ?? capability.max_batch_images ?? 4)
      capability.maxBatchImages = Number.isFinite(maxBatchImages) && maxBatchImages > 0 ? Math.floor(maxBatchImages) : 4
      if (providerModelId.trim().toLowerCase() === "gpt-image-2") {
        capability.batchReturnMode = capability.batchReturnMode ?? "composite_grid"
        capability.supportsCompositeGrid = capability.supportsCompositeGrid ?? true
        capability.compositeGridMaxSize = capability.compositeGridMaxSize ?? "2048x3072"
      }
    } else {
      capability.supportsBatchKeyframes = capability.supportsBatchKeyframes ?? false
    }
  }

  return normalizeRoutingCapability({
    slotType,
    providerModelId,
    providerType,
    capabilityJson: capability,
  })
}

export const providerRecordSchema = z.object({
  id: z.string(),
  providerKey: z.string().min(1),
  providerType: providerTypeSchema,
  displayName: z.string().min(1),
  authType: providerAuthTypeSchema,
  endpointUrl: z.string().nullable().optional(),
  encryptedEndpoint: z.string().nullable(),
  encryptedSecret: z.string().nullable(),
  endpointHint: z.string().nullable(),
  secretHint: z.string().nullable(),
  status: modelControlStatusSchema,
  lastValidatedAt: z.string().nullable(),
  lastValidationError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ProviderRecord = z.infer<typeof providerRecordSchema>

export const providerRegistryRecordSchema = z.object({
  id: z.string(),
  providerKey: z.string().min(1),
  providerType: providerTypeSchema,
  displayName: z.string().min(1),
  endpointUrl: z.string().default(""),
  authType: providerAuthTypeSchema,
  authHeaderName: z.string().nullable().optional().default(null),
  encryptedSecret: z.string().nullable(),
  status: modelControlStatusSchema,
  lastValidatedAt: z.string().nullable(),
  lastValidationError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ProviderRegistryRecord = z.infer<typeof providerRegistryRecordSchema>

export const modelRecordSchema = z.object({
  id: z.string(),
  modelKey: z.string().min(1),
  providerId: z.string().min(1),
  slotType: modelSlotTypeSchema,
  providerModelId: z.string().min(1),
  displayName: z.string().min(1),
  capabilityJson: modelCapabilitySchema,
  routingProfile: modelRoutingProfileSchema.optional(),
  lifecycleStatus: modelControlStatusSchema,
  lastValidatedAt: z.string().nullable(),
  lastValidationError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ModelRecord = z.infer<typeof modelRecordSchema>

export const modelRegistryRecordSchema = modelRecordSchema
export type ModelRegistryRecord = z.infer<typeof modelRegistryRecordSchema>

export const slotSelectionSchema = z.object({
  slotType: modelSlotTypeSchema.optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
}).refine((value) => Boolean(value.modelId || value.providerId), {
  message: "slot selection must include modelId or providerId",
})
export type SlotSelection = z.infer<typeof slotSelectionSchema>

export const globalModelDefaultsSchema = z.object({
  textModel: slotSelectionSchema.optional(),
  imageModel: slotSelectionSchema.optional(),
  videoModel: slotSelectionSchema.optional(),
  ttsProvider: slotSelectionSchema.optional(),
})
export type GlobalModelDefaults = z.infer<typeof globalModelDefaultsSchema>

export const modelControlModeSchema = z.enum(["mass_production", "high_quality"])
export type ModelControlMode = z.infer<typeof modelControlModeSchema>

export const modeModelDefaultsSchema = z.object({
  modeId: modelControlModeSchema,
  slots: globalModelDefaultsSchema,
})
export type ModeModelDefaults = z.infer<typeof modeModelDefaultsSchema>

export const modelDefaultsDocumentSchema = z.object({
  globalDefaults: globalModelDefaultsSchema,
  modeDefaults: z.array(modeModelDefaultsSchema),
  updatedAt: z.string().nullable(),
})
export type ModelDefaultsDocument = z.infer<typeof modelDefaultsDocumentSchema>

export const modelControlDefaultsSchema = z.object({
  global: z.object({
    textModel: slotSelectionSchema.nullable().optional(),
    imageModel: slotSelectionSchema.nullable().optional(),
    videoModel: slotSelectionSchema.nullable().optional(),
    ttsProvider: slotSelectionSchema.nullable().optional(),
  }),
  modes: z.object({
    mass_production: z.object({
      textModel: slotSelectionSchema.nullable().optional(),
      imageModel: slotSelectionSchema.nullable().optional(),
      videoModel: slotSelectionSchema.nullable().optional(),
      ttsProvider: slotSelectionSchema.nullable().optional(),
    }).default({}),
    high_quality: z.object({
      textModel: slotSelectionSchema.nullable().optional(),
      imageModel: slotSelectionSchema.nullable().optional(),
      videoModel: slotSelectionSchema.nullable().optional(),
      ttsProvider: slotSelectionSchema.nullable().optional(),
    }).default({}),
  }),
  updatedAt: z.string().nullable().optional(),
})
export type ModelControlDefaults = z.infer<typeof modelControlDefaultsSchema>

export const taskModelOverrideSchema = globalModelDefaultsSchema
export type TaskModelOverride = z.infer<typeof taskModelOverrideSchema>

export const modelFallbackTriggerSchema = z.enum([
  "timeout",
  "rate_limit",
  "provider_error",
  "empty_result",
  "invalid_response",
])
export type ModelFallbackTrigger = z.infer<typeof modelFallbackTriggerSchema>

export const modelRoutingStrategySchema = z.enum([
  "balanced",
  "quality_first",
  "speed_first",
  "cost_first",
])
export type ModelRoutingStrategy = z.infer<typeof modelRoutingStrategySchema>

const defaultFallbackTriggers = ["timeout", "rate_limit", "provider_error"] satisfies ModelFallbackTrigger[]
const defaultSlotRoutingPolicy = {
  enabled: false,
  strategy: "balanced" as const,
  primary: null,
  fallbacks: [],
  fallbackTriggers: defaultFallbackTriggers,
  operatorNote: "",
}

export const slotRoutingPolicySchema = z.object({
  enabled: z.boolean().default(false),
  strategy: modelRoutingStrategySchema.default("balanced"),
  primary: slotSelectionSchema.nullable().optional().default(null),
  fallbacks: z.array(slotSelectionSchema).max(4).default([]),
  fallbackTriggers: z.array(modelFallbackTriggerSchema).default(defaultFallbackTriggers),
  operatorNote: z.string().trim().max(500).optional().default(""),
})
export type SlotRoutingPolicy = z.infer<typeof slotRoutingPolicySchema>

const defaultSlotRoutingPolicies = {
  textModel: defaultSlotRoutingPolicy,
  imageModel: defaultSlotRoutingPolicy,
  videoModel: defaultSlotRoutingPolicy,
  ttsProvider: defaultSlotRoutingPolicy,
}

export const slotRoutingPoliciesSchema = z.object({
  textModel: slotRoutingPolicySchema.default(defaultSlotRoutingPolicy),
  imageModel: slotRoutingPolicySchema.default(defaultSlotRoutingPolicy),
  videoModel: slotRoutingPolicySchema.default(defaultSlotRoutingPolicy),
  ttsProvider: slotRoutingPolicySchema.default(defaultSlotRoutingPolicy),
})
export type SlotRoutingPolicies = z.infer<typeof slotRoutingPoliciesSchema>

export const modelRoutingPoliciesDocumentSchema = z.object({
  global: slotRoutingPoliciesSchema.default(defaultSlotRoutingPolicies),
  modes: z.object({
    mass_production: slotRoutingPoliciesSchema.default(defaultSlotRoutingPolicies),
    high_quality: slotRoutingPoliciesSchema.default(defaultSlotRoutingPolicies),
  }).default({
    mass_production: defaultSlotRoutingPolicies,
    high_quality: defaultSlotRoutingPolicies,
  }),
  updatedAt: z.string().nullable().default(null),
})
export type ModelRoutingPoliciesDocument = z.infer<typeof modelRoutingPoliciesDocumentSchema>

export const resolvedFallbackCandidateSchema = z.object({
  slotType: modelSlotTypeSchema,
  providerId: z.string().min(1),
  providerKey: z.string().min(1),
  providerType: providerTypeSchema,
  modelId: z.string().min(1),
  modelKey: z.string().min(1),
  providerModelId: z.string().min(1),
  displayName: z.string().min(1),
  capabilityJson: modelCapabilitySchema,
  routingProfile: modelRoutingProfileSchema.optional(),
  fallbackTriggers: z.array(modelFallbackTriggerSchema).default([]),
  validatedAt: z.string().nullable(),
})
export type ResolvedFallbackCandidate = z.infer<typeof resolvedFallbackCandidateSchema>

export const resolvedSlotSnapshotSchema = z.object({
  slotType: modelSlotTypeSchema,
  providerId: z.string().min(1),
  providerKey: z.string().min(1),
  providerType: providerTypeSchema,
  modelId: z.string().min(1),
  modelKey: z.string().min(1),
  providerModelId: z.string().min(1),
  displayName: z.string().min(1),
  capabilityJson: modelCapabilitySchema,
  routingProfile: modelRoutingProfileSchema.optional(),
  validatedAt: z.string().nullable(),
  selectionSource: z.enum([
    "task_override",
    "mode_policy",
    "global_policy",
    "mode_default",
    "global_default",
  ]).optional(),
  selectionReason: z.string().optional(),
  routingStrategy: modelRoutingStrategySchema.optional(),
  routingPolicyNote: z.string().optional(),
  fallbackCandidates: z.array(resolvedFallbackCandidateSchema).default([]).optional(),
})
export type ResolvedSlotSnapshot = z.infer<typeof resolvedSlotSnapshotSchema>

export const selectableSlotOptionSchema = z.object({
  modelId: z.string().min(1),
  modelKey: z.string().min(1),
  providerId: z.string().min(1),
  providerKey: z.string().min(1),
  providerType: providerTypeSchema,
  providerModelId: z.string().min(1),
  displayName: z.string().min(1),
  slotType: modelSlotTypeSchema,
  capabilityJson: modelCapabilitySchema,
})
export type SelectableSlotOption = z.infer<typeof selectableSlotOptionSchema>
