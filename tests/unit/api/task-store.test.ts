import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
      title: "Desk charger launch",
      script:
        "Show the messy desk first. Introduce the charger as the upgrade. Demonstrate the clean transformation. End with a short premium CTA.",
      modeId: "high_quality",
      channelId: "reels",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "system_enhanced",
    })

    const parsedDecision = shared.reviewDecisionInputSchema.parse({
      stage: "storyboard_review",
      sceneId: "scene_2",
      decision: "approved",
      note: "opening beat works",
    })

    expect(parsedDecision.stage).toBe("storyboard_review")
    expect(created.task.targetDurationSec).toBe(30)
    expect(created.taskRunConfig.targetDurationSec).toBe(30)
    expect(created.task.generationMode).toBe("system_enhanced")
    expect(created.taskRunConfig.generationMode).toBe("system_enhanced")
    expect(created.task.generationRoute).toBe("multi_scene")
    expect(created.task.routeReason).toContain("single-shot limit")
    expect(created.task.status).toBe("waiting_review")
    expect(created.task.reviewStage).toBe("storyboard_review")
    expect(created.task.pendingReviewCount).toBe(3)
    expect(created.task.reviewUpdatedAt).toBeNull()

    const detail = await store.getTaskDetail(created.task.id)
    expect(detail?.taskRunConfig.targetDurationSec).toBe(30)
    expect(detail?.taskRunConfig.generationRoute).toBe("multi_scene")
    expect(detail?.scenes).toHaveLength(4)
    expect(detail?.scenes.reduce((total, scene) => total + scene.durationSec, 0)).toBe(30)
    expect(detail?.scenes.some((scene) => scene.script.includes("Show the product in action"))).toBe(false)
    expect(detail?.reviewStage).toBe("storyboard_review")
    expect(detail?.pendingReviewCount).toBe(3)
    expect(detail?.reviewUpdatedAt).toBeNull()
    expect(detail?.scenes[1]?.reviewNote).toBeNull()
    expect(detail?.scenes[1]?.reviewedAt).toBeNull()
    expect(detail?.scenes[1]?.keyframeReviewNote).toBeNull()
    expect(detail?.scenes[1]?.keyframeReviewedAt).toBeNull()
    expect(created.taskRunConfig.slotSnapshots.length).toBe(6)
    expect(created.taskRunConfig.slotSnapshots.find((item) => item.slotType === "textModel")?.providerId).toEqual(expect.any(String))
    expect(created.taskRunConfig.slotSnapshots.find((item) => item.slotType === "videoDraftModel")?.capabilityJson.maxSingleShotSec).toBeGreaterThan(0)
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
    const imageDraft = await registryStore.createModelRecord({
      modelKey: "image.draft",
      providerId: imageProvider.id,
      slotType: "imageDraftModel",
      providerModelId: "image-draft",
      displayName: "Image Draft",
      capabilityJson: {},
    })
    const imageFinal = await registryStore.createModelRecord({
      modelKey: "image.final",
      providerId: imageProvider.id,
      slotType: "imageFinalModel",
      providerModelId: "image-final",
      displayName: "Image Final",
      capabilityJson: {},
    })
    const videoDraft = await registryStore.createModelRecord({
      modelKey: "video.draft",
      providerId: videoProvider.id,
      slotType: "videoDraftModel",
      providerModelId: "video-draft",
      displayName: "Video Draft",
      capabilityJson: {
        maxSingleShotSec: 8,
      },
    })
    const videoFinal = await registryStore.createModelRecord({
      modelKey: "video.final",
      providerId: videoProvider.id,
      slotType: "videoFinalModel",
      providerModelId: "video-final",
      displayName: "Video Final",
      capabilityJson: {
        maxSingleShotSec: 8,
      },
    })
    const ttsModel = await registryStore.createModelRecord({
      modelKey: "edge-tts",
      providerId: ttsProvider.id,
      slotType: "ttsProvider",
      providerModelId: "edge-tts",
      displayName: "Edge TTS",
      capabilityJson: {},
    })
    for (const model of [textMode, textOverride, textLater, imageDraft, imageFinal, videoDraft, videoFinal, ttsModel]) {
      await registryStore.updateModelRecord(model.id, { lifecycleStatus: "available" })
    }

    await registryStore.updateModelDefaultsDocument({
      globalDefaults: {
        textModel: { modelId: textMode.id },
        imageDraftModel: { modelId: imageDraft.id },
        imageFinalModel: { modelId: imageFinal.id },
        videoDraftModel: { modelId: videoDraft.id },
        videoFinalModel: { modelId: videoFinal.id },
        ttsProvider: { modelId: ttsModel.id },
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
      title: "Snapshot freeze task",
      script: "Show the benefit. Explain the upgrade. Close with a CTA.",
      modeId: "high_quality",
      channelId: "reels",
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

    await registryStore.updateModelDefaultsDocument({
      globalDefaults: {
        textModel: { modelId: textLater.id },
        imageDraftModel: { modelId: imageDraft.id },
        imageFinalModel: { modelId: imageFinal.id },
        videoDraftModel: { modelId: videoDraft.id },
        videoFinalModel: { modelId: videoFinal.id },
        ttsProvider: { modelId: ttsModel.id },
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
  })

  it("persists storyboard and keyframe review decisions with truthful task review summaries", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")

    const created = await store.createTask({
      title: "Desk charger launch",
      script:
        "Show the messy desk first. Introduce the charger as the upgrade. Demonstrate the clean transformation. End with a short premium CTA.",
      modeId: "high_quality",
      channelId: "reels",
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
      title: "Fast desk charger drop",
      script:
        "Show the cluttered desk. Reveal the compact charger. Show the clean setup. End with a quick shop-now CTA.",
      modeId: "mass_production",
      channelId: "tiktok",
      aspectRatio: "9:16",
      targetDurationSec: 30,
      generationMode: "user_locked",
    })

    expect(created.task.status).toBe("waiting_review")
    expect(created.task.reviewStage).toBe("keyframe_review")
    expect(created.task.pendingReviewCount).toBe(4)

    const detail = await store.getTaskDetail(created.task.id)
    expect(detail?.reviewStage).toBe("keyframe_review")
    expect(detail?.pendingReviewCount).toBe(4)
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

    expect(normalized?.reviewStage).toBe("keyframe_review")
    expect(normalized?.pendingReviewCount).toBe(4)
    expect(normalized?.reviewUpdatedAt).toBe("2026-04-19T09:00:00.000Z")
    expect(normalized?.scenes[0]?.reviewStatus).toBe("pending")
    expect(normalized?.scenes[0]?.reviewNote).toBe("Legacy storyboard note")
    expect(normalized?.scenes[0]?.reviewedAt).toBe("2026-04-19T09:00:00.000Z")
  })

  it("promotes derived review state to auto qa when keyframe review is disabled in the frozen task config", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")

    const created = await store.createTask({
      title: "Desk charger launch",
      script:
        "Show the messy desk first. Introduce the charger as the upgrade. Demonstrate the clean transformation. End with a short premium CTA.",
      modeId: "high_quality",
      channelId: "reels",
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

    expect(normalized?.reviewStage).toBe("auto_qa")
    expect(normalized?.pendingReviewCount).toBe(0)
    expect(updatedSummary?.reviewStage).toBe("auto_qa")
    expect(updatedSummary?.pendingReviewCount).toBe(0)
    expect(updatedSummary?.status).toBe("running")
  })

  it("normalizes legacy review fields and preserves existing review metadata when detail scenes are rebuilt", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-task-store-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/task-store")
    const shared = await import("../../../packages/shared/src/index")

    const created = await store.createTask({
      title: "Desk charger launch",
      script:
        "Show the messy desk first. Introduce the charger as the upgrade. Demonstrate the clean transformation. End with a short premium CTA.",
      modeId: "high_quality",
      channelId: "reels",
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
})
