import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("API model control registry routes", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
    process.env.GENERGI_SESSION_SECRET = "test-secret"
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
    process.env.GENERGI_MODEL_CONTROL_MASTER_KEY = "0123456789abcdef0123456789abcdef"
  })

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
    delete process.env.GENERGI_SESSION_SECRET
    delete process.env.GENERGI_ADMIN_USERNAME
    delete process.env.GENERGI_ADMIN_PASSWORD
    delete process.env.GENERGI_MODEL_CONTROL_MASTER_KEY
    process.env.NODE_ENV = "test"
    dataDir = ""
    vi.resetModules()
  })

  async function createAuthedApp() {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-model-control-registry-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const [{ buildSessionValue }, { app }] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
    ])

    return {
      app,
      cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
    }
  }

  async function createAuthedAppWithData(seed: {
    providers?: unknown
    models?: unknown
    defaults?: unknown
  }) {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-model-control-registry-"))
    process.env.GENERGI_DATA_DIR = dataDir

    if (seed.providers !== undefined) {
      await writeFile(path.join(dataDir, "providers.json"), JSON.stringify(seed.providers, null, 2), "utf8")
    }
    if (seed.models !== undefined) {
      await writeFile(path.join(dataDir, "models.json"), JSON.stringify(seed.models, null, 2), "utf8")
    }
    if (seed.defaults !== undefined) {
      await writeFile(path.join(dataDir, "model-defaults.json"), JSON.stringify(seed.defaults, null, 2), "utf8")
    }

    const [{ buildSessionValue }, { app }] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
    ])

    return {
      app,
      cookie: `genergi_session=${buildSessionValue("admin", "test-secret")}`,
    }
  }

  it("exposes only four runtime slots and collapses legacy media defaults into unified image/video defaults", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-model-control-registry-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const modelControl = await import("../../../packages/shared/src/model-control")
    const shared = await import("../../../packages/shared/src/index")

    expect(modelControl.modelSlotTypeSchema.options).toEqual([
      "textModel",
      "imageModel",
      "videoModel",
      "ttsProvider",
    ])
    expect(Object.keys(modelControl.taskModelOverrideSchema.shape)).toEqual([
      "textModel",
      "imageModel",
      "videoModel",
      "ttsProvider",
    ])
    expect(Object.keys(modelControl.modelControlDefaultsSchema.shape.global.shape)).toEqual([
      "textModel",
      "imageModel",
      "videoModel",
      "ttsProvider",
    ])

    await writeFile(
      path.join(dataDir, "model-defaults.json"),
      JSON.stringify({
        globalDefaults: {
          textModel: { modelId: "text.global" },
          imageDraftModel: { modelId: "image.draft" },
          imageFinalModel: { modelId: "image.final" },
          videoDraftModel: { modelId: "video.draft" },
          videoFinalModel: { modelId: "video.final" },
          ttsProvider: { providerId: "provider_edge_tts", modelId: "provider_edge_tts" },
        },
        modeDefaults: [
          {
            modeId: "high_quality",
            slots: {
              imageDraftModel: { modelId: "image.hq.draft" },
              imageFinalModel: { modelId: "image.hq.final" },
              videoDraftModel: { modelId: "video.hq.draft" },
              videoFinalModel: { modelId: "video.hq.final" },
            },
          },
        ],
        updatedAt: "2026-04-20T00:00:00.000Z",
      }, null, 2),
      "utf8",
    )

    const normalized = await shared.readModelDefaults()

    expect(normalized.globalDefaults).toMatchObject({
      textModel: { modelId: "text.global" },
      imageModel: { modelId: "image.final" },
      videoModel: { modelId: "video.final" },
      ttsProvider: { providerId: "provider_edge_tts", modelId: "provider_edge_tts" },
    })
    expect(normalized.modeDefaults.find((entry) => entry.modeId === "high_quality")?.slots).toMatchObject({
      imageModel: { modelId: "image.hq.final" },
      videoModel: { modelId: "video.hq.final" },
    })
    expect("imageDraftModel" in normalized.globalDefaults).toBe(false)
    expect("imageFinalModel" in normalized.globalDefaults).toBe(false)
    expect("videoDraftModel" in normalized.globalDefaults).toBe(false)
    expect("videoFinalModel" in normalized.globalDefaults).toBe(false)
  })

  it("lists seeded providers, models, defaults, and selectable pools without leaking raw secrets", async () => {
    const { app, cookie } = await createAuthedApp()

    const [providersResponse, modelsResponse, defaultsResponse, selectableResponse] = await Promise.all([
      app.request("/api/model-control/providers", {
        headers: { Cookie: cookie },
      }),
      app.request("/api/model-control/models", {
        headers: { Cookie: cookie },
      }),
      app.request("/api/model-control/defaults", {
        headers: { Cookie: cookie },
      }),
      app.request("/api/model-control/selectable?modeId=high_quality", {
        headers: { Cookie: cookie },
      }),
    ])

    expect(providersResponse.status).toBe(200)
    expect(modelsResponse.status).toBe(200)
    expect(defaultsResponse.status).toBe(200)
    expect(selectableResponse.status).toBe(200)

    const providersPayload = (await providersResponse.json()) as {
      providers: Array<Record<string, unknown>>
    }
    const modelsPayload = (await modelsResponse.json()) as {
      models: Array<Record<string, unknown>>
    }
    const defaultsPayload = (await defaultsResponse.json()) as {
      defaults: {
        global: Record<string, string | null>
        modes: Record<string, Record<string, string | null>>
      }
      effective: Record<string, Record<string, { valueId: string } | null>>
    }
    const selectablePayload = (await selectableResponse.json()) as {
      slots: Record<string, Array<{ valueId: string }>>
      effective: Record<string, { valueId: string } | null>
    }

    expect(providersPayload.providers.length).toBeGreaterThanOrEqual(3)
    expect(modelsPayload.models.length).toBeGreaterThanOrEqual(5)
    expect(providersPayload.providers[0]).not.toHaveProperty("encryptedSecret")
    expect(providersPayload.providers[0]).not.toHaveProperty("secret")
    expect(Object.keys(defaultsPayload.defaults.global)).toEqual([
      "textModel",
      "imageModel",
      "videoModel",
      "ttsProvider",
    ])
    expect(defaultsPayload.defaults.modes.high_quality.videoModel).toEqual(expect.any(String))
    expect(defaultsPayload.effective.high_quality.videoModel?.valueId).toBe(
      defaultsPayload.defaults.modes.high_quality.videoModel,
    )
    expect(Object.keys(selectablePayload.slots)).toEqual([
      "textModel",
      "imageModel",
      "videoModel",
      "ttsProvider",
    ])
    expect(selectablePayload.slots.imageModel.length).toBeGreaterThan(0)
    expect(selectablePayload.effective.videoModel?.valueId).toBe(
      defaultsPayload.defaults.modes.high_quality.videoModel,
    )
  })

  it("maps legacy media slot records into image/video registry and selectable pools", async () => {
    const timestamp = "2026-04-20T02:00:00.000Z"
    const providerId = "provider_openai"
    const imageModelId = "legacy_image_final_model"
    const videoModelId = "legacy_video_final_model"
    const ttsProviderId = "provider_edge_tts"

    const { app, cookie } = await createAuthedAppWithData({
      providers: [
        {
          id: providerId,
          providerKey: "openai-compatible",
          providerType: "openai-compatible",
          displayName: "OpenAI Compatible",
          authType: "none",
          endpointUrl: "https://example.com/v1",
          encryptedEndpoint: null,
          encryptedSecret: null,
          endpointHint: "https://example.com/v1",
          secretHint: null,
          status: "available",
          lastValidatedAt: timestamp,
          lastValidationError: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: ttsProviderId,
          providerKey: "edge-tts",
          providerType: "edge-tts",
          displayName: "Edge TTS",
          authType: "none",
          endpointUrl: "",
          encryptedEndpoint: null,
          encryptedSecret: null,
          endpointHint: null,
          secretHint: null,
          status: "available",
          lastValidatedAt: timestamp,
          lastValidationError: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      models: [
        {
          id: "legacy_text_model",
          modelKey: "text.default",
          providerId,
          slotType: "textModel",
          providerModelId: "text.default",
          displayName: "Claude Opus 4.6",
          capabilityJson: {},
          lifecycleStatus: "available",
          lastValidatedAt: timestamp,
          lastValidationError: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: imageModelId,
          modelKey: "image.premium",
          providerId,
          slotType: "imageFinalModel",
          providerModelId: "image.premium",
          displayName: "Gemini Legacy Premium Image",
          capabilityJson: {
            qualityTier: "premium",
          },
          lifecycleStatus: "available",
          lastValidatedAt: timestamp,
          lastValidationError: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: videoModelId,
          modelKey: "video.hd",
          providerId,
          slotType: "videoFinalModel",
          providerModelId: "video.hd",
          displayName: "Veo Legacy HD",
          capabilityJson: {
            maxSingleShotSec: 8,
          },
          lifecycleStatus: "available",
          lastValidatedAt: timestamp,
          lastValidationError: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      defaults: {
        globalDefaults: {},
        modeDefaults: [
          {
            modeId: "high_quality",
            slots: {
              textModel: { modelId: "legacy_text_model" },
              imageModel: { modelId: imageModelId },
              videoModel: { modelId: videoModelId },
              ttsProvider: { providerId: ttsProviderId, modelId: ttsProviderId },
            },
          },
        ],
        updatedAt: timestamp,
      },
    })

    const [modelsResponse, selectableResponse] = await Promise.all([
      app.request("/api/model-control/models", {
        headers: { Cookie: cookie },
      }),
      app.request("/api/model-control/selectable?modeId=high_quality", {
        headers: { Cookie: cookie },
      }),
    ])

    expect(modelsResponse.status).toBe(200)
    expect(selectableResponse.status).toBe(200)

    const modelsPayload = (await modelsResponse.json()) as {
      models: Array<{ id: string; slotType: string; providerModelId: string }>
    }
    const selectablePayload = (await selectableResponse.json()) as {
      slots: Record<string, Array<{ valueId: string }>>
      effective: Record<string, { valueId: string } | null>
    }

    expect(modelsPayload.models.find((model) => model.id === imageModelId)?.slotType).toBe("imageModel")
    expect(modelsPayload.models.find((model) => model.id === videoModelId)?.slotType).toBe("videoModel")
    expect(modelsPayload.models.find((model) => model.id === imageModelId)?.providerModelId).toBe("gemini-3-pro-image-preview-2k")
    expect(modelsPayload.models.find((model) => model.id === videoModelId)?.providerModelId).toBe("veo3.1")
    expect(selectablePayload.slots.imageModel.some((item) => item.valueId === imageModelId)).toBe(true)
    expect(selectablePayload.slots.videoModel.some((item) => item.valueId === videoModelId)).toBe(true)
    expect(selectablePayload.effective.imageModel?.valueId).toBe(imageModelId)
    expect(selectablePayload.effective.videoModel?.valueId).toBe(videoModelId)
  })

  it("keeps unvalidated providers and models out of selectable pools until validation succeeds", async () => {
    const { app, cookie } = await createAuthedApp()

    const providerResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        providerKey: "openai-staging",
        providerType: "openai-compatible",
        displayName: "OpenAI Staging",
        endpointUrl: "https://example.com/v1",
        authType: "bearer_token",
        secret: "staging-secret-token",
      }),
    })

    expect(providerResponse.status).toBe(201)
    const providerPayload = (await providerResponse.json()) as {
      provider: {
        id: string
        status: string
      }
    }
    expect(providerPayload.provider.status).toBe("draft")

    const modelResponse = await app.request("/api/model-control/models", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        modelKey: "staging-image",
        providerId: providerPayload.provider.id,
        slotType: "imageModel",
        providerModelId: "gpt-image-1",
        displayName: "Staging Image",
        capabilityJson: {
          qualityTier: "standard",
        },
      }),
    })

    expect(modelResponse.status).toBe(201)
    const modelPayload = (await modelResponse.json()) as {
      model: {
        id: string
        lifecycleStatus: string
      }
    }
    expect(modelPayload.model.lifecycleStatus).toBe("draft")

    const selectableBefore = await app.request("/api/model-control/selectable?slotType=imageModel", {
      headers: { Cookie: cookie },
    })
    const selectableBeforePayload = (await selectableBefore.json()) as {
      slots: {
        imageModel: Array<{ valueId: string }>
      }
    }
    expect(selectableBeforePayload.slots.imageModel.some((item) => item.valueId === modelPayload.model.id)).toBe(
      false,
    )

    const validateProvider = await app.request(`/api/model-control/validation/providers/${providerPayload.provider.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    expect(validateProvider.status).toBe(200)

    const validateModel = await app.request(`/api/model-control/validation/models/${modelPayload.model.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    expect(validateModel.status).toBe(200)

    const selectableAfter = await app.request("/api/model-control/selectable?slotType=imageModel", {
      headers: { Cookie: cookie },
    })
    const selectableAfterPayload = (await selectableAfter.json()) as {
      slots: {
        imageModel: Array<{ valueId: string }>
      }
    }
    expect(selectableAfterPayload.slots.imageModel.some((item) => item.valueId === modelPayload.model.id)).toBe(
      true,
    )
  })
})
