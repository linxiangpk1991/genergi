export const VIDEO_DURATION_PRESETS = [15, 30, 45, 60] as const
export type VideoDurationPreset = (typeof VIDEO_DURATION_PRESETS)[number]

export type PlannedStoryboardScene = {
  id: string
  index: number
  title: string
  sceneGoal: string
  voiceoverScript: string
  startFrameDescription: string
  script: string
  imagePrompt: string
  videoPrompt: string
  startFrameIntent: string
  endFrameIntent: string
  durationSec: number
  startLabel: string
  endLabel: string
  reviewStatus: "pending" | "approved" | "rejected"
  keyframeStatus: "pending" | "approved" | "rejected"
  continuityConstraints: string[]
}

export type SceneReviewMetadata = {
  reviewStatus?: "pending" | "approved" | "rejected"
  keyframeStatus?: "pending" | "approved" | "rejected"
  reviewNote?: string | null
  reviewedAt?: string | null
  keyframeReviewNote?: string | null
  keyframeReviewedAt?: string | null
}

export type SceneReviewMetadataCarrier = {
  id?: string | null
  index?: number | null
} & SceneReviewMetadata

export type SceneReviewRequirements = {
  requireStoryboardReview?: boolean
  requireKeyframeReview?: boolean
}

export function resolveSceneReviewDefaults(
  sceneIndex: number,
  requirements: SceneReviewRequirements = {},
) {
  const requireStoryboardReview = requirements.requireStoryboardReview ?? true
  const requireKeyframeReview = requirements.requireKeyframeReview ?? true
  const reviewStatus: PlannedStoryboardScene["reviewStatus"] = requireStoryboardReview
    ? (sceneIndex === 0 ? "approved" : "pending")
    : "approved"
  const keyframeStatus: PlannedStoryboardScene["keyframeStatus"] = requireKeyframeReview ? "pending" : "approved"

  return {
    reviewStatus,
    keyframeStatus,
  }
}

export function resolveSceneCountForDuration(targetDurationSec: number) {
  return resolveSceneCountForDurationWithLimit(targetDurationSec, 8)
}

export function resolveSceneCountForDurationWithLimit(targetDurationSec: number, maxSceneDurationSec: number) {
  return Math.max(1, Math.ceil(targetDurationSec / Math.max(maxSceneDurationSec, 1)))
}

export function planSceneDurations(targetDurationSec: number, sceneCount: number) {
  const base = Math.floor(targetDurationSec / sceneCount)
  const remainder = targetDurationSec % sceneCount

  return Array.from({ length: sceneCount }, (_, index) => base + (index < remainder ? 1 : 0))
}

function normalizeScript(script: string) {
  return script.replace(/\s+/g, " ").trim()
}

function splitScriptIntoUnits(script: string) {
  const normalized = normalizeScript(script)
  if (!normalized) {
    return []
  }

  const sentenceUnits = normalized
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (sentenceUnits.length >= 2) {
    return sentenceUnits
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length <= 8) {
    return [normalized]
  }

  const chunkSize = Math.max(4, Math.ceil(words.length / 4))
  const chunks: string[] = []
  for (let index = 0; index < words.length; index += chunkSize) {
    chunks.push(words.slice(index, index + chunkSize).join(" "))
  }
  return chunks
}

function distributeUnits<T>(units: T[], bucketCount: number) {
  if (units.length === 0) {
    return Array.from({ length: bucketCount }, () => [] as T[])
  }

  const buckets: T[][] = Array.from({ length: bucketCount }, () => [])
  let startIndex = 0
  let remainingUnits = units.length

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const remainingBuckets = bucketCount - bucketIndex
    const takeCount = Math.ceil(remainingUnits / remainingBuckets)
    buckets[bucketIndex] = units.slice(startIndex, startIndex + takeCount)
    startIndex += takeCount
    remainingUnits -= takeCount
  }

  return buckets
}

function buildSceneTitle(sceneIndex: number, script: string) {
  const normalized = normalizeScript(script)
  if (!normalized) {
    return `Scene ${sceneIndex + 1}`
  }

  const preview = normalized.split(/\s+/).slice(0, 4).join(" ")
  return preview ? `Scene ${sceneIndex + 1}: ${preview}` : `Scene ${sceneIndex + 1}`
}

