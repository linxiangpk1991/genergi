import { z } from "zod"

export const providerTypeSchema = z.enum([
  "anthropic-compatible",
  "openai-compatible",
  "edge-tts",
  "azure-tts",
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
  validatedAt: z.string().nullable(),
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
