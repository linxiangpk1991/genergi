import { randomUUID } from "node:crypto"
import {
  MODE_MODELS,
  resolveVideoModelCapability,
} from "@genergi/config"
import {
  type ModelControlDefaults,
  type GlobalModelDefaults,
  type ModelDefaultsDocument,
  type ModelRecord,
  type ProviderRegistryRecord,
  type ProductionModeId,
  type ModelSlotType,
  type ModelControlStatus,
  type ProviderRecord,
  readModelDefaults,
  readModelRecords,
  readProviderRecords,
  replaceModelDefaults,
  replaceModelRecords,
  replaceProviderRecords,
} from "@genergi/shared"
import { decryptControlPlaneSecret, encryptControlPlaneSecret, maskSecret } from "./crypto.js"

function now() {
  return new Date().toISOString()
}

type SeedState = {
  seeded: boolean
  seeding: Promise<void> | null
}

const seedState: SeedState = {
  seeded: false,
  seeding: null,
}

function createSeedProvider(providerType: ProviderRecord["providerType"]) {
  const timestamp = now()
  return {
    id: `provider_${providerType}`,
    providerKey: providerType,
    providerType,
    displayName: providerType,
    authType: providerType === "edge-tts" ? "none" : "bearer_token",
    encryptedEndpoint: null,
    encryptedSecret: null,
    endpointHint: null,
    secretHint: null,
    status: "available",
    lastValidatedAt: timestamp,
    lastValidationError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies ProviderRecord
}

function getSlotValueForMode(mode: (typeof MODE_MODELS)[keyof typeof MODE_MODELS], slotType: ModelSlotType) {
  switch (slotType) {
    case "textModel":
      return mode.textModel
    case "imageModel":
      return mode.imageModel
    case "videoModel":
      return mode.videoModel
    case "ttsProvider":
      return {
        id: mode.ttsProvider,
        label: mode.ttsProvider,
        provider: mode.ttsProvider,
      }
  }
}

function createSeedModelRecord(slotType: ModelSlotType, slotValue: { id: string; label: string; provider: string }): ModelRecord {
  const timestamp = now()
  const capabilityJson = slotType === "videoModel"
    ? resolveVideoModelCapability(slotValue.id)
    : {}
  return {
    id: `model_${slotType}_${slotValue.id}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
    modelKey: slotValue.id,
    providerId: `provider_${slotValue.provider}`,
    slotType,
    providerModelId: slotValue.id,
    displayName: slotValue.label,
    capabilityJson,
    lifecycleStatus: "available",
    lastValidatedAt: timestamp,
    lastValidationError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function createSeedDefaults(models: ModelRecord[]): ModelDefaultsDocument {
  const slotLookup = new Map(
    models.map((model) => [`${model.slotType}:${model.providerModelId}`, model.id]),
  )
  const modeDefaults = Object.entries(MODE_MODELS).map(([modeId, mode]) => ({
    modeId: modeId as ProductionModeId,
    slots: {
      textModel: { modelId: slotLookup.get(`textModel:${mode.textModel.id}`) ?? "" },
      imageModel: { modelId: slotLookup.get(`imageModel:${mode.imageModel.id}`) ?? "" },
      videoModel: { modelId: slotLookup.get(`videoModel:${mode.videoModel.id}`) ?? "" },
      ttsProvider: { providerId: `provider_${mode.ttsProvider}`, modelId: `provider_${mode.ttsProvider}` },
    } satisfies GlobalModelDefaults,
  }))

  return {
    globalDefaults: modeDefaults.find((item) => item.modeId === "mass_production")?.slots ?? {},
    modeDefaults,
    updatedAt: now(),
  }
}

export async function ensureModelControlSeeded() {
  if (seedState.seeded) {
    return
  }

  if (seedState.seeding) {
    await seedState.seeding
    return
  }

  seedState.seeding = (async () => {
    const [providers, models, defaults] = await Promise.all([
      readProviderRecords(),
      readModelRecords(),
      readModelDefaults(),
    ])

    if (providers.length === 0 && models.length === 0) {
      const providerTypes = new Set<string>()
      const seedModels: ModelRecord[] = []

      for (const mode of Object.values(MODE_MODELS)) {
        ;(["textModel", "imageModel", "videoModel", "ttsProvider"] as const).forEach((slotType) => {
          const slotValue = getSlotValueForMode(mode, slotType)
          providerTypes.add(slotValue.provider)
          const existing = seedModels.find((model) => model.slotType === slotType && model.providerModelId === slotValue.id)
          if (!existing) {
            seedModels.push(createSeedModelRecord(slotType, slotValue))
          }
        })
      }

      const seedProviders = [...providerTypes].map((providerType) => createSeedProvider(providerType as ProviderRecord["providerType"]))
      await replaceProviderRecords(seedProviders)
      await replaceModelRecords(seedModels)
      await replaceModelDefaults(createSeedDefaults(seedModels))
    } else if (!defaults.modeDefaults.length && models.length > 0) {
      await replaceModelDefaults(createSeedDefaults(models))
    }

    seedState.seeded = true
  })()

  try {
    await seedState.seeding
  } finally {
    seedState.seeding = null
  }
}

export async function listProviderRecords() {
  await ensureModelControlSeeded()
  return readProviderRecords()
}

export async function listModelRecords() {
  await ensureModelControlSeeded()
  return readModelRecords()
}

export async function getModelDefaultsDocument() {
  await ensureModelControlSeeded()
  return readModelDefaults()
}

export async function createProviderRecord(input: {
  providerKey: string
  providerType: ProviderRecord["providerType"]
  displayName: string
  authType: ProviderRecord["authType"]
  endpointUrl?: string
  secret?: string
  status?: ProviderRecord["status"]
}) {
  const providers = await listProviderRecords()
  const timestamp = now()
  const record: ProviderRecord = {
    id: `provider_${randomUUID()}`,
    providerKey: input.providerKey.trim(),
    providerType: input.providerType,
    displayName: input.displayName.trim(),
    authType: input.authType,
    encryptedEndpoint: input.endpointUrl?.trim() ? encryptControlPlaneSecret(input.endpointUrl.trim()) : null,
    encryptedSecret: input.secret?.trim() ? encryptControlPlaneSecret(input.secret.trim()) : null,
    endpointHint: input.endpointUrl?.trim() ? maskSecret(input.endpointUrl.trim()) : null,
    secretHint: input.secret?.trim() ? maskSecret(input.secret.trim()) : null,
    status: input.status ?? "draft",
    lastValidatedAt: null,
    lastValidationError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  providers.unshift(record)
  await replaceProviderRecords(providers)
  return record
}

export async function upsertProviderRecord(input: {
  id?: string
  providerKey: string
  providerType: ProviderRecord["providerType"]
  displayName: string
  endpointUrl?: string
  authType: ProviderRecord["authType"]
  secret?: string
  status?: ModelControlStatus
}) {
  const existing = (await listProviderRecords()).find((provider) => provider.providerKey === input.providerKey || (input.id && provider.id === input.id))
  if (!existing) {
    const created = await createProviderRecord(input)
    return toCompatibilityProviderRecord(created)
  }

  const updated = await updateProviderRecord(existing.id, {
    providerKey: input.providerKey,
    providerType: input.providerType,
    displayName: input.displayName,
    endpointUrl: input.endpointUrl,
    authType: input.authType,
    secret: input.secret,
    status: input.status,
  })
  return updated ? toCompatibilityProviderRecord(updated) : null
}

export async function updateProviderRecord(
  providerId: string,
  patch: Partial<{
    providerKey: string
    providerType: ProviderRecord["providerType"]
    displayName: string
    authType: ProviderRecord["authType"]
    endpointUrl: string | null
    secret: string | null
    status: ModelControlStatus
    lastValidatedAt: string | null
    lastValidationError: string | null
  }>,
) {
  const providers = await listProviderRecords()
  const index = providers.findIndex((provider) => provider.id === providerId)
  if (index < 0) {
    return null
  }

  const current = providers[index]
  providers[index] = {
    ...current,
    providerKey: patch.providerKey?.trim() ?? current.providerKey,
    providerType: patch.providerType ?? current.providerType,
    displayName: patch.displayName?.trim() ?? current.displayName,
    authType: patch.authType ?? current.authType,
    encryptedEndpoint:
      patch.endpointUrl === undefined
        ? current.encryptedEndpoint
        : patch.endpointUrl
          ? encryptControlPlaneSecret(patch.endpointUrl.trim())
          : null,
    encryptedSecret:
      patch.secret === undefined
        ? current.encryptedSecret
        : patch.secret
          ? encryptControlPlaneSecret(patch.secret.trim())
          : null,
    endpointHint:
      patch.endpointUrl === undefined
        ? current.endpointHint
        : patch.endpointUrl
          ? maskSecret(patch.endpointUrl.trim())
          : null,
    secretHint:
      patch.secret === undefined
        ? current.secretHint
        : patch.secret
          ? maskSecret(patch.secret.trim())
          : null,
    status: patch.status ?? current.status,
    lastValidatedAt: patch.lastValidatedAt === undefined ? current.lastValidatedAt : patch.lastValidatedAt,
    lastValidationError: patch.lastValidationError === undefined ? current.lastValidationError : patch.lastValidationError,
    updatedAt: now(),
  }

  await replaceProviderRecords(providers)
  return providers[index]
}

export async function createModelRecord(input: {
  modelKey: string
  providerId: string
  slotType: ModelRecord["slotType"]
  providerModelId: string
  displayName: string
  capabilityJson?: Record<string, unknown>
  lifecycleStatus?: ModelRecord["lifecycleStatus"]
}) {
  const models = await listModelRecords()
  const timestamp = now()
  const record: ModelRecord = {
    id: `model_${randomUUID()}`,
    modelKey: input.modelKey.trim(),
    providerId: input.providerId,
    slotType: input.slotType,
    providerModelId: input.providerModelId.trim(),
    displayName: input.displayName.trim(),
    capabilityJson: input.capabilityJson ?? {},
    lifecycleStatus: input.lifecycleStatus ?? "draft",
    lastValidatedAt: null,
    lastValidationError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  models.unshift(record)
  await replaceModelRecords(models)
  return record
}

export async function upsertModelRecord(input: {
  id?: string
  modelKey: string
  providerId: string
  slotType: ModelRecord["slotType"]
  providerModelId: string
  displayName: string
  capabilityJson?: Record<string, unknown>
  lifecycleStatus?: ModelRecord["lifecycleStatus"]
}) {
  const existing = (await listModelRecords()).find((model) => model.modelKey === input.modelKey || (input.id && model.id === input.id))
  if (!existing) {
    const created = await createModelRecord({
      modelKey: input.modelKey,
      providerId: input.providerId,
      slotType: input.slotType,
      providerModelId: input.providerModelId,
      displayName: input.displayName,
      capabilityJson: input.capabilityJson,
      lifecycleStatus: input.lifecycleStatus,
    })
    return created
  }

  return updateModelRecord(existing.id, {
    modelKey: input.modelKey,
    providerId: input.providerId,
    slotType: input.slotType,
    providerModelId: input.providerModelId,
    displayName: input.displayName,
    capabilityJson: input.capabilityJson,
    lifecycleStatus: input.lifecycleStatus,
  })
}

export async function updateModelRecord(
  modelId: string,
  patch: Partial<{
    modelKey: string
    providerId: string
    slotType: ModelRecord["slotType"]
    providerModelId: string
    displayName: string
    capabilityJson: Record<string, unknown>
    lifecycleStatus: ModelRecord["lifecycleStatus"]
    lastValidatedAt: string | null
    lastValidationError: string | null
  }>,
) {
  const models = await listModelRecords()
  const index = models.findIndex((model) => model.id === modelId)
  if (index < 0) {
    return null
  }

  const current = models[index]
  models[index] = {
    ...current,
    modelKey: patch.modelKey?.trim() ?? current.modelKey,
    providerId: patch.providerId ?? current.providerId,
    slotType: patch.slotType ?? current.slotType,
    providerModelId: patch.providerModelId?.trim() ?? current.providerModelId,
    displayName: patch.displayName?.trim() ?? current.displayName,
    capabilityJson: patch.capabilityJson ?? current.capabilityJson,
    lifecycleStatus: patch.lifecycleStatus ?? current.lifecycleStatus,
    lastValidatedAt: patch.lastValidatedAt === undefined ? current.lastValidatedAt : patch.lastValidatedAt,
    lastValidationError: patch.lastValidationError === undefined ? current.lastValidationError : patch.lastValidationError,
    updatedAt: now(),
  }

  await replaceModelRecords(models)
  return models[index]
}

export async function updateModelDefaultsDocument(document: ModelDefaultsDocument) {
  await replaceModelDefaults({
    ...document,
    updatedAt: now(),
  })
  return readModelDefaults()
}

export async function replaceModelControlDefaults(document: ModelControlDefaults) {
  const { replaceModelControlDefaults: replaceSharedDefaults } = await import("@genergi/shared")
  await replaceSharedDefaults(document)
  return readModelDefaults()
}

export async function getDecryptedProviderConnection(providerId: string) {
  const providers = await listProviderRecords()
  const provider = providers.find((item) => item.id === providerId) ?? null
  if (!provider) {
    return null
  }

  return {
    ...provider,
    endpointUrl: provider.encryptedEndpoint ? decryptControlPlaneSecret(provider.encryptedEndpoint) : null,
    secret: provider.encryptedSecret ? decryptControlPlaneSecret(provider.encryptedSecret) : null,
  }
}

export function toSafeProviderRecord(provider: ProviderRecord) {
  return {
    ...provider,
    encryptedEndpoint: null,
    encryptedSecret: null,
  }
}

export function toCompatibilityProviderRecord(provider: ProviderRecord): ProviderRegistryRecord {
  return {
    id: provider.id,
    providerKey: provider.providerKey,
    providerType: provider.providerType,
    displayName: provider.displayName,
    endpointUrl: provider.endpointHint ?? "",
    authType: provider.authType,
    authHeaderName: null,
    encryptedSecret: provider.encryptedSecret,
    status: provider.status,
    lastValidatedAt: provider.lastValidatedAt,
    lastValidationError: provider.lastValidationError,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  }
}

export async function listCompatibilityProviders() {
  return (await listProviderRecords()).map((provider) => toCompatibilityProviderRecord(provider))
}

export async function readModelControlDefaults() {
  const { readModelControlDefaults: readSharedDefaults } = await import("@genergi/shared")
  return readSharedDefaults()
}

export function toSelectableModelOption(model: ModelRecord, provider: ProviderRecord) {
  return {
    modelId: model.id,
    modelKey: model.modelKey,
    providerId: provider.id,
    providerKey: provider.providerKey,
    providerType: provider.providerType,
    providerModelId: model.providerModelId,
    displayName: model.displayName,
    slotType: model.slotType,
    capabilityJson: model.capabilityJson,
  }
}
