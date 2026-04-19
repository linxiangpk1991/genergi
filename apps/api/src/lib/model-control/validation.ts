import { type ModelRecord, type ProviderRecord } from "@genergi/shared"
import {
  getDecryptedProviderConnection,
  listModelRecords,
  listProviderRecords,
  updateModelRecord,
  updateProviderRecord,
} from "./registry-store.js"

type ProviderProbeInput = {
  provider: ProviderRecord
  endpointUrl: string | null
  decryptedSecret: string | null
}

type ModelProbeInput = {
  model: ModelRecord
  provider: Awaited<ReturnType<typeof getDecryptedProviderConnection>>
  providerModelId: string
}

function requiresSecret(provider: ProviderRecord) {
  return provider.providerType !== "edge-tts" && provider.authType !== "none"
}

function requiresEndpoint(provider: ProviderRecord) {
  return provider.providerType !== "edge-tts"
}

async function resolveProviderRecord(provider: ProviderRecord | string) {
  if (typeof provider !== "string") {
    return provider
  }

  const providers = await listProviderRecords()
  return providers.find((item) => item.id === provider) ?? null
}

async function resolveModelRecord(model: ModelRecord | string) {
  if (typeof model !== "string") {
    return model
  }

  const models = await listModelRecords()
  return models.find((item) => item.id === model) ?? null
}

function assertModelCapability(model: ModelRecord) {
  if ((model.slotType === "videoDraftModel" || model.slotType === "videoFinalModel")) {
    const maxSingleShotSec = model.capabilityJson.maxSingleShotSec
    if (typeof maxSingleShotSec !== "number" || maxSingleShotSec <= 0) {
      throw new Error("MODEL_CAPABILITY_MISSING:maxSingleShotSec")
    }
  }
}

export async function validateProviderRecord(
  provider: ProviderRecord | string,
  options: {
    probeProvider?: (input: ProviderProbeInput) => Promise<void>
  } = {},
) {
  const providerRecord = await resolveProviderRecord(provider)
  if (!providerRecord) {
    throw new Error("PROVIDER_NOT_FOUND")
  }

  await updateProviderRecord(providerRecord.id, {
    status: "validating",
    lastValidationError: null,
  })

  try {
    const connection = await getDecryptedProviderConnection(providerRecord.id)
    if (!connection) {
      throw new Error("PROVIDER_NOT_FOUND")
    }

    if (requiresEndpoint(providerRecord) && !connection.endpointUrl) {
      throw new Error("PROVIDER_ENDPOINT_MISSING")
    }

    if (requiresSecret(providerRecord) && !connection.secret) {
      throw new Error("PROVIDER_SECRET_MISSING")
    }

    if (options.probeProvider) {
      await options.probeProvider({
        provider: providerRecord,
        endpointUrl: connection.endpointUrl,
        decryptedSecret: connection.secret,
      })
    }

    const updated = await updateProviderRecord(providerRecord.id, {
      status: "available",
      lastValidatedAt: new Date().toISOString(),
      lastValidationError: null,
    })
    if (updated) {
      return updated
    }
    return await resolveProviderRecord(providerRecord.id)
  } catch (error) {
    const updated = await updateProviderRecord(providerRecord.id, {
      status: "invalid",
      lastValidatedAt: new Date().toISOString(),
      lastValidationError: error instanceof Error ? error.message : String(error),
    })
    if (updated) {
      return updated
    }
    return await resolveProviderRecord(providerRecord.id)
  }
}

export async function validateModelRecord(
  model: ModelRecord | string,
  options: {
    probeModel?: (input: ModelProbeInput) => Promise<void>
  } = {},
) {
  const modelRecord = await resolveModelRecord(model)
  if (!modelRecord) {
    throw new Error("MODEL_NOT_FOUND")
  }

  await updateModelRecord(modelRecord.id, {
    lifecycleStatus: "validating",
    lastValidationError: null,
  })

  try {
    const provider = await getDecryptedProviderConnection(modelRecord.providerId)
    if (!provider) {
      throw new Error("PROVIDER_NOT_FOUND")
    }

    if (provider.status !== "available") {
      throw new Error("PROVIDER_NOT_AVAILABLE")
    }

    assertModelCapability(modelRecord)

    if (options.probeModel) {
      await options.probeModel({
        model: modelRecord,
        provider,
        providerModelId: modelRecord.providerModelId,
      })
    }

    const updated = await updateModelRecord(modelRecord.id, {
      lifecycleStatus: "available",
      lastValidatedAt: new Date().toISOString(),
      lastValidationError: null,
    })
    if (updated) {
      return updated
    }
    return await resolveModelRecord(modelRecord.id)
  } catch (error) {
    const updated = await updateModelRecord(modelRecord.id, {
      lifecycleStatus: "invalid",
      lastValidatedAt: new Date().toISOString(),
      lastValidationError: error instanceof Error ? error.message : String(error),
    })
    if (updated) {
      return updated
    }
    return await resolveModelRecord(modelRecord.id)
  }
}
