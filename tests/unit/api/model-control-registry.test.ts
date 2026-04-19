import { mkdtemp, rm } from "node:fs/promises"
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
    expect(defaultsPayload.defaults.modes.high_quality.videoFinalModel).toEqual(expect.any(String))
    expect(defaultsPayload.effective.high_quality.videoFinalModel?.valueId).toBe(
      defaultsPayload.defaults.modes.high_quality.videoFinalModel,
    )
    expect(selectablePayload.slots.imageFinalModel.length).toBeGreaterThan(0)
    expect(selectablePayload.effective.videoFinalModel?.valueId).toBe(
      defaultsPayload.defaults.modes.high_quality.videoFinalModel,
    )
  })

  it("keeps draft providers and models out of selectable pools until validation succeeds", async () => {
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
        modelKey: "staging-image-final",
        providerId: providerPayload.provider.id,
        slotType: "imageFinalModel",
        providerModelId: "gpt-image-1",
        displayName: "Staging Image Final",
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

    const selectableBefore = await app.request("/api/model-control/selectable?slotType=imageFinalModel", {
      headers: { Cookie: cookie },
    })
    const selectableBeforePayload = (await selectableBefore.json()) as {
      slots: {
        imageFinalModel: Array<{ valueId: string }>
      }
    }
    expect(selectableBeforePayload.slots.imageFinalModel.some((item) => item.valueId === modelPayload.model.id)).toBe(
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

    const selectableAfter = await app.request("/api/model-control/selectable?slotType=imageFinalModel", {
      headers: { Cookie: cookie },
    })
    const selectableAfterPayload = (await selectableAfter.json()) as {
      slots: {
        imageFinalModel: Array<{ valueId: string }>
      }
    }
    expect(selectableAfterPayload.slots.imageFinalModel.some((item) => item.valueId === modelPayload.model.id)).toBe(
      true,
    )
  })
})
