export const VIDEO_DURATION_PRESETS = [15, 30, 45, 60] as const
export type VideoDurationPreset = (typeof VIDEO_DURATION_PRESETS)[number]

export type PlannedStoryboardScene = {
  id: string
  index: number
  title: string
  script: string
  imagePrompt: string
  videoPrompt: string
  durationSec: number
  startLabel: string
  endLabel: string
  reviewStatus: "pending" | "approved" | "rejected"
  keyframeStatus: "pending" | "approved" | "rejected"
}

export function resolveSceneCountForDuration(targetDurationSec: number) {
  if (targetDurationSec <= 15) {
    return 3
  }
  if (targetDurationSec <= 30) {
    return 5
  }
  if (targetDurationSec <= 45) {
    return 7
  }
  return 8
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

export function buildStoryboardScenes(input: {
  script: string
  targetDurationSec: VideoDurationPreset
  aspectRatio: string
}): PlannedStoryboardScene[] {
  const sceneCount = resolveSceneCountForDuration(input.targetDurationSec)
  const durations = planSceneDurations(input.targetDurationSec, sceneCount)
  const units = splitScriptIntoUnits(input.script)
  const buckets = distributeUnits(units, sceneCount)

  let cursorSec = 0

  return buckets.map((bucket, index) => {
    const sceneScript = normalizeScript(bucket.join(" ")) || normalizeScript(input.script)
    const durationSec = durations[index]
    const startLabel = formatTimestamp(cursorSec)
    cursorSec += durationSec
    const endLabel = formatTimestamp(cursorSec)

    return {
      id: `scene_${index + 1}`,
      index,
      title: buildSceneTitle(index, sceneScript),
      script: sceneScript,
      imagePrompt: buildImagePrompt(sceneScript, input.aspectRatio),
      videoPrompt: buildVideoPrompt(sceneScript, input.aspectRatio, durationSec),
      durationSec,
      startLabel,
      endLabel,
      reviewStatus: index === 0 ? "approved" : "pending",
      keyframeStatus: "pending",
    }
  })
}
