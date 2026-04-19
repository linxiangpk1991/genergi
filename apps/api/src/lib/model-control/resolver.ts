import type {
  ModelDefaultsDocument,
  ModelRecord,
  ModelSlotType,
  ResolvedSlotSnapshot,
  TaskModelOverride,
} from "@genergi/shared"
import { getModelDefaultsDocument, listModelRecords, listProviderRecords } from "./registry-store.js"

const ALL_SLOTS: ModelSlotType[] = [
  "textModel",
  "imageDraftModel",
  "imageFinalModel",
  "videoDraftModel",
  "videoFinalModel",
  "ttsProvider",
]

function getModeDefault(defaults: ModelDefaultsDocument, modeId: NonNullable<ModelDefaultsDocument["modeDefaults"]>[number]["modeId"]) {
  return defaults.modeDefaults.find((item) => item.modeId === modeId)?.slots ?? {}
}

function getSelectableModel(models: ModelRecord[], modelId: string, slotType: ModelSlotType) {
  return models.find((model) => model.id === modelId && model.slotType === slotType && model.lifecycleStatus === "available") ?? null
}

function getAvailableProvider(providerId: string, providers: Awaited<ReturnType<typeof listProviderRecords>>) {
  return providers.find((item) => item.id === providerId && item.status === "available") ?? null
}

export async function resolveEffectiveSlots(input: {
  modeId: NonNullable<ModelDefaultsDocument["modeDefaults"]>[number]["modeId"]
  taskOverrides?: TaskModelOverride
}) {
  const [defaults, models, providers] = await Promise.all([
    getModelDefaultsDocument(),
    listModelRecords(),
    listProviderRecords(),
  ])

  const modeDefaults = getModeDefault(defaults, input.modeId)
  const resolved: ResolvedSlotSnapshot[] = []

  for (const slotType of ALL_SLOTS) {
    if (slotType === "ttsProvider") {
      const overrideSelectionId = input.taskOverrides?.[slotType]?.providerId ?? input.taskOverrides?.[slotType]?.modelId
      const selectedTtsId =
        overrideSelectionId ??
        modeDefaults[slotType]?.providerId ??
        modeDefaults[slotType]?.modelId ??
        defaults.globalDefaults[slotType]?.providerId ??
        defaults.globalDefaults[slotType]?.modelId
      if (!selectedTtsId) {
        throw new Error(`DEFAULT_NOT_CONFIGURED:${slotType}`)
      }

      const provider =
        getAvailableProvider(selectedTtsId, providers) ??
        (() => {
          const ttsModel = getSelectableModel(models, selectedTtsId, slotType)
          return ttsModel ? getAvailableProvider(ttsModel.providerId, providers) : null
        })()

      if (!provider) {
        const errorPrefix = overrideSelectionId ? "TASK_OVERRIDE_NOT_SELECTABLE" : "DEFAULT_TARGET_NOT_SELECTABLE"
        throw new Error(`${errorPrefix}:${slotType}`)
      }

      resolved.push({
        slotType,
        providerId: provider.id,
        providerKey: provider.providerKey,
        providerType: provider.providerType,
        modelId: provider.id,
        modelKey: provider.providerKey,
        providerModelId: provider.providerType,
        displayName: provider.displayName,
        capabilityJson: {},
        validatedAt: provider.lastValidatedAt,
      })
      continue
    }

    const overrideModelId = input.taskOverrides?.[slotType]?.modelId
    if (overrideModelId) {
      const overrideModel = getSelectableModel(models, overrideModelId, slotType)
      if (!overrideModel) {
        throw new Error(`TASK_OVERRIDE_NOT_SELECTABLE:${slotType}`)
      }

      const provider = getAvailableProvider(overrideModel.providerId, providers)
      if (!provider) {
        throw new Error(`PROVIDER_NOT_RESOLVED:${slotType}`)
      }

      resolved.push({
        slotType,
        providerId: provider.id,
        providerKey: provider.providerKey,
        providerType: provider.providerType,
        modelId: overrideModel.id,
        modelKey: overrideModel.modelKey,
        providerModelId: overrideModel.providerModelId,
        displayName: overrideModel.displayName,
        capabilityJson: overrideModel.capabilityJson ?? {},
        validatedAt: overrideModel.lastValidatedAt,
      })
      continue
    }

    const selectedModelId = modeDefaults[slotType]?.modelId ?? defaults.globalDefaults[slotType]?.modelId
    if (!selectedModelId) {
      throw new Error(`DEFAULT_NOT_CONFIGURED:${slotType}`)
    }

    const model = getSelectableModel(models, selectedModelId, slotType)
    if (!model) {
      throw new Error(`DEFAULT_TARGET_NOT_SELECTABLE:${slotType}`)
    }

    const provider = getAvailableProvider(model.providerId, providers)
    if (!provider) {
      throw new Error(`PROVIDER_NOT_RESOLVED:${slotType}`)
    }

    resolved.push({
      slotType,
      providerId: provider.id,
      providerKey: provider.providerKey,
      providerType: provider.providerType,
      modelId: model.id,
      modelKey: model.modelKey,
      providerModelId: model.providerModelId,
      displayName: model.displayName,
      capabilityJson: model.capabilityJson ?? {},
      validatedAt: model.lastValidatedAt,
    })
  }

  return resolved
}
