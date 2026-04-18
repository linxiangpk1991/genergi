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
