import { mkdtemp, rm, writeFile } from "node:fs/promises"
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
    vi.unstubAllGlobals()
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

  it("explains missing non-TTS provider endpoints in operator-facing Chinese", async () => {
    const { app, cookie } = await createAuthedApp()

    const createResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        providerKey: "openai-missing-endpoint",
        providerType: "openai-compatible",
        displayName: "OpenAI Missing Endpoint",
        endpointUrl: "",
        authType: "bearer_token",
        secret: "sk-test-secret",
      }),
    })
    const createPayload = (await createResponse.json()) as { provider: { id: string } }

    const validateResponse = await app.request(`/api/model-control/validation/providers/${createPayload.provider.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(validateResponse.status).toBe(200)
    const validatePayload = (await validateResponse.json()) as {
      provider: {
        status: string
        lastValidationError: string | null
      }
    }

    expect(validatePayload.provider.status).toBe("invalid")
    expect(validatePayload.provider.lastValidationError).toBe("接口地址未配置：非 TTS 接入方必须填写 http:// 或 https:// 开头的接口地址。")
    expect(validatePayload.provider.lastValidationError).not.toContain("endpointUrl")
  })

  it("allows Azure TTS providers to validate without an endpoint", async () => {
    const { app, cookie } = await createAuthedApp()

    const createResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        providerKey: "azure-tts-empty-endpoint",
        providerType: "azure-tts",
        displayName: "Azure TTS Empty Endpoint",
        endpointUrl: "",
        authType: "none",
      }),
    })
    const createPayload = (await createResponse.json()) as { provider: { id: string } }

    const validateResponse = await app.request(`/api/model-control/validation/providers/${createPayload.provider.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    const validatePayload = (await validateResponse.json()) as {
      provider: { status: string; lastValidationError: string | null }
    }

    expect(validatePayload.provider.status).toBe("available")
    expect(validatePayload.provider.lastValidationError).toBeNull()
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

  it("runs a minimal text model smoke call and records the successful route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output_text: "{}" }),
      text: async () => "{\"output_text\":\"{}\"}",
    })
    vi.stubGlobal("fetch", fetchMock)
    const { app, cookie } = await createAuthedApp()

    const providerResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        providerKey: "openai-direct",
        providerType: "direct-openai",
        displayName: "OpenAI Direct",
        endpointUrl: "https://api.openai.test/v1",
        authType: "bearer_token",
        secret: "sk-test-secret",
      }),
    })
    const providerPayload = (await providerResponse.json()) as { provider: { id: string } }
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
        modelKey: "gpt55-smoke",
        providerId: providerPayload.provider.id,
        slotType: "textModel",
        providerModelId: "gpt-5.5",
        displayName: "GPT-5.5 Smoke",
      }),
    })
    const modelPayload = (await modelResponse.json()) as { model: { id: string } }

    const validateResponse = await app.request(`/api/model-control/validation/models/${modelPayload.model.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    expect(validateResponse.status).toBe(200)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.test/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-secret",
        }),
      }),
    )

    const diagnosticsResponse = await app.request(`/api/model-control/diagnostics?modelId=${modelPayload.model.id}`, {
      headers: { Cookie: cookie },
    })
    expect(diagnosticsResponse.status).toBe(200)
    const diagnosticsPayload = (await diagnosticsResponse.json()) as {
      diagnostics: Array<Record<string, unknown>>
    }

    expect(diagnosticsPayload.diagnostics[0]).toMatchObject({
      status: "success",
      slotType: "textModel",
      providerDisplayName: "OpenAI Direct",
      modelDisplayName: "GPT-5.5 Smoke",
      wireApi: "responses",
      requestPath: "/v1/responses",
      errorCategory: null,
    })
    expect(JSON.stringify(diagnosticsPayload)).not.toContain("sk-test-secret")
  })

  it("uses legacy encrypted endpoint and secret fields when validating old provider records", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output_text: "{}" }),
      text: async () => "{\"output_text\":\"{}\"}",
    })
    vi.stubGlobal("fetch", fetchMock)

    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-model-control-validation-"))
    process.env.GENERGI_DATA_DIR = dataDir
    const { encryptControlPlaneSecret } = await import("../../../apps/api/src/lib/model-control/crypto")
    const legacyEndpoint = encryptControlPlaneSecret("https://legacy-openai.example/v1")
    const legacySecret = encryptControlPlaneSecret("sk-legacy-secret")
    const timestamp = "2026-05-01T00:00:00.000Z"

    await writeFile(
      path.join(dataDir, "providers.json"),
      JSON.stringify([
        {
          id: "provider_legacy_openai",
          providerKey: "legacy-openai",
          providerType: "direct-openai",
          displayName: "Legacy OpenAI",
          endpointUrl: null,
          encryptedEndpoint: legacyEndpoint,
          encryptedSecret: legacySecret,
          endpointHint: "http****/v1",
          secretHint: "sk-l****et",
          authType: "bearer_token",
          status: "available",
          lastValidatedAt: timestamp,
          lastValidationError: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ], null, 2),
      "utf8",
    )
    await writeFile(
      path.join(dataDir, "models.json"),
      JSON.stringify([
        {
          id: "model_legacy_gpt55",
          modelKey: "legacy-gpt55",
          providerId: "provider_legacy_openai",
          slotType: "textModel",
          providerModelId: "gpt-5.5",
          displayName: "Legacy GPT-5.5",
          capabilityJson: {},
          lifecycleStatus: "draft",
          lastValidatedAt: null,
          lastValidationError: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ], null, 2),
      "utf8",
    )

    const [{ buildSessionValue }, { app }] = await Promise.all([
      import("../../../apps/api/src/lib/auth"),
      import("../../../apps/api/src/index"),
    ])
    const cookie = `genergi_session=${buildSessionValue("admin", "test-secret")}`

    const providersResponse = await app.request("/api/model-control/providers", {
      headers: { Cookie: cookie },
    })
    const providersPayload = (await providersResponse.json()) as {
      providers: Array<Record<string, unknown>>
    }
    expect(providersPayload.providers[0]).toMatchObject({
      endpointUrl: "https://legacy-openai.example/v1",
      maskedSecret: "sk-l****et",
    })
    expect(JSON.stringify(providersPayload)).not.toContain("sk-legacy-secret")

    const validateResponse = await app.request("/api/model-control/validation/models/model_legacy_gpt55", {
      method: "POST",
      headers: { Cookie: cookie },
    })
    expect(validateResponse.status).toBe(200)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://legacy-openai.example/v1/responses",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-legacy-secret",
        }),
      }),
    )
  })

  it("classifies failed smoke calls without leaking provider secrets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Incorrect API key provided: sk-bad-secret Authorization: Bearer sk-bad-secret" } }),
      text: async () => "{\"error\":{\"message\":\"Incorrect API key provided: sk-bad-secret\"}}",
    }))
    const { app, cookie } = await createAuthedApp()

    const providerResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        providerKey: "bad-openai",
        providerType: "direct-openai",
        displayName: "Bad OpenAI",
        endpointUrl: "https://api.openai.test/v1",
        authType: "bearer_token",
        secret: "sk-bad-secret",
      }),
    })
    const providerPayload = (await providerResponse.json()) as { provider: { id: string } }
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
        modelKey: "bad-gpt55",
        providerId: providerPayload.provider.id,
        slotType: "textModel",
        providerModelId: "gpt-5.5",
        displayName: "Bad GPT-5.5",
      }),
    })
    const modelPayload = (await modelResponse.json()) as { model: { id: string } }

    const validateResponse = await app.request(`/api/model-control/validation/models/${modelPayload.model.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    const validatePayload = (await validateResponse.json()) as {
      model: { lifecycleStatus: string; lastValidationError: string | null }
    }

    expect(validatePayload.model.lifecycleStatus).toBe("invalid")
    expect(validatePayload.model.lastValidationError).toContain("密钥错误")
    expect(validatePayload.model.lastValidationError).not.toContain("sk-bad-secret")

    const diagnosticsResponse = await app.request(`/api/model-control/diagnostics?modelId=${modelPayload.model.id}`, {
      headers: { Cookie: cookie },
    })
    const diagnosticsPayload = (await diagnosticsResponse.json()) as {
      diagnostics: Array<Record<string, unknown>>
    }

    expect(diagnosticsPayload.diagnostics[0]).toMatchObject({
      status: "failed",
      errorCategory: "auth_error",
      statusCode: 401,
    })
    expect(JSON.stringify(diagnosticsPayload)).not.toContain("sk-bad-secret")
  })

  it("can run an explicit low-cost image generation smoke and persist the image route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
      text: async () => "{\"data\":[{\"b64_json\":\"iVBORw0KGgo=\"}]}",
    })
    vi.stubGlobal("fetch", fetchMock)
    const { app, cookie } = await createAuthedApp()

    const providerResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        providerKey: "openai-image",
        providerType: "direct-openai",
        displayName: "OpenAI Image",
        endpointUrl: "https://api.openai.test/v1",
        authType: "bearer_token",
        secret: "sk-image-secret",
      }),
    })
    const providerPayload = (await providerResponse.json()) as { provider: { id: string } }
    await app.request(`/api/model-control/validation/providers/${providerPayload.provider.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    const modelResponse = await app.request("/api/model-control/models", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        modelKey: "gpt-image-smoke",
        providerId: providerPayload.provider.id,
        slotType: "imageModel",
        providerModelId: "gpt-image-1",
        displayName: "GPT Image Smoke",
      }),
    })
    const modelPayload = (await modelResponse.json()) as { model: { id: string } }

    await app.request(`/api/model-control/validation/models/${modelPayload.model.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ smokeMode: "minimal_generation" }),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.test/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("gpt-image-1"),
      }),
    )

    const diagnosticsResponse = await app.request(`/api/model-control/diagnostics?modelId=${modelPayload.model.id}`, {
      headers: { Cookie: cookie },
    })
    const diagnosticsPayload = (await diagnosticsResponse.json()) as { diagnostics: Array<Record<string, unknown>> }
    expect(diagnosticsPayload.diagnostics[0]).toMatchObject({
      status: "success",
      smokeMode: "minimal_generation",
      wireApi: "images_generations",
      requestPath: "/v1/images/generations",
    })
    expect(JSON.stringify(diagnosticsPayload)).not.toContain("sk-image-secret")
  })

  it("records video adapter and TTS provider diagnostics without running expensive generation", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { app, cookie } = await createAuthedApp()

    const providerResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        providerKey: "video-provider",
        providerType: "openai-compatible",
        displayName: "Video Provider",
        endpointUrl: "https://video.example.test/v1",
        authType: "bearer_token",
        secret: "sk-video-secret",
      }),
    })
    const providerPayload = (await providerResponse.json()) as { provider: { id: string } }
    await app.request(`/api/model-control/validation/providers/${providerPayload.provider.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    const modelResponse = await app.request("/api/model-control/models", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        modelKey: "veo-adapter",
        providerId: providerPayload.provider.id,
        slotType: "videoModel",
        providerModelId: "veo-3.1-fast",
        displayName: "Veo Adapter",
        capabilityJson: { maxSingleShotSec: 8 },
      }),
    })
    const modelPayload = (await modelResponse.json()) as { model: { id: string } }
    const validateVideoResponse = await app.request(`/api/model-control/validation/models/${modelPayload.model.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    const validateVideoPayload = await validateVideoResponse.json() as { model: { lifecycleStatus: string } }
    expect(validateVideoPayload.model.lifecycleStatus).toBe("available")

    const ttsProviderResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        providerKey: "edge-tts-smoke",
        providerType: "edge-tts",
        displayName: "Edge TTS Smoke",
        endpointUrl: "",
        authType: "none",
      }),
    })
    const ttsProviderPayload = (await ttsProviderResponse.json()) as { provider: { id: string } }
    await app.request(`/api/model-control/validation/providers/${ttsProviderPayload.provider.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    expect(fetchMock).not.toHaveBeenCalled()
    const diagnosticsResponse = await app.request("/api/model-control/diagnostics?limit=10", {
      headers: { Cookie: cookie },
    })
    const diagnosticsPayload = (await diagnosticsResponse.json()) as { diagnostics: Array<Record<string, unknown>> }
    expect(diagnosticsPayload.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modelId: modelPayload.model.id,
        status: "skipped",
        wireApi: "video_generation",
        requestPath: "按视频适配器",
      }),
      expect.objectContaining({
        providerId: ttsProviderPayload.provider.id,
        modelId: null,
        status: "success",
        wireApi: "tts",
        requestPath: "provider",
      }),
    ]))
  })

  it("records a config diagnostic when a non-TTS model is bound to a TTS provider", async () => {
    const { app, cookie } = await createAuthedApp()

    const providerResponse = await app.request("/api/model-control/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        providerKey: "edge-tts-model-mismatch",
        providerType: "edge-tts",
        displayName: "Edge TTS Mismatch",
        endpointUrl: "",
        authType: "none",
      }),
    })
    const providerPayload = (await providerResponse.json()) as { provider: { id: string } }
    await app.request(`/api/model-control/validation/providers/${providerPayload.provider.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })

    const modelResponse = await app.request("/api/model-control/models", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        modelKey: "text-bound-to-tts",
        providerId: providerPayload.provider.id,
        slotType: "textModel",
        providerModelId: "edge-tts",
        displayName: "Text Bound To TTS",
        capabilityJson: {},
      }),
    })
    const modelPayload = (await modelResponse.json()) as { model: { id: string } }

    const validateResponse = await app.request(`/api/model-control/validation/models/${modelPayload.model.id}`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    const validatePayload = (await validateResponse.json()) as {
      model: { lifecycleStatus: string; lastValidationError: string | null }
    }
    expect(validatePayload.model.lifecycleStatus).toBe("invalid")
    expect(validatePayload.model.lastValidationError).toContain("TTS providers cannot validate non-TTS model slots")
    expect(validatePayload.model.lastValidationError).not.toContain("接口地址")

    const diagnosticsResponse = await app.request(`/api/model-control/diagnostics?modelId=${modelPayload.model.id}`, {
      headers: { Cookie: cookie },
    })
    const diagnosticsPayload = (await diagnosticsResponse.json()) as { diagnostics: Array<Record<string, unknown>> }
    expect(diagnosticsPayload.diagnostics[0]).toMatchObject({
      providerId: providerPayload.provider.id,
      modelId: modelPayload.model.id,
      slotType: "textModel",
      status: "failed",
      smokeMode: "config",
      errorCategory: "config_error",
    })
  })
})
