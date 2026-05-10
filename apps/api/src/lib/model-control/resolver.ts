import type {
  ModelDefaultsDocument,
  ModelRecord,
  ModelSlotType,
  SlotRoutingPolicy,
  ResolvedSlotSnapshot,
  TaskModelOverride,
} from "@genergi/shared"
import { buildModelRoutingProfile } from "@genergi/shared"
import { getModelDefaultsDocument, getModelRoutingPoliciesDocument, listModelRecords, listProviderRecords } from "./registry-store.js"

const ALL_SLOTS: ModelSlotType[] = [
  "textModel",
  "imageModel",
  "videoModel",
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

function getStrategyLabel(strategy: NonNullable<ResolvedSlotSnapshot["routingStrategy"]>) {
  switch (strategy) {
    case "quality_first":
      return "高质量优先"
    case "speed_first":
      return "速度优先"
    case "cost_first":
      return "成本优先"
    case "balanced":
      return "均衡"
  }
}

function getSlotLabel(slotType: ModelSlotType) {
  switch (slotType) {
    case "textModel":
      return "文案规划"
    case "imageModel":
      return "图片模型"
    case "videoModel":
      return "视频模型"
    case "ttsProvider":
      return "系统配音"
  }
}

function getModeLabel(modeId: NonNullable<ModelDefaultsDocument["modeDefaults"]>[number]["modeId"]) {
  return modeId === "high_quality" ? "高质量模式" : "量产模式"
}

function buildModelSnapshot(input: {
  slotType: ModelSlotType
  model: ModelRecord
  provider: Awaited<ReturnType<typeof listProviderRecords>>[number]
  selectionSource?: ResolvedSlotSnapshot["selectionSource"]
  selectionReason?: string
  routingStrategy?: ResolvedSlotSnapshot["routingStrategy"]
  routingPolicyNote?: string
  fallbackCandidates?: NonNullable<ResolvedSlotSnapshot["fallbackCandidates"]>
}): ResolvedSlotSnapshot {
  return {
    slotType: input.slotType,
    providerId: input.provider.id,
    providerKey: input.provider.providerKey,
    providerType: input.provider.providerType,
    modelId: input.model.id,
    modelKey: input.model.modelKey,
    providerModelId: input.model.providerModelId,
    displayName: input.model.displayName,
    capabilityJson: input.model.capabilityJson ?? {},
    routingProfile: buildModelRoutingProfile({
      slotType: input.slotType,
      providerModelId: input.model.providerModelId,
      providerType: input.provider.providerType,
      capabilityJson: input.model.capabilityJson ?? {},
    }),
    validatedAt: input.model.lastValidatedAt,
    selectionSource: input.selectionSource,
    selectionReason: input.selectionReason,
    routingStrategy: input.routingStrategy,
    routingPolicyNote: input.routingPolicyNote,
    fallbackCandidates: input.fallbackCandidates ?? [],
  }
}

function buildTtsSnapshot(input: {
  provider: Awaited<ReturnType<typeof listProviderRecords>>[number]
  selectionSource?: ResolvedSlotSnapshot["selectionSource"]
  selectionReason?: string
  routingStrategy?: ResolvedSlotSnapshot["routingStrategy"]
  routingPolicyNote?: string
  fallbackCandidates?: NonNullable<ResolvedSlotSnapshot["fallbackCandidates"]>
}): ResolvedSlotSnapshot {
  return {
    slotType: "ttsProvider",
    providerId: input.provider.id,
    providerKey: input.provider.providerKey,
    providerType: input.provider.providerType,
    modelId: input.provider.id,
    modelKey: input.provider.providerKey,
    providerModelId: input.provider.providerType,
    displayName: input.provider.displayName,
    capabilityJson: {},
    routingProfile: buildModelRoutingProfile({
      slotType: "ttsProvider",
      providerModelId: input.provider.providerType,
      providerType: input.provider.providerType,
      capabilityJson: {},
    }),
    validatedAt: input.provider.lastValidatedAt,
    selectionSource: input.selectionSource,
    selectionReason: input.selectionReason,
    routingStrategy: input.routingStrategy,
    routingPolicyNote: input.routingPolicyNote,
    fallbackCandidates: input.fallbackCandidates ?? [],
  }
}

function resolvePolicySelection(input: {
  policy: SlotRoutingPolicy | undefined
  slotType: ModelSlotType
  models: ModelRecord[]
  providers: Awaited<ReturnType<typeof listProviderRecords>>
}) {
  const policy = input.policy
  if (!policy?.enabled || !policy.primary) {
    return null
  }

  if (input.slotType === "ttsProvider") {
    const selectedProviderId = policy.primary.providerId ?? policy.primary.modelId
    if (!selectedProviderId) {
      return null
    }
    const provider = getAvailableProvider(selectedProviderId, input.providers)
    return provider ? { provider } : null
  }

  const selectedModelId = policy.primary.modelId
  if (!selectedModelId) {
    return null
  }
  const model = getSelectableModel(input.models, selectedModelId, input.slotType)
  if (!model) {
    return null
  }
  const provider = getAvailableProvider(model.providerId, input.providers)
  return provider ? { model, provider } : null
}

type ResolvedFallbackCandidate = NonNullable<ResolvedSlotSnapshot["fallbackCandidates"]>[number]

function buildFallbackCandidates(input: {
  policy: SlotRoutingPolicy | undefined
  slotType: ModelSlotType
  models: ModelRecord[]
  providers: Awaited<ReturnType<typeof listProviderRecords>>
}): ResolvedFallbackCandidate[] {
  const policy = input.policy
  if (!policy?.enabled || !policy.fallbacks.length) {
    return []
  }

  const seen = new Set<string>()
  return policy.fallbacks.flatMap<ResolvedFallbackCandidate>((selection) => {
    if (input.slotType === "ttsProvider") {
      const providerId = selection.providerId ?? selection.modelId
      if (!providerId || seen.has(providerId)) {
        return []
      }
      const provider = getAvailableProvider(providerId, input.providers)
      if (!provider) {
        return []
      }
      seen.add(providerId)
      return [{
        slotType: "ttsProvider" as const,
        providerId: provider.id,
        providerKey: provider.providerKey,
        providerType: provider.providerType,
        modelId: provider.id,
        modelKey: provider.providerKey,
        providerModelId: provider.providerType,
        displayName: provider.displayName,
        capabilityJson: {},
        routingProfile: buildModelRoutingProfile({
          slotType: "ttsProvider",
          providerModelId: provider.providerType,
          providerType: provider.providerType,
          capabilityJson: {},
        }),
        fallbackTriggers: policy.fallbackTriggers,
        validatedAt: provider.lastValidatedAt,
      }]
    }

    const modelId = selection.modelId
    if (!modelId || seen.has(modelId)) {
      return []
    }
    const model = getSelectableModel(input.models, modelId, input.slotType)
    const provider = model ? getAvailableProvider(model.providerId, input.providers) : null
    if (!model || !provider) {
      return []
    }
    seen.add(modelId)
    return [{
      slotType: input.slotType,
      providerId: provider.id,
      providerKey: provider.providerKey,
      providerType: provider.providerType,
      modelId: model.id,
      modelKey: model.modelKey,
      providerModelId: model.providerModelId,
      displayName: model.displayName,
      capabilityJson: model.capabilityJson ?? {},
      routingProfile: buildModelRoutingProfile({
        slotType: input.slotType,
        providerModelId: model.providerModelId,
        providerType: provider.providerType,
        capabilityJson: model.capabilityJson ?? {},
      }),
      fallbackTriggers: policy.fallbackTriggers,
      validatedAt: model.lastValidatedAt,
    }]
  })
}

export async function resolveEffectiveSlots(input: {
  modeId: NonNullable<ModelDefaultsDocument["modeDefaults"]>[number]["modeId"]
  taskOverrides?: TaskModelOverride
}) {
  const [defaults, policies, models, providers] = await Promise.all([
    getModelDefaultsDocument(),
    getModelRoutingPoliciesDocument(),
    listModelRecords(),
    listProviderRecords(),
  ])

  const modeDefaults = getModeDefault(defaults, input.modeId)
  const resolved: ResolvedSlotSnapshot[] = []

  for (const slotType of ALL_SLOTS) {
    if (slotType === "ttsProvider") {
      const overrideSelectionId = input.taskOverrides?.[slotType]?.providerId ?? input.taskOverrides?.[slotType]?.modelId
      const modePolicy = policies.modes[input.modeId]?.[slotType]
      const globalPolicy = policies.global[slotType]
      const policySelection =
        overrideSelectionId
          ? null
          : resolvePolicySelection({ policy: modePolicy, slotType, models, providers }) ??
            resolvePolicySelection({ policy: globalPolicy, slotType, models, providers })
      const selectedPolicy = policySelection
        ? resolvePolicySelection({ policy: modePolicy, slotType, models, providers })
          ? modePolicy
          : globalPolicy
        : null
      const selectedPolicySource = selectedPolicy === modePolicy ? "mode_policy" : selectedPolicy === globalPolicy ? "global_policy" : undefined
      const selectedTtsId =
        overrideSelectionId ??
        policySelection?.provider.id ??
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

      const policyForFallback = selectedPolicySource ? selectedPolicy ?? undefined : undefined
      resolved.push(buildTtsSnapshot({
        provider,
        selectionSource: overrideSelectionId
          ? "task_override"
          : selectedPolicySource ??
            (modeDefaults[slotType] ? "mode_default" : "global_default"),
        selectionReason: overrideSelectionId
          ? `${getSlotLabel(slotType)}由本次任务手动指定。`
          : selectedPolicySource
            ? `${getSlotLabel(slotType)}按${selectedPolicySource === "mode_policy" ? getModeLabel(input.modeId) : "全局"}路由策略选择：${getStrategyLabel(selectedPolicy?.strategy ?? "balanced")}。`
            : `${getSlotLabel(slotType)}来自${modeDefaults[slotType] ? getModeLabel(input.modeId) : "全局"}默认模型。`,
        routingStrategy: selectedPolicy?.strategy,
        routingPolicyNote: selectedPolicy?.operatorNote,
        fallbackCandidates: overrideSelectionId
          ? []
          : buildFallbackCandidates({ policy: policyForFallback, slotType, models, providers }),
      }))
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

      resolved.push(buildModelSnapshot({
        slotType,
        model: overrideModel,
        provider,
        selectionSource: "task_override",
        selectionReason: `${getSlotLabel(slotType)}由本次任务手动指定。`,
      }))
      continue
    }

    const modePolicy = policies.modes[input.modeId]?.[slotType]
    const globalPolicy = policies.global[slotType]
    const modePolicySelection = resolvePolicySelection({ policy: modePolicy, slotType, models, providers })
    const globalPolicySelection = modePolicySelection
      ? null
      : resolvePolicySelection({ policy: globalPolicy, slotType, models, providers })
    const policySelection = modePolicySelection ?? globalPolicySelection
    const selectedPolicy = modePolicySelection ? modePolicy : globalPolicySelection ? globalPolicy : null
    const selectedPolicySource = modePolicySelection ? "mode_policy" : globalPolicySelection ? "global_policy" : undefined

    const selectedModelId = policySelection?.model?.id ?? modeDefaults[slotType]?.modelId ?? defaults.globalDefaults[slotType]?.modelId
    if (!selectedModelId) {
      throw new Error(`DEFAULT_NOT_CONFIGURED:${slotType}`)
    }

    const model = policySelection?.model ?? getSelectableModel(models, selectedModelId, slotType)
    if (!model) {
      throw new Error(`DEFAULT_TARGET_NOT_SELECTABLE:${slotType}`)
    }

    const provider = policySelection?.provider ?? getAvailableProvider(model.providerId, providers)
    if (!provider) {
      throw new Error(`PROVIDER_NOT_RESOLVED:${slotType}`)
    }

    resolved.push(buildModelSnapshot({
      slotType,
      model,
      provider,
      selectionSource: selectedPolicySource ?? (modeDefaults[slotType] ? "mode_default" : "global_default"),
      selectionReason: selectedPolicySource
        ? `${getSlotLabel(slotType)}按${selectedPolicySource === "mode_policy" ? getModeLabel(input.modeId) : "全局"}路由策略选择：${getStrategyLabel(selectedPolicy?.strategy ?? "balanced")}。`
        : `${getSlotLabel(slotType)}来自${modeDefaults[slotType] ? getModeLabel(input.modeId) : "全局"}默认模型。`,
      routingStrategy: selectedPolicy?.strategy,
      routingPolicyNote: selectedPolicy?.operatorNote,
      fallbackCandidates: buildFallbackCandidates({ policy: selectedPolicy ?? undefined, slotType, models, providers }),
    }))
  }

  return resolved
}
