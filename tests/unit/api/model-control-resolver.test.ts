import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("API model control defaults and selectable resolution", () => {
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
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-model-control-resolver-"))
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

  async function createValidatedModel(
    app: Awaited<ReturnType<typeof createAuthedApp>>["app"],
    cookie: string,
    modelKey: string,
    displayName: string,
  ) {
    const providerResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        providerKey: `${modelKey}-provider`,
        providerType: "openai-compatible",
        displayName: `${displayName} Provider`,
        endpointUrl: "https://example.com/v1",
        authType: "bearer_token",
        secret: `${modelKey}-secret`,
      }),
    })
    const providerPayload = (await providerResponse.json()) as {
      provider: {
        id: string
      }
    }

    await app.request(`/api/model-control/validation/providers/${providerPayload.provider.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    const modelResponse = await app.request("/api/model-control/models", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        modelKey,
        providerId: providerPayload.provider.id,
        slotType: "imageModel",
        providerModelId: `${modelKey}-provider-model`,
        displayName,
        capabilityJson: {
          qualityTier: "premium",
        },
      }),
    })
    const modelPayload = (await modelResponse.json()) as {
      model: {
        id: string
      }
    }

    await app.request(`/api/model-control/validation/models/${modelPayload.model.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    return modelPayload.model.id
  }

  it("resolves effective defaults with mode overrides taking precedence over global defaults", async () => {
    const { app, cookie } = await createAuthedApp()

    const globalModelId = await createValidatedModel(app, cookie, "image-global", "Image Global")
    const modeModelId = await createValidatedModel(app, cookie, "image-hq", "Image HQ")

    const updateDefaultsResponse = await app.request("/api/model-control/defaults", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        global: {
          imageModel: globalModelId,
        },
        modes: {
          mass_production: {
            imageModel: null,
          },
          high_quality: {
            imageModel: modeModelId,
          },
        },
      }),
    })

    expect(updateDefaultsResponse.status).toBe(200)
    const updatePayload = (await updateDefaultsResponse.json()) as {
      effective: Record<string, Record<string, { valueId: string } | null>>
    }

    expect(updatePayload.effective.mass_production.imageModel?.valueId).toBe(globalModelId)
    expect(updatePayload.effective.high_quality.imageModel?.valueId).toBe(modeModelId)
  })

  it("rejects unavailable records when updating defaults", async () => {
    const { app, cookie } = await createAuthedApp()

    const providerResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        providerKey: "draft-provider",
        providerType: "openai-compatible",
        displayName: "Draft Provider",
        endpointUrl: "https://example.com/v1",
        authType: "bearer_token",
        secret: "draft-provider-secret",
      }),
    })
    const providerPayload = (await providerResponse.json()) as {
      provider: {
        id: string
      }
    }

    const modelResponse = await app.request("/api/model-control/models", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        modelKey: "draft-image",
        providerId: providerPayload.provider.id,
        slotType: "imageModel",
        providerModelId: "draft-provider-model",
        displayName: "Draft Image",
      }),
    })
    const modelPayload = (await modelResponse.json()) as {
      model: {
        id: string
      }
    }

    const updateDefaultsResponse = await app.request("/api/model-control/defaults", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        global: {
          imageModel: modelPayload.model.id,
        },
      }),
    })

    expect(updateDefaultsResponse.status).toBe(400)
    const payload = (await updateDefaultsResponse.json()) as {
      message: string
    }
    expect(payload.message).toContain("DEFAULT_TARGET_NOT_SELECTABLE")
  })
})