function formatTimestamp(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function buildImagePrompt(sceneScript: string, aspectRatio: string) {
  return [
    sceneScript,
    `Create a ${aspectRatio} key visual that matches this exact beat of the script.`,
    "Keep the subject, action, and emotional beat aligned with the script wording. No captions or UI elements.",
  ].join(" ")
}

function buildVideoPrompt(sceneScript: string, aspectRatio: string, durationSec: number) {
  return [
    sceneScript,
    `Generate a ${aspectRatio} short-form social video shot for this exact script beat.`,
    `Target duration: ${durationSec} seconds.`,
    "The action, visual focus, and pacing must stay faithful to the script beat.",
  ].join(" ")
}

export function mergeSceneReviewMetadata<T extends PlannedStoryboardScene & SceneReviewMetadataCarrier>(
  scenes: T[],
  existingScenes: SceneReviewMetadataCarrier[] = [],
): Array<T & SceneReviewMetadata> {
  const existingById = new Map<string, SceneReviewMetadataCarrier>()
  const existingByIndex = new Map<number, SceneReviewMetadataCarrier>()

  for (const scene of existingScenes) {
    if (typeof scene.id === "string" && scene.id.trim()) {
      existingById.set(scene.id, scene)
    }
    if (typeof scene.index === "number" && Number.isInteger(scene.index) && scene.index >= 0) {
      existingByIndex.set(scene.index, scene)
    }
  }

  return scenes.map((scene) => {
    const matchedScene =
      (typeof scene.id === "string" && scene.id.trim() ? existingById.get(scene.id) : undefined) ??
      (typeof scene.index === "number" && Number.isInteger(scene.index) && scene.index >= 0
        ? existingByIndex.get(scene.index)
        : undefined)

    if (!matchedScene) {
      return {
        ...scene,
        reviewNote: scene.reviewNote ?? null,
        reviewedAt: scene.reviewedAt ?? null,
        keyframeReviewNote: scene.keyframeReviewNote ?? null,
        keyframeReviewedAt: scene.keyframeReviewedAt ?? null,
      }
    }

    return {
      ...scene,
      reviewStatus: matchedScene.reviewStatus ?? scene.reviewStatus,
      keyframeStatus: matchedScene.keyframeStatus ?? scene.keyframeStatus,
      reviewNote: matchedScene.reviewNote ?? scene.reviewNote ?? null,
      reviewedAt: matchedScene.reviewedAt ?? scene.reviewedAt ?? null,
      keyframeReviewNote: matchedScene.keyframeReviewNote ?? scene.keyframeReviewNote ?? null,
      keyframeReviewedAt: matchedScene.keyframeReviewedAt ?? scene.keyframeReviewedAt ?? null,
    }
  })
}

export function buildStoryboardScenes(input: {
  script: string
  targetDurationSec: VideoDurationPreset
  maxSceneDurationSec?: number
  aspectRatio: string
  existingScenes?: SceneReviewMetadataCarrier[]
  reviewRequirements?: SceneReviewRequirements
}): Array<PlannedStoryboardScene & SceneReviewMetadata> {
  const sceneCount = resolveSceneCountForDurationWithLimit(input.targetDurationSec, input.maxSceneDurationSec ?? 8)
  const durations = planSceneDurations(input.targetDurationSec, sceneCount)
  const units = splitScriptIntoUnits(input.script)
  const buckets = distributeUnits(units, sceneCount)

  let cursorSec = 0

  const scenes: Array<PlannedStoryboardScene & SceneReviewMetadata> = buckets.map((bucket, index) => {
    const sceneScript = normalizeScript(bucket.join(" ")) || normalizeScript(input.script)
    const durationSec = durations[index]
    const startLabel = formatTimestamp(cursorSec)
    cursorSec += durationSec
    const endLabel = formatTimestamp(cursorSec)
    const reviewDefaults = resolveSceneReviewDefaults(index, input.reviewRequirements)

    return {
      id: `scene_${index + 1}`,
      index,
      title: buildSceneTitle(index, sceneScript),
      sceneGoal: buildSceneTitle(index, sceneScript),
      voiceoverScript: sceneScript,
      startFrameDescription: buildSceneTitle(index, sceneScript),
      script: sceneScript,
      imagePrompt: buildImagePrompt(sceneScript, input.aspectRatio),
      videoPrompt: buildVideoPrompt(sceneScript, input.aspectRatio, durationSec),
      startFrameIntent: buildSceneTitle(index, sceneScript),
      endFrameIntent: index === sceneCount - 1 ? "Close on the final scene." : `Hand off from scene ${index + 1}.`,
      durationSec,
      startLabel,
      endLabel,
      reviewStatus: reviewDefaults.reviewStatus,
      keyframeStatus: reviewDefaults.keyframeStatus,
      continuityConstraints: [],
      reviewNote: null,
      reviewedAt: null,
      keyframeReviewNote: null,
      keyframeReviewedAt: null,
    }
  })

  return mergeSceneReviewMetadata(scenes, input.existingScenes)
}
