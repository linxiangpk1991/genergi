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
    slotType = "imageModel",
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
        slotType,
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

  it("saves routing policies and freezes the selected model with visible fallback reasons", async () => {
    const { app, cookie } = await createAuthedApp()

    const primaryModelId = await createValidatedModel(app, cookie, "image-primary", "Image Primary")
    const fallbackModelId = await createValidatedModel(app, cookie, "image-backup", "Image Backup")

    const updateRoutingResponse = await app.request("/api/model-control/routing", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        modes: {
          high_quality: {
            imageModel: {
              enabled: true,
              strategy: "quality_first",
              primary: { modelId: primaryModelId },
              fallbacks: [{ modelId: fallbackModelId }],
              fallbackTriggers: ["timeout", "rate_limit", "provider_error"],
              operatorNote: "高质量任务优先用主力生图，网关不稳时再换备用。",
            },
          },
        },
      }),
    })

    expect(updateRoutingResponse.status).toBe(200)
    const updatePayload = (await updateRoutingResponse.json()) as {
      resolved: {
        high_quality: {
          imageModel: {
            primary: { recordId: string; displayName: string } | null
            fallbacks: Array<{ recordId: string; displayName: string }>
            summary: string
          }
        }
      }
    }

    expect(updatePayload.resolved.high_quality.imageModel.primary?.recordId).toBe(primaryModelId)
    expect(updatePayload.resolved.high_quality.imageModel.fallbacks[0]?.recordId).toBe(fallbackModelId)
    expect(updatePayload.resolved.high_quality.imageModel.summary).toContain("高质量优先")

    const { resolveEffectiveSlots } = await import("../../../apps/api/src/lib/model-control/resolver")
    const resolved = await resolveEffectiveSlots({ modeId: "high_quality" })
    const imageSlot = resolved.find((slot) => slot.slotType === "imageModel")

    expect(imageSlot?.modelId).toBe(primaryModelId)
    expect(imageSlot?.selectionReason).toContain("高质量模式")
    expect(imageSlot?.selectionReason).toContain("高质量优先")
    expect(imageSlot?.fallbackCandidates?.[0]?.modelId).toBe(fallbackModelId)
    expect(imageSlot?.fallbackCandidates?.[0]?.fallbackTriggers).toEqual([
      "timeout",
      "rate_limit",
      "provider_error",
    ])

    const overrideResolved = await resolveEffectiveSlots({
      modeId: "high_quality",
      taskOverrides: {
        imageModel: { modelId: fallbackModelId },
      },
    })
    const overrideImageSlot = overrideResolved.find((slot) => slot.slotType === "imageModel")

    expect(overrideImageSlot?.modelId).toBe(fallbackModelId)
    expect(overrideImageSlot?.selectionReason).toContain("本次任务手动指定")
    expect(overrideImageSlot?.fallbackCandidates ?? []).toHaveLength(0)
  })

  it("returns a task route preview with selection reasons and fallback candidates", async () => {
    const { app, cookie } = await createAuthedApp()

    const primaryModelId = await createValidatedModel(app, cookie, "image-primary", "Image Primary")
    const fallbackModelId = await createValidatedModel(app, cookie, "image-backup", "Image Backup")

    await app.request("/api/model-control/routing", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        modes: {
          high_quality: {
            imageModel: {
              enabled: true,
              strategy: "quality_first",
              primary: { modelId: primaryModelId },
              fallbacks: [{ modelId: fallbackModelId }],
              fallbackTriggers: ["timeout", "provider_error"],
              operatorNote: "图片质量优先，失败后切备用。",
            },
          },
        },
      }),
    })

    const response = await app.request("/api/model-control/route-preview?modeId=high_quality", {
      headers: { Cookie: cookie },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      modeId: string
      slots: Array<{
        slotType: string
        displayName: string
        provider: string
        wireApi: string
        requestPath: string
        selectionReason: string
        fallbackCandidates: Array<{ displayName: string }>
        warnings: string[]
      }>
      warnings: string[]
    }

    expect(payload.modeId).toBe("high_quality")
    expect(payload.slots).toHaveLength(4)
    const imageSlot = payload.slots.find((slot) => slot.slotType === "imageModel")
    expect(imageSlot?.displayName).toBe("Image Primary")
    expect(imageSlot?.provider).toBe("Image Primary Provider")
    expect(imageSlot?.wireApi).toBeTruthy()
    expect(imageSlot?.requestPath).toBeTruthy()
    expect(imageSlot?.selectionReason).toContain("高质量模式")
    expect(imageSlot?.selectionReason).toContain("高质量优先")
    expect(imageSlot?.fallbackCandidates[0]?.displayName).toBe("Image Backup")
    expect(imageSlot?.warnings).toEqual([])
    expect(payload.warnings).toEqual([])
  })

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
