import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

async function readJsonFile<T>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T
}

async function writeJsonFile(filePath: string, value: unknown) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8")
}

describe("API task store", () => {
  let dataDir = ""

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
    dataDir = ""
    vi.resetModules()
  })

  it("creates a task with a persisted final duration and duration-aware scenes", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")
    const shared = await import("../../../packages/shared/src/index")

    const created = await store.createTask({
      projectId: "project_default",
      title: "Desk charger launch",
      script:
        "Show the messy desk first. Introduce the charger as the upgrade. Demonstrate the clean transformation. End with a short premium CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
      audioStrategy: "native_plus_tts_ducked",
    })

    const parsedDecision = shared.reviewDecisionInputSchema.parse({
      stage: "storyboard_review",
      sceneId: "scene_2",
      decision: "approved",
      note: "opening beat works",
    })

    expect(parsedDecision.stage).toBe("storyboard_review")
    expect(created.task.targetDurationSec).toBe(30)
    expect(created.task.projectId).toBe("project_default")
    expect(created.taskRunConfig.targetDurationSec).toBe(30)
    expect(created.task.generationMode).toBe("system_enhanced")
    expect(created.taskRunConfig.generationMode).toBe("system_enhanced")
    expect(created.task.audioStrategy).toBe("native_plus_tts_ducked")
    expect(created.taskRunConfig.audioStrategy).toBe("native_plus_tts_ducked")
    expect(created.task.executionMode).toBe("review_required")
    expect(created.task.terminalPresetId).toBe("phone_portrait")
    expect(created.task.renderSpecJson.terminalPresetId).toBe("phone_portrait")
    expect(created.task.blueprintVersion).toBe(1)
    expect(created.task.blueprintStatus).toBe("pending_generation")
    expect(created.task.generationRoute).toBe("multi_scene")
    expect(created.task.routeReason).toContain("single-shot limit")
    expect(created.task.status).toBe("queued")
    expect(created.task.reviewStage).toBeNull()
    expect(created.task.pendingReviewCount).toBe(0)
    expect(created.task.reviewUpdatedAt).toBeNull()

    const detail = await store.getTaskDetail(created.task.id)
    expect(detail?.projectId).toBe("project_default")
    expect(detail?.taskRunConfig.targetDurationSec).toBe(30)
    expect(detail?.taskRunConfig.projectId).toBe("project_default")
    expect(detail?.taskRunConfig.executionMode).toBe("review_required")
    expect(detail?.taskRunConfig.terminalPresetId).toBe("phone_portrait")
    expect(detail?.taskRunConfig.renderSpecJson.terminalPresetId).toBe("phone_portrait")
    expect(detail?.taskRunConfig.audioStrategy).toBe("native_plus_tts_ducked")
    expect(detail?.blueprintVersion).toBe(1)
    expect(detail?.blueprintStatus).toBe("pending_generation")
    expect(detail?.taskRunConfig.generationRoute).toBe("multi_scene")
    expect(detail?.scenes).toHaveLength(4)
    expect(detail?.scenes.reduce((total, scene) => total + scene.durationSec, 0)).toBe(30)
    expect(detail?.scenes.some((scene) => scene.script.includes("Show the product in action"))).toBe(false)
    expect(detail?.reviewStage).toBeNull()
    expect(detail?.pendingReviewCount).toBe(0)
    expect(detail?.reviewUpdatedAt).toBeNull()
    expect(detail?.scenes[1]?.reviewNote).toBeNull()
    expect(detail?.scenes[1]?.reviewedAt).toBeNull()
    expect(detail?.scenes[1]?.keyframeReviewNote).toBeNull()
    expect(detail?.scenes[1]?.keyframeReviewedAt).toBeNull()
    expect(created.taskRunConfig.slotSnapshots.length).toBe(4)
    expect(created.taskRunConfig.slotSnapshots.find((item) => item.slotType === "textModel")?.providerId).toEqual(expect.any(String))
    expect(created.taskRunConfig.slotSnapshots.find((item) => item.slotType === "videoModel")?.capabilityJson.maxSingleShotSec).toBeGreaterThan(0)
    expect(created.taskRunConfig.slotSnapshots.find((item) => item.slotType === "ttsProvider")?.providerType).toBe("edge-tts")
  })

  it("freezes the resolved model snapshot at task creation even after defaults change later", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const taskStore = await import("../../../apps/api/src/lib/task-store")
    const registryStore = await import("../../../apps/api/src/lib/model-control/registry-store")

    const textProvider = await registryStore.createProviderRecord({
      providerKey: "text-prod",
      providerType: "openai-compatible",
      displayName: "Text Prod",
      endpointUrl: "https://api.openai.example/v1",
      authType: "none",
    })
    const imageProvider = await registryStore.createProviderRecord({
      providerKey: "image-prod",
      providerType: "openai-compatible",
      displayName: "Image Prod",
      endpointUrl: "https://api.openai.example/v1",
      authType: "none",
    })
    const videoProvider = await registryStore.createProviderRecord({
      providerKey: "video-prod",
      providerType: "openai-compatible",
      displayName: "Video Prod",
      endpointUrl: "https://api.openai.example/v1",
      authType: "none",
    })
    const ttsProvider = await registryStore.createProviderRecord({
      providerKey: "edge-tts",
      providerType: "edge-tts",
      displayName: "Edge TTS",
      endpointUrl: "https://edge-tts.local",
      authType: "none",
    })
    for (const provider of [textProvider, imageProvider, videoProvider, ttsProvider]) {
      await registryStore.updateProviderRecord(provider.id, { status: "available" })
    }

    const textMode = await registryStore.createModelRecord({
      modelKey: "text.default",
      providerId: textProvider.id,
      slotType: "textModel",
      providerModelId: "gpt-mode",
      displayName: "Mode Text",
      capabilityJson: {},
    })
    const textOverride = await registryStore.createModelRecord({
      modelKey: "text.default",
      providerId: textProvider.id,
      slotType: "textModel",
      providerModelId: "gpt-override",
      displayName: "Override Text",
      capabilityJson: {},
    })
    const textLater = await registryStore.createModelRecord({
      modelKey: "text.default",
      providerId: textProvider.id,
      slotType: "textModel",
      providerModelId: "gpt-later",
      displayName: "Later Text",
      capabilityJson: {},
    })
    const imageModel = await registryStore.createModelRecord({
      modelKey: "image.final",
      providerId: imageProvider.id,
      slotType: "imageModel",
      providerModelId: "image-final",
      displayName: "Image Model",
      capabilityJson: {},
    })
    const videoModel = await registryStore.createModelRecord({
      modelKey: "video.final",
      providerId: videoProvider.id,
      slotType: "videoModel",
      providerModelId: "video-final",
      displayName: "Video Model",
      capabilityJson: {
        maxSingleShotSec: 8,
      },
    })
    for (const model of [textMode, textOverride, textLater, imageModel, videoModel]) {
      await registryStore.updateModelRecord(model.id, { lifecycleStatus: "available" })
    }

    await registryStore.updateModelDefaultsDocument({
      globalDefaults: {
        textModel: { modelId: textMode.id },
        imageModel: { modelId: imageModel.id },
        videoModel: { modelId: videoModel.id },
        ttsProvider: { providerId: ttsProvider.id },
      },
      modeDefaults: [
        {
          modeId: "high_quality",
          slots: {
            textModel: { modelId: textMode.id },
          },
        },
      ],
      updatedAt: null,
    })

    const created = await taskStore.createTask({
      projectId: "project_default",
      title: "Snapshot freeze task",
      script: "Show the benefit. Explain the upgrade. Close with a CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
      modelOverrides: {
        textModel: {
          modelId: textOverride.id,
        },
      },
    })

    expect(created.taskRunConfig.slotSnapshots.find((item) => item.slotType === "textModel")?.displayName).toBe("Override Text")
    expect(created.taskRunConfig.textModel.id).toBe("gpt-override")
    expect(created.task.projectId).toBe("project_default")
    expect(created.task.executionMode).toBe("review_required")
    expect(created.task.terminalPresetId).toBe("phone_portrait")
    expect(created.task.renderSpecJson.terminalPresetId).toBe("phone_portrait")
    expect(created.task.blueprintVersion).toBe(1)
    expect(created.task.blueprintStatus).toBe("pending_generation")

    await registryStore.updateModelDefaultsDocument({
      globalDefaults: {
        textModel: { modelId: textLater.id },
        imageModel: { modelId: imageModel.id },
        videoModel: { modelId: videoModel.id },
        ttsProvider: { providerId: ttsProvider.id },
      },
      modeDefaults: [
        {
          modeId: "high_quality",
          slots: {
            textModel: { modelId: textLater.id },
          },
        },
      ],
      updatedAt: null,
    })

    const detail = await taskStore.getTaskDetail(created.task.id)
    const textSnapshot = detail?.taskRunConfig.slotSnapshots.find((item) => item.slotType === "textModel")
    const ttsSnapshot = detail?.taskRunConfig.slotSnapshots.find((item) => item.slotType === "ttsProvider")

    expect(textSnapshot?.displayName).toBe("Override Text")
    expect(textSnapshot?.providerModelId).toBe("gpt-override")
    expect(ttsSnapshot?.providerId).toBe(ttsProvider.id)
    expect(detail?.projectId).toBe("project_default")
    expect(detail?.taskRunConfig.projectId).toBe("project_default")
    expect(detail?.taskRunConfig.executionMode).toBe("review_required")
    expect(detail?.taskRunConfig.terminalPresetId).toBe("phone_portrait")
    expect(detail?.taskRunConfig.renderSpecJson.terminalPresetId).toBe("phone_portrait")
    expect(detail?.blueprintVersion).toBe(1)
    expect(detail?.blueprintStatus).toBe("pending_generation")
  })

  it("creates tasks from legacy media model records by normalizing them into unified runtime slots", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const timestamp = "2026-04-20T02:10:00.000Z"
    const providerId = "provider_openai"
    const ttsProviderId = "provider_edge_tts"

    await writeJsonFile(path.join(dataDir, "providers.json"), [
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
    ])

    await writeJsonFile(path.join(dataDir, "models.json"), [
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
        id: "legacy_image_model",
        modelKey: "imageFinalModel-image-premium",
        providerId,
        slotType: "imageFinalModel",
        providerModelId: "image.premium",
        displayName: "Legacy Premium Image",
        capabilityJson: {},
        lifecycleStatus: "available",
        lastValidatedAt: timestamp,
        lastValidationError: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "legacy_video_model",
        modelKey: "videoFinalModel-video-hd",
        providerId,
        slotType: "videoFinalModel",
        providerModelId: "video.hd",
        displayName: "Legacy HD Video",
        capabilityJson: {
          maxSingleShotSec: 8,
        },
        lifecycleStatus: "available",
        lastValidatedAt: timestamp,
        lastValidationError: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ])

    await writeJsonFile(path.join(dataDir, "model-defaults.json"), {
      globalDefaults: {},
      modeDefaults: [
        {
          modeId: "high_quality",
          slots: {
            textModel: { modelId: "legacy_text_model" },
            imageModel: { modelId: "legacy_image_model" },
            videoModel: { modelId: "legacy_video_model" },
            ttsProvider: { providerId: ttsProviderId, modelId: ttsProviderId },
          },
        },
      ],
      updatedAt: timestamp,
    })

    const taskStore = await import("../../../apps/api/src/lib/task-store")
    const created = await taskStore.createTask({
      projectId: "project_default",
      title: "Legacy migration task",
      script: "Show the product. Explain the benefit. End with a CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    expect(created.taskRunConfig.textModel.id).toBe("text.default")
    expect(created.taskRunConfig.imageModel.id).toBe("gemini-3-pro-image-preview-2k")
    expect(created.taskRunConfig.videoModel.id).toBe("veo3.1")
    expect(created.taskRunConfig.imageModel.label).toBe("Legacy Premium Image")
    expect(created.taskRunConfig.videoModel.label).toBe("Legacy HD Video")
    expect(created.taskRunConfig.slotSnapshots.find((item) => item.slotType === "imageModel")?.modelId).toBe("legacy_image_model")
    expect(created.taskRunConfig.slotSnapshots.find((item) => item.slotType === "videoModel")?.modelId).toBe("legacy_video_model")
  })

  it("normalizes stored media aliases in task detail runtime config when legacy records are read back", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")

    const created = await store.createTask({
      projectId: "project_default",
      title: "Legacy runtime id normalization",
      script: "Show the product. Explain the benefit. End with a CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    const detailsFile = path.join(dataDir, "task-details.json")
    const detailRecords = await readJsonFile<Record<string, Record<string, unknown>>>(detailsFile)
    const detailRecord = detailRecords[created.task.id]
    const taskRunConfig = detailRecord?.taskRunConfig as Record<string, unknown>
    const slotSnapshots = taskRunConfig?.slotSnapshots as Array<Record<string, unknown>>

    detailRecords[created.task.id] = {
      ...detailRecord,
      taskRunConfig: {
        ...taskRunConfig,
        imageModel: {
          ...(taskRunConfig?.imageModel as Record<string, unknown>),
          id: "image.premium",
        },
        videoModel: {
          ...(taskRunConfig?.videoModel as Record<string, unknown>),
          id: "video.hd",
        },
        slotSnapshots: slotSnapshots.map((slot) => {
          if (slot.slotType === "imageModel") {
            return {
              ...slot,
              providerModelId: "image.premium",
            }
          }
          if (slot.slotType === "videoModel") {
            return {
              ...slot,
              providerModelId: "video.hd",
            }
          }
          return slot
        }),
      },
    }

    await writeJsonFile(detailsFile, detailRecords)

    const normalized = await store.getTaskDetail(created.task.id)

    expect(normalized?.taskRunConfig.imageModel.id).toBe("gemini-3-pro-image-preview-2k")
    expect(normalized?.taskRunConfig.videoModel.id).toBe("veo3.1")
    expect(normalized?.taskRunConfig.slotSnapshots.find((slot) => slot.slotType === "imageModel")?.providerModelId).toBe("gemini-3-pro-image-preview-2k")
    expect(normalized?.taskRunConfig.slotSnapshots.find((slot) => slot.slotType === "videoModel")?.providerModelId).toBe("veo3.1")
  })

  it("persists storyboard and keyframe review decisions with truthful task review summaries", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")

    const created = await store.createTask({
      projectId: "project_default",
      title: "Desk charger launch",
      script:
        "Show the messy desk first. Introduce the charger as the upgrade. Demonstrate the clean transformation. End with a short premium CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    const initialDetail = await store.getTaskDetail(created.task.id)
    const pendingStoryboardSceneId = initialDetail?.scenes.find((scene) => scene.reviewStatus === "pending")?.id
    expect(pendingStoryboardSceneId).toBeTruthy()

    const firstStoryboardReview = await store.applySceneReviewDecision(created.task.id, {
      stage: "storyboard_review",
      sceneId: pendingStoryboardSceneId!,
      decision: "approved",
      note: "opening beat works",
    })

    expect(firstStoryboardReview).not.toBeNull()
    expect(firstStoryboardReview?.detail.scenes[1]?.reviewStatus).toBe("approved")
    expect(firstStoryboardReview?.detail.scenes[1]?.reviewNote).toBe("opening beat works")
    expect(firstStoryboardReview?.detail.scenes[1]?.reviewedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(firstStoryboardReview?.summary.status).toBe("waiting_review")
    expect(firstStoryboardReview?.summary.reviewStage).toBe("storyboard_review")
    expect(firstStoryboardReview?.summary.pendingReviewCount).toBe(2)
    expect(firstStoryboardReview?.summary.reviewUpdatedAt).toBe(firstStoryboardReview?.detail.scenes[1]?.reviewedAt)

    let currentSummary = firstStoryboardReview!.summary
    for (const scene of firstStoryboardReview!.detail.scenes.filter((item) => item.reviewStatus === "pending")) {
      const result = await store.applySceneReviewDecision(created.task.id, {
        stage: "storyboard_review",
        sceneId: scene.id,
        decision: "approved",
      })
      expect(result).not.toBeNull()
      currentSummary = result!.summary
    }

    expect(currentSummary.reviewStage).toBe("keyframe_review")
    expect(currentSummary.pendingReviewCount).toBe(4)
    expect(currentSummary.status).toBe("waiting_review")

    let finalResult = await store.applySceneReviewDecision(created.task.id, {
      stage: "keyframe_review",
      sceneId: "scene_1",
      decision: "rejected",
      note: "Need a brighter hero frame",
    })

    expect(finalResult).not.toBeNull()
    expect(finalResult?.detail.scenes[0]?.keyframeStatus).toBe("rejected")
    expect(finalResult?.detail.scenes[0]?.keyframeReviewNote).toBe("Need a brighter hero frame")
    expect(finalResult?.detail.scenes[0]?.keyframeReviewedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(finalResult?.summary.reviewStage).toBe("keyframe_review")
    expect(finalResult?.summary.pendingReviewCount).toBe(3)
    expect(finalResult?.summary.status).toBe("waiting_review")

    finalResult = await store.applySceneReviewDecision(created.task.id, {
      stage: "keyframe_review",
      sceneId: "scene_1",
      decision: "approved",
    })

    expect(finalResult).not.toBeNull()

    for (const scene of finalResult!.detail.scenes.filter((item) => item.keyframeStatus !== "approved")) {
      const result = await store.applySceneReviewDecision(created.task.id, {
        stage: "keyframe_review",
        sceneId: scene.id,
        decision: "approved",
      })
      expect(result).not.toBeNull()
      finalResult = result
    }

    expect(finalResult?.summary.reviewStage).toBe("auto_qa")
    expect(finalResult?.summary.pendingReviewCount).toBe(0)
    expect(finalResult?.summary.status).toBe("running")
    expect(finalResult?.detail.reviewStage).toBe("auto_qa")
    expect(finalResult?.detail.pendingReviewCount).toBe(0)

    const persistedDetail = await store.getTaskDetail(created.task.id)
    expect(persistedDetail?.scenes[0]?.keyframeStatus).toBe("approved")
    expect(persistedDetail?.scenes[0]?.keyframeReviewNote).toBeNull()
    expect(persistedDetail?.scenes[0]?.keyframeReviewedAt).toBeTruthy()
  })

  it("skips storyboard review for new mass production tasks and ignores stale storyboard pending states when review is disabled", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")

    const created = await store.createTask({
      projectId: "project_default",
      title: "Fast desk charger drop",
      script:
        "Show the cluttered desk. Reveal the compact charger. Show the clean setup. End with a quick shop-now CTA.",
      modeId: "mass_production",
      channelId: "tiktok",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "user_locked",
    })

    expect(created.task.status).toBe("queued")
    expect(created.task.reviewStage).toBeNull()
    expect(created.task.pendingReviewCount).toBe(0)

    const detail = await store.getTaskDetail(created.task.id)
    expect(detail?.reviewStage).toBeNull()
    expect(detail?.pendingReviewCount).toBe(0)
    expect(detail?.scenes.every((scene) => scene.reviewStatus === "approved")).toBe(true)
    expect(detail?.scenes.every((scene) => scene.keyframeStatus === "pending")).toBe(true)

    const tasksFile = path.join(dataDir, "tasks.json")
    const detailsFile = path.join(dataDir, "task-details.json")
    const taskRecords = await readJsonFile<Array<Record<string, unknown>>>(tasksFile)
    const detailRecords = await readJsonFile<Record<string, Record<string, unknown>>>(detailsFile)

    detailRecords[created.task.id] = {
      ...detailRecords[created.task.id],
      scenes: (detailRecords[created.task.id]?.scenes as Array<Record<string, unknown>>).map((scene, index) => ({
        ...scene,
        reviewStatus: "pending",
        reviewNote: index === 0 ? "Legacy storyboard note" : null,
        reviewedAt: index === 0 ? "2026-04-19T09:00:00.000Z" : null,
      })),
    }

    await writeJsonFile(tasksFile, taskRecords)
    await writeJsonFile(detailsFile, detailRecords)

    const normalized = await store.getTaskDetail(created.task.id)

    expect(normalized?.reviewStage).toBeNull()
    expect(normalized?.pendingReviewCount).toBe(0)
    expect(normalized?.reviewUpdatedAt).toBeNull()
    expect(normalized?.scenes[0]?.reviewStatus).toBe("pending")
    expect(normalized?.scenes[0]?.reviewNote).toBe("Legacy storyboard note")
    expect(normalized?.scenes[0]?.reviewedAt).toBe("2026-04-19T09:00:00.000Z")
  })

  it("promotes derived review state to auto qa when keyframe review is disabled in the frozen task config", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")

    const created = await store.createTask({
      projectId: "project_default",
      title: "Desk charger launch",
      script:
        "Show the messy desk first. Introduce the charger as the upgrade. Demonstrate the clean transformation. End with a short premium CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    const tasksFile = path.join(dataDir, "tasks.json")
    const detailsFile = path.join(dataDir, "task-details.json")
    const taskRecords = await readJsonFile<Array<Record<string, unknown>>>(tasksFile)
    const detailRecords = await readJsonFile<Record<string, Record<string, unknown>>>(detailsFile)

    detailRecords[created.task.id] = {
      ...detailRecords[created.task.id],
      taskRunConfig: {
        ...detailRecords[created.task.id]?.taskRunConfig,
        requireKeyframeReview: false,
      },
      scenes: (detailRecords[created.task.id]?.scenes as Array<Record<string, unknown>>).map((scene) => ({
        ...scene,
        reviewStatus: "approved",
        keyframeStatus: "pending",
      })),
    }

    await writeJsonFile(tasksFile, taskRecords)
    await writeJsonFile(detailsFile, detailRecords)

    const normalized = await store.getTaskDetail(created.task.id)
    const summaries = await store.listTasks()
    const updatedSummary = summaries.find((task) => task.id === created.task.id)

    expect(normalized?.reviewStage).toBeNull()
    expect(normalized?.pendingReviewCount).toBe(0)
    expect(updatedSummary?.reviewStage).toBeNull()
    expect(updatedSummary?.pendingReviewCount).toBe(0)
    expect(updatedSummary?.status).toBe("queued")
  })

  it("normalizes legacy review fields and preserves existing review metadata when detail scenes are rebuilt", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")
    const shared = await import("../../../packages/shared/src/index")

    const created = await store.createTask({
      projectId: "project_default",
      title: "Desk charger launch",
      script:
        "Show the messy desk first. Introduce the charger as the upgrade. Demonstrate the clean transformation. End with a short premium CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    const reviewed = await store.applySceneReviewDecision(created.task.id, {
      stage: "storyboard_review",
      sceneId: "scene_2",
      decision: "approved",
      note: "opening beat works",
    })

    const tasksFile = path.join(dataDir, "tasks.json")
    const detailsFile = path.join(dataDir, "task-details.json")
    const taskRecords = await readJsonFile<Array<Record<string, unknown>>>(tasksFile)
    const detailRecords = await readJsonFile<Record<string, Record<string, unknown>>>(detailsFile)

    taskRecords[0] = {
      ...taskRecords[0],
      targetDurationSec: 45,
    }
    delete taskRecords[0].reviewStage
    delete taskRecords[0].pendingReviewCount
    delete taskRecords[0].reviewUpdatedAt

    detailRecords[created.task.id] = {
      ...detailRecords[created.task.id],
      taskRunConfig: {
        ...detailRecords[created.task.id]?.taskRunConfig,
        targetDurationSec: 30,
      },
      reviewStage: undefined,
      pendingReviewCount: undefined,
      reviewUpdatedAt: undefined,
      scenes: (detailRecords[created.task.id]?.scenes as Array<Record<string, unknown>>).map((scene, index) =>
        index === 1
          ? scene
          : {
              ...scene,
              reviewNote: undefined,
              reviewedAt: undefined,
              keyframeReviewNote: undefined,
              keyframeReviewedAt: undefined,
            },
      ),
    }

    await writeJsonFile(tasksFile, taskRecords)
    await writeJsonFile(detailsFile, detailRecords)

    const legacySummaries = await shared.readTaskSummaries()
    const normalizedLegacySummary = legacySummaries.find((task) => task.id === created.task.id)

    expect(normalizedLegacySummary?.reviewStage).toBeNull()
    expect(normalizedLegacySummary?.pendingReviewCount).toBe(0)
    expect(normalizedLegacySummary?.reviewUpdatedAt).toBeNull()

    const normalizedDetail = await store.getTaskDetail(created.task.id)
    const preservedScene = normalizedDetail?.scenes.find((scene) => scene.id === "scene_2")
    const untouchedScene = normalizedDetail?.scenes.find((scene) => scene.id === "scene_1")

    expect(reviewed?.detail.scenes[1]?.reviewedAt).toBeTruthy()
    expect(normalizedDetail?.taskRunConfig.targetDurationSec).toBe(45)
    expect(normalizedDetail?.scenes.length).toBeGreaterThan(4)
    expect(preservedScene?.reviewStatus).toBe("approved")
    expect(preservedScene?.reviewNote).toBe("opening beat works")
    expect(preservedScene?.reviewedAt).toBe(reviewed?.detail.scenes[1]?.reviewedAt)
    expect(normalizedDetail?.reviewStage).toBe("storyboard_review")
    expect(normalizedDetail?.pendingReviewCount).toBe(4)
    expect(untouchedScene?.reviewNote).toBeNull()
    expect(untouchedScene?.reviewedAt).toBeNull()
  })

  it("falls back to exported task files when asset records are missing", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")

    const created = await store.createTask({
      projectId: "project_default",
      title: "Export fallback task",
      script: "Show the product. Explain the value. End with a CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    const exportDir = path.join(dataDir, "exports", created.task.id)
    await mkdir(exportDir, { recursive: true })
    await writeFile(path.join(exportDir, "script.txt"), "final narration", "utf8")
    await writeFile(path.join(exportDir, "source-script.txt"), "original source", "utf8")
    await writeFile(path.join(exportDir, "planning-prompt.txt"), "prompt", "utf8")
    await writeFile(path.join(exportDir, "planning-response.txt"), "response", "utf8")
    await writeFile(path.join(exportDir, "planning-audit.json"), "{\"usedFallback\":false}", "utf8")
    await writeFile(path.join(exportDir, "storyboard.json"), "{\"scenes\":[]}", "utf8")

    const assets = await store.getTaskAssets(created.task.id)
    const assetTypes = assets.map((asset) => asset.assetType)

    expect(assetTypes).toEqual([
      "script",
      "source_script",
      "planning_prompt",
      "planning_response",
      "planning_audit",
      "storyboard",
    ])
    expect(assets.every((asset) => asset.exists)).toBe(true)

    const planningResponse = assets.find((asset) => asset.assetType === "planning_response")
    expect(planningResponse?.fileName).toBe("planning-response.txt")

    const previewAsset = await store.getTaskAsset(created.task.id, `${created.task.id}_planning_response`)
    expect(previewAsset?.assetType).toBe("planning_response")
    expect(previewAsset?.exists).toBe(true)
  })

  it("rehydrates missing task summaries from persisted task details so asset center does not lose historical tasks", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")

    const created = await store.createTask({
      projectId: "project_default",
      title: "Historical task should still be listed",
      script: "Show the product. Explain the value. End with a CTA.",
      modeId: "high_quality",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    const tasksFile = path.join(dataDir, "tasks.json")
    const taskRecords = await readJsonFile<Array<Record<string, unknown>>>(tasksFile)
    await writeJsonFile(
      tasksFile,
      taskRecords.filter((task) => task.id !== created.task.id),
    )

    const beforeRepair = await readJsonFile<Array<Record<string, unknown>>>(tasksFile)
    expect(beforeRepair.some((task) => task.id === created.task.id)).toBe(false)

    const recoveredTasks = await store.listTasks()
    const recovered = recoveredTasks.find((task) => task.id === created.task.id)

    expect(recovered).toBeTruthy()
    expect(recovered?.title).toBe("Historical task should still be listed")
    expect(recovered?.projectId).toBe("project_default")
    expect(recovered?.status).toBe("queued")
    expect(recovered?.blueprintStatus).toBe("pending_generation")
    expect(recovered?.targetDurationSec).toBe(30)

    const persistedAfterRepair = await readJsonFile<Array<Record<string, unknown>>>(tasksFile)
    expect(persistedAfterRepair.some((task) => task.id === created.task.id)).toBe(true)
  })
})
