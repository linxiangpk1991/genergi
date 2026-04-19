import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("API model control validation routes", () => {
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
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-model-control-validation-"))
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

  it("marks providers invalid when required auth is missing and keeps secret fields server-only", async () => {
    const { app, cookie } = await createAuthedApp()

    const createResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        providerKey: "anthropic-missing-secret",
        providerType: "anthropic-compatible",
        displayName: "Anthropic Missing Secret",
        endpointUrl: "https://example.com/v1",
        authType: "bearer_token",
      }),
    })

    expect(createResponse.status).toBe(201)
    const createPayload = (await createResponse.json()) as {
      provider: {
        id: string
      }
    }

    const validateResponse = await app.request(`/api/model-control/validation/providers/${createPayload.provider.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(validateResponse.status).toBe(200)
    const validatePayload = (await validateResponse.json()) as {
      provider: Record<string, unknown>
    }

    expect(validatePayload.provider.status).toBe("invalid")
    expect(validatePayload.provider.lastValidationError).toEqual(expect.stringContaining("secret"))
    expect(validatePayload.provider).not.toHaveProperty("encryptedSecret")
    expect(validatePayload.provider).not.toHaveProperty("secret")
  })

  it("requires an available provider before a model can validate", async () => {
    const { app, cookie } = await createAuthedApp()

    const providerResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        providerKey: "openai-draft",
        providerType: "openai-compatible",
        displayName: "OpenAI Draft",
        endpointUrl: "https://example.com/v1",
        authType: "bearer_token",
        secret: "draft-secret",
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
        providerModelId: "gpt-image-1",
        displayName: "Draft Image",
        capabilityJson: {
          qualityTier: "standard",
        },
      }),
    })

    const modelPayload = (await modelResponse.json()) as {
      model: {
        id: string
      }
    }

    const validateResponse = await app.request(`/api/model-control/validation/models/${modelPayload.model.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(validateResponse.status).toBe(200)
    const validatePayload = (await validateResponse.json()) as {
      model: {
        lifecycleStatus: string
        lastValidationError: string | null
      }
    }

    expect(validatePayload.model.lifecycleStatus).toBe("invalid")
    expect(validatePayload.model.lastValidationError).toContain("provider")
  })

  it("promotes providers and models to available after successful validation", async () => {
    const { app, cookie } = await createAuthedApp()

    const providerResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        providerKey: "openai-valid",
        providerType: "openai-compatible",
        displayName: "OpenAI Valid",
        endpointUrl: "https://example.com/v1",
        authType: "bearer_token",
        secret: "valid-secret",
      }),
    })
    const providerPayload = (await providerResponse.json()) as {
      provider: {
        id: string
      }
    }

    const validateProviderResponse = await app.request(
      `/api/model-control/validation/providers/${providerPayload.provider.id}`,
      {
        method: "POST",
        headers: { Cookie: cookie },
      },
    )
    const validateProviderPayload = (await validateProviderResponse.json()) as {
      provider: {
        status: string
      }
    }
    expect(validateProviderPayload.provider.status).toBe("available")

    const modelResponse = await app.request("/api/model-control/models", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        modelKey: "video-valid",
        providerId: providerPayload.provider.id,
        slotType: "videoModel",
        providerModelId: "veo-3.1-fast",
        displayName: "Video Valid",
        capabilityJson: {
          maxSingleShotSec: 8,
        },
      }),
    })
    const modelPayload = (await modelResponse.json()) as {
      model: {
        id: string
      }
    }

    const validateModelResponse = await app.request(`/api/model-control/validation/models/${modelPayload.model.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    const validateModelPayload = (await validateModelResponse.json()) as {
      model: {
        lifecycleStatus: string
      }
    }

    expect(validateModelPayload.model.lifecycleStatus).toBe("available")
  })
})
