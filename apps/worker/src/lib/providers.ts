import { mkdirSync, writeFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { createDecipheriv, createHash } from "node:crypto"
import { spawn } from "node:child_process"

import axios from "axios"

import {
  buildStoryboardScenes,
  type AssetRecord,
  readTaskBlueprintRecords,
  mergeSceneReviewMetadata,
  normalizeTaskDetailRecord,
  planningSceneSchema,
  resolveSceneCountForDurationWithLimit,
  resolveSceneReviewDefaults,
  readProviderRecords,
  writeTaskBlueprintRecords,
  textPlanningOutputSchema,
  type ExecutionBlueprint,
  type PlannedExecutionBlueprint,
  type StoryboardScene,
  type SubtitleStrategy,
  type TaskBlueprintRecord,
  type TaskDetail,
  type TextPlanningOutput,
} from "@genergi/shared"
import { GENERATION_PREFERENCES, resolveVideoModelCapability } from "@genergi/config"
import { EdgeTTS } from "./edge-tts.js"
import { concatVideos, extractKeyframeFromVideo, getMediaDurationSeconds, mixNarrationWithVideoAudio, muxNarrationIntoVideo, trimVideoDuration, writeStyledAssSubtitleFile } from "./ffmpeg.js"
import { createSubtitleProvider } from "./subtitle-provider.js"

const gatewayBaseUrl = process.env.GENERGI_MEDIA_GATEWAY_BASE_URL ?? "https://open.xiaojingai.com"
const gatewayApiKey = process.env.GENERGI_MEDIA_GATEWAY_API_KEY ?? ""
const gatewayImageGenerationPaths = ["/v1/images/generations", "/v1/image/generations"]
const IMAGE_GATEWAY_REQUEST_TIMEOUT_MS = 240000
const REVIEW_REQUIRED_KEYFRAME_TIMEOUT_MS = 240000
const DEGRADABLE_KEYFRAME_TIMEOUT_MS = 240000
const DEFAULT_VIDEO_SCENE_TIMEOUT_MS = 20 * 60 * 1000
export const TASK_CANCELED_BY_OPERATOR = "TASK_CANCELED_BY_OPERATOR"

type PlanningTraceArtifact = {
  sourceScript: string
  planningPrompt: string | null
  planningResponse: string | null
  planningAudit: Record<string, unknown>
}

type StructuredPlanningAttempt = {
  output: TextPlanningOutput | null
  promptContext: string | null
  rawResponse: string | null
  parsedResponse: unknown | null
  provider: string | null
  model: string | null
  baseUrl: string | null
  wireApi?: "messages" | "chat_completions" | "responses" | null
  textModelFallbackEvents?: TextModelFallbackEvent[]
  planningError?: {
    trigger: string | null
    message: string
    provider: string | null
    model: string | null
  } | null
}

type TextPlanningRuntime = {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  providerKey?: string
  modelKey?: string
  capabilityJson: Record<string, unknown>
  fallbackTriggers?: string[]
  source: "task_snapshot" | "environment"
}

type TextModelFallbackEvent = {
  trigger: string
  fromProvider: string | null
  fromModel: string | null
  toProvider: string
  toModel: string
}

function ensureTaskDir(taskId: string) {
  const root = process.env.GENERGI_DATA_DIR ?? ".data"
  const dir = path.resolve(root, "exports", taskId)
  mkdirSync(dir, { recursive: true })
  mkdirSync(path.join(dir, "video"), { recursive: true })
  mkdirSync(path.join(dir, "keyframes"), { recursive: true })
  return dir
}

async function writeFileAtomic(filePath: string, content: Buffer | string) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tempPath, content)
  await fs.rename(tempPath, filePath)
}

function buildGatewayHeaders() {
  return {
    Authorization: `Bearer ${gatewayApiKey}`,
    "Content-Type": "application/json",
  }
}

export function resolveKeyframeGenerationTimeoutPolicy(input: {
  detail: Pick<TaskDetail, "taskRunConfig">
  continueExecution?: boolean
}) {
  const reviewGateActive =
    input.detail.taskRunConfig.executionMode === "review_required" && !input.continueExecution

  return reviewGateActive
    ? {
        timeoutMs: REVIEW_REQUIRED_KEYFRAME_TIMEOUT_MS,
        onTimeoutMessage: "Image generation timed out before review assets were ready",
      }
    : {
        timeoutMs: DEGRADABLE_KEYFRAME_TIMEOUT_MS,
        onTimeoutMessage: "Image generation timeout, switching to video-derived keyframe",
      }
}

function getModelControlMasterKey() {
  const source = process.env.GENERGI_MODEL_CONTROL_MASTER_KEY ?? "genergi-model-control-dev-key"
  return createHash("sha256").update(source).digest()
}

function decryptControlPlaneSecret(ciphertext: string) {
  const [prefix, ivEncoded, tagEncoded, payloadEncoded] = ciphertext.split(":")
  if (ciphertext && prefix !== "enc") {
    try {
      const payload = Buffer.from(ciphertext, "base64")
      if (payload.length <= 28) {
        return ciphertext
      }
      const decipher = createDecipheriv("aes-256-gcm", getModelControlMasterKey(), payload.subarray(0, 12))
      decipher.setAuthTag(payload.subarray(12, 28))
      const plaintext = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()])
      return plaintext.toString("utf8")
    } catch {
      return ciphertext
    }
  }
  if (prefix !== "enc" || !ivEncoded || !tagEncoded || !payloadEncoded) {
    throw new Error("MODEL_CONTROL_SECRET_FORMAT_INVALID")
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getModelControlMasterKey(),
    Buffer.from(ivEncoded, "base64url"),
  )
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadEncoded, "base64url")),
    decipher.final(),
  ])

  return decrypted.toString("utf8")
}

function resolveProviderConnectionFields(provider: Awaited<ReturnType<typeof readProviderRecords>>[number] | undefined) {
  const encryptedEndpoint = `${provider?.encryptedEndpoint ?? ""}`.trim()
  const encryptedSecret = `${provider?.encryptedSecret ?? ""}`.trim()

  return {
    endpointUrl: encryptedEndpoint
      ? decryptControlPlaneSecret(encryptedEndpoint).trim()
      : `${(provider as any)?.endpointUrl ?? ""}`.trim(),
    apiKey: encryptedSecret
      ? decryptControlPlaneSecret(encryptedSecret).trim()
      : `${(provider as any)?.secret ?? ""}`.trim(),
  }
}

function isRetryableGatewayStatus(status?: number | null) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function toProviderRequestError(prefix: string, error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const statusText = error.response?.statusText
    const responseError = (error.response?.data as any)?.error
    const message =
      typeof responseError?.message === "string"
        ? responseError.message
        : typeof error.response?.data === "string"
          ? error.response.data
          : error.message
    return new Error(
      `${prefix}${status ? ` (${status}${statusText ? ` ${statusText}` : ""})` : ""}: ${message}`,
    )
  }

  return error instanceof Error ? error : new Error(`${prefix}: ${String(error)}`)
}

function createTaskCanceledError(signal?: AbortSignal) {
  const reason = signal?.reason
  if (reason instanceof Error) {
    return new Error(reason.message)
  }
  if (typeof reason === "string" && reason.trim()) {
    return new Error(reason)
  }
  return new Error(TASK_CANCELED_BY_OPERATOR)
}

function throwIfTaskCanceled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createTaskCanceledError(signal)
  }
}

async function sleep(ms: number, signal?: AbortSignal) {
  throwIfTaskCanceled(signal)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(createTaskCanceledError(signal))
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length)
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex
        nextIndex += 1
        if (currentIndex >= items.length) {
          return
        }

        results[currentIndex] = await mapper(items[currentIndex], currentIndex)
      }
    }),
  )

  return results
}

function resolveSceneVideoConcurrency() {
  const raw = Number.parseInt(process.env.GENERGI_VIDEO_SCENE_CONCURRENCY ?? "4", 10)
  if (!Number.isFinite(raw) || raw <= 0) {
    return 4
  }

  return Math.min(raw, 6)
}

export function resolveSceneVideoTimeoutMs() {
  const raw = Number.parseInt(process.env.GENERGI_VIDEO_SCENE_TIMEOUT_MS ?? "", 10)
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_VIDEO_SCENE_TIMEOUT_MS
  }

  return Math.min(Math.max(raw, 60 * 1000), 60 * 60 * 1000)
}

function normalizeImageModel(model: string) {
  const normalized = (model ?? "").trim()
  if (!normalized) {
    return "gemini-3.1-flash-image-preview"
  }

  const lower = normalized.toLowerCase()
  if (lower === "image.draft") {
    return "gemini-3.1-flash-image-preview"
  }
  if (lower === "image.final") {
    return "gemini-3-pro-image-preview"
  }
  if (lower === "image.premium") {
    return "gemini-3-pro-image-preview-2k"
  }
  if (lower.includes("2k") || lower.includes("4k") || lower.includes("portrait") || lower.includes("landscape")) {
    return "gemini-3.1-flash-image-preview"
  }

  return lower
}

export function resolveProviderApiBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "")
  return trimmed.replace(/\/v1$/i, "")
}

export function normalizeVideoModel(model: string) {
  const normalized = (model ?? "").trim()
  if (!normalized) {
    return "veo3.1"
  }

  const lower = normalized.toLowerCase()
  if (lower === "video.draft") {
    return "veo3.1-fast"
  }
  if (lower === "video.final" || lower === "video.hd") {
    return "veo3.1"
  }

  return normalized
}

function extractGeminiInlineImageReference(payload: any) {
  const parts = Array.isArray(payload?.candidates?.[0]?.content?.parts)
    ? payload.candidates[0].content.parts
    : []
  const inline = parts.find((part: any) => part?.inlineData?.data)
  if (!inline?.inlineData?.data) {
    return null
  }

  return {
    b64Json: inline.inlineData.data,
    mimeType:
      typeof inline.inlineData.mimeType === "string" && inline.inlineData.mimeType.trim()
        ? inline.inlineData.mimeType
        : "image/png",
  }
}

function getProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase()
  if (normalized === "anthropic-compatible" || normalized === "anthropic-native") {
    return "Anthropic Compatible"
  }
  if (normalized === "openai-compatible") {
    return "OpenAI Compatible"
  }
  if (normalized === "edge-tts") {
    return "Edge TTS"
  }
  if (normalized === "azure-tts") {
    return "Azure TTS"
  }

  return provider
}

export type RuntimeGenerationConfig = {
  textProvider: string
  textProviderLabel: string
  textModelId: string
  textModelLabel: string
  imageProvider: string
  imageProviderLabel: string
  imageModelId: string
  imageModelLabel: string
  videoProvider: string
  videoProviderLabel: string
  videoModelId: string
  videoModelLabel: string
  ttsProvider: string
  ttsLabel: string
  subtitleStrategy: SubtitleStrategy
}

export function resolveRuntimeGenerationConfig(detail: Pick<TaskDetail, "taskRunConfig">) {
  const ttsProvider = detail.taskRunConfig.ttsProvider.trim().toLowerCase()
  if (ttsProvider !== "edge-tts") {
    throw new Error(`Unsupported TTS provider: ${detail.taskRunConfig.ttsProvider}`)
  }

  return {
    textProvider: detail.taskRunConfig.textModel.provider,
    textProviderLabel: getProviderLabel(detail.taskRunConfig.textModel.provider),
    textModelId: detail.taskRunConfig.textModel.id,
    textModelLabel: detail.taskRunConfig.textModel.label,
    imageProvider: detail.taskRunConfig.imageModel.provider,
    imageProviderLabel: getProviderLabel(detail.taskRunConfig.imageModel.provider),
    ttsProvider,
    ttsLabel: "Edge TTS",
    imageModelLabel: detail.taskRunConfig.imageModel.label,
    imageModelId: detail.taskRunConfig.imageModel.id,
    videoProvider: detail.taskRunConfig.videoModel.provider,
    videoProviderLabel: getProviderLabel(detail.taskRunConfig.videoModel.provider),
    videoModelLabel: detail.taskRunConfig.videoModel.label,
    videoModelId: detail.taskRunConfig.videoModel.id,
    subtitleStrategy: detail.taskRunConfig.subtitleStrategy ?? "tts_aligned",
  } satisfies RuntimeGenerationConfig
}

export function describeRuntimeGenerationConfig(runtime: RuntimeGenerationConfig) {
  return [
    `text=${runtime.textModelLabel} (${runtime.textModelId} via ${runtime.textProviderLabel})`,
    `image=${runtime.imageModelLabel} (${runtime.imageModelId} via ${runtime.imageProviderLabel})`,
    `video=${runtime.videoModelLabel} (${runtime.videoModelId} via ${runtime.videoProviderLabel})`,
    `tts=${runtime.ttsLabel} (${runtime.ttsProvider})`,
  ].join(" | ")
}

export function buildWorkerRuntimeLabels(
  runtime: RuntimeGenerationConfig,
  input: {
    sceneCount: number
    targetDurationSec: number
    keyframeCount: number
  },
) {
  return {
    audio: `${runtime.ttsLabel} (${runtime.ttsProvider})`,
    keyframes: `关键帧包 (${input.keyframeCount} 张 / ${runtime.imageModelLabel})`,
    video: `真实视频输出 (${input.sceneCount} scenes / ${input.targetDurationSec}s / ${runtime.videoModelLabel})`,
  }
}

function resolvePlanningModelId(runtime: RuntimeGenerationConfig) {
  const snapshotModelId = runtime.textModelId.trim()
  if (snapshotModelId && !/^text\./i.test(snapshotModelId)) {
    return snapshotModelId
  }

  const envModel = process.env.GENERGI_TEXT_MODEL?.trim()
  if (envModel) {
    return envModel
  }

  return snapshotModelId || "claude-opus-4.6"
}

export function buildKeyframePrompt(scene: StoryboardScene, _aspectRatio: string) {
  return scene.imagePrompt.trim() || scene.videoPrompt.trim() || scene.title.trim()
}

export function buildBatchKeyframePrompt(input: {
  scenes: StoryboardScene[]
  aspectRatio: string
  visualSeedInput?: string | null
}) {
  const sceneLines = input.scenes.map((scene) => {
    const prompt = buildKeyframePrompt(scene, input.aspectRatio)
    return `${scene.index + 1}. ${scene.title}: ${prompt}`
  })
  const visualSeed = input.visualSeedInput?.trim()

  return [
    `Return exactly ${input.scenes.length} distinct storyboard keyframes for one ${input.aspectRatio} vertical short video.`,
    "All images must feel like one coherent set: same primary character, same visual language, stable lighting logic, and no visible text, captions, UI, or watermark.",
    visualSeed ? `Shared visual brief: ${visualSeed}` : "Shared visual brief: infer a consistent character, setting, style, mood, and negative prompt from the scene list.",
    "Keyframes in order:",
    ...sceneLines,
  ].join("\n")
}

type CompositeGridLayout = {
  columns: number
  rows: number
  label: string
  size: string
  panelCount: number
  panelWidth: number
  panelHeight: number
  note: string
}

function parseCompositeLayout(value?: string | null) {
  const match = `${value ?? ""}`.trim().toLowerCase().match(/^(\d+)x(\d+)$/)
  if (!match) {
    return null
  }
  const columns = Number(match[1])
  const rows = Number(match[2])
  if (!Number.isFinite(columns) || !Number.isFinite(rows) || columns <= 0 || rows <= 0) {
    return null
  }
  return { columns: Math.floor(columns), rows: Math.floor(rows) }
}

function parseCompositeSize(value?: string | null) {
  const match = `${value ?? ""}`.trim().toLowerCase().match(/^(\d+)x(\d+)$/)
  if (!match) {
    return null
  }
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width: Math.floor(width), height: Math.floor(height), label: `${Math.floor(width)}x${Math.floor(height)}` }
}

export function resolveCompositeGridLayout(frameCount: number, aspectRatio = "9:16", overrides: {
  layout?: string | null
  size?: string | null
} = {}): CompositeGridLayout {
  const requestedCount = Math.max(1, Math.floor(frameCount))
  const explicitLayout = parseCompositeLayout(overrides.layout)
  const explicitSize = parseCompositeSize(overrides.size)
  const vertical = aspectRatio.includes("9:16") || aspectRatio.includes("vertical")

  let columns: number
  let rows: number
  let size = explicitSize?.label
  let note = "auto"

  if (explicitLayout) {
    columns = explicitLayout.columns
    rows = explicitLayout.rows
    note = "configured"
  } else if (requestedCount === 1) {
    columns = 1
    rows = 1
    size = size ?? "1024x1792"
    note = "single 15s keyframe, no grid needed"
  } else if (requestedCount === 2) {
    columns = 2
    rows = 1
    size = size ?? "2048x2048"
    note = "two vertical panels from a 2K square grid"
  } else if (requestedCount === 3 && vertical) {
    columns = 3
    rows = 1
    size = size ?? "3072x2048"
    note = "45s/3-keyframe layout: three side-by-side panels, no wasted fourth slot"
  } else if (requestedCount <= 4) {
    columns = 2
    rows = 2
    size = size ?? "2048x3072"
    note = "four portrait panels from a 2K portrait grid"
  } else if (requestedCount <= 6) {
    columns = 3
    rows = 2
    size = size ?? "3072x2048"
    note = "six-panel balanced grid"
  } else {
    columns = 3
    rows = 3
    size = size ?? "2048x2048"
    note = "nine-panel fallback; panel resolution is lower than four-panel mode"
  }

  const parsedSize = explicitSize ?? parseCompositeSize(size) ?? { width: 2048, height: 2048, label: "2048x2048" }
  const panelCount = columns * rows
  return {
    columns,
    rows,
    label: `${columns}x${rows}`,
    size: parsedSize.label,
    panelCount,
    panelWidth: Math.floor(parsedSize.width / columns),
    panelHeight: Math.floor(parsedSize.height / rows),
    note,
  }
}

export function buildCompositeGridKeyframePrompt(input: {
  scenes: StoryboardScene[]
  aspectRatio: string
  visualSeedInput?: string | null
  layout: CompositeGridLayout
}) {
  const sceneLines = input.scenes.map((scene) => {
    const prompt = buildKeyframePrompt(scene, input.aspectRatio)
    return `${scene.index + 1}. Panel ${scene.index + 1}: ${scene.title}: ${prompt}`
  })
  const visualSeed = input.visualSeedInput?.trim()

  return [
    `Create one single ${input.layout.label} composite storyboard grid containing exactly ${input.scenes.length} ordered panels for one ${input.aspectRatio} short video.`,
    `Use a clean single ${input.layout.label} composite storyboard grid with equal-size panels, thin straight gutters, and no extra panels.`,
    `The requested canvas is ${input.layout.size}; each panel should read as an independent keyframe after cropping.`,
    "All panels must share the same primary character, outfit, visual language, and lighting logic.",
    "Do not merge panels into one scene. Do not use captions, readable text, UI, logos, or watermark.",
    visualSeed ? `Shared visual brief: ${visualSeed}` : "Shared visual brief: infer a consistent character, setting, style, mood, and negative prompt from the scene list.",
    "Panel order is left-to-right, top-to-bottom:",
    ...sceneLines,
  ].join("\n")
}

type KeyframePromptSource = "executionBrief.keyframePlan" | "scene.imagePrompt"

function hashShort(value: unknown) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex")
    .slice(0, 16)
}

function resolveExecutionBriefKeyframe(detail: TaskDetail, scene: StoryboardScene) {
  const executionBrief = detail.taskRunConfig.executionBrief
  if (!executionBrief?.keyframePlan?.length) {
    return null
  }

  return (
    executionBrief.keyframePlan.find((plan) => plan.index === scene.index + 1) ??
    executionBrief.keyframePlan.find((plan) => plan.index === scene.index) ??
    executionBrief.keyframePlan[scene.index] ??
    null
  )
}

function resolveSceneKeyframePrompt(input: {
  detail: TaskDetail
  scene: StoryboardScene
  aspectRatio: string
}) {
  const keyframe = resolveExecutionBriefKeyframe(input.detail, input.scene)
  if (!keyframe) {
    return {
      prompt: buildKeyframePrompt(input.scene, input.aspectRatio),
      promptSource: "scene.imagePrompt" as const,
      keyframePlan: null,
    }
  }

  return {
    prompt: keyframe.imagePrompt,
    promptSource: "executionBrief.keyframePlan" as const,
    keyframePlan: keyframe,
  }
}

function buildPromptReadyScene(scene: StoryboardScene, prompt: string, visualGoal?: string) {
  return {
    ...scene,
    title: visualGoal || scene.title,
    sceneGoal: visualGoal || scene.sceneGoal,
    startFrameDescription: visualGoal || scene.startFrameDescription,
    imagePrompt: prompt,
    startFrameIntent: visualGoal || scene.startFrameIntent,
  }
}

async function runFfmpegCrop(input: {
  sourcePath: string
  outputPath: string
  x: number
  y: number
  width: number
  height: number
  signal?: AbortSignal
}) {
  throwIfTaskCanceled(input.signal)
  const ffmpegPath = process.env.GENERGI_FFMPEG_PATH || "ffmpeg"
  await new Promise<void>((resolve, reject) => {
    const process = spawn(
      ffmpegPath,
      [
        "-y",
        "-i",
        input.sourcePath,
        "-vf",
        `crop=${input.width}:${input.height}:${input.x}:${input.y}`,
        input.outputPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    )

    let stderr = ""
    process.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    process.on("error", reject)
    process.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`ffmpeg grid crop exited with code ${code}: ${stderr}`))
    })
    input.signal?.addEventListener("abort", () => {
      process.kill("SIGTERM")
      reject(createTaskCanceledError(input.signal))
    }, { once: true })
  })
}

export async function splitCompositeGridArtifact(input: {
  artifact: {
    bytes: Buffer
    extension: string
    generationId: string | null
  }
  scenes: StoryboardScene[]
  layout: CompositeGridLayout
  workDir: string
  signal?: AbortSignal
}) {
  const sourceExtension = input.artifact.extension || "png"
  const sourceId = hashShort(input.artifact.generationId ?? `${Date.now()}`)
  const sourcePath = path.join(input.workDir, `composite-grid-master-${sourceId}.${sourceExtension}`)
  await writeFileAtomic(sourcePath, input.artifact.bytes)
  const sourceFileName = path.basename(sourcePath)

  const panels: Array<{
    scene: StoryboardScene
    bytes: Buffer
    extension: string
    generationId: string | null
    batchIndex: number
    cropSourceFileName: string
    cropPanelRect: { x: number; y: number; width: number; height: number }
  }> = []

  for (let index = 0; index < input.scenes.length; index += 1) {
    throwIfTaskCanceled(input.signal)
    const scene = input.scenes[index]
    if (!scene) {
      continue
    }
    const column = index % input.layout.columns
    const row = Math.floor(index / input.layout.columns)
    const cropPanelRect = {
      x: column * input.layout.panelWidth,
      y: row * input.layout.panelHeight,
      width: input.layout.panelWidth,
      height: input.layout.panelHeight,
    }
    const panelPath = path.join(input.workDir, `composite-panel-${String(index + 1).padStart(2, "0")}.png`)
    await runFfmpegCrop({
      sourcePath,
      outputPath: panelPath,
      ...cropPanelRect,
      signal: input.signal,
    })
    panels.push({
      scene,
      bytes: await fs.readFile(panelPath),
      extension: "png",
      generationId: input.artifact.generationId ? `${input.artifact.generationId}:panel-${index + 1}` : null,
      batchIndex: index,
      cropSourceFileName: sourceFileName,
      cropPanelRect,
    })
  }

  return panels
}

function normalizeTransitionHint(index: number, total: number, fallback?: string) {
  if (fallback?.trim()) {
    return fallback.trim()
  }

  if (index === 0) {
    return "open"
  }

  if (index === total - 1) {
    return "close"
  }

  return "cut"
}

function buildConsistencyAnchorText(input: {
  subjectProfile: string
  productProfile: string
  backgroundConstraints: string[]
  negativeConstraints: string[]
  continuityConstraints: string[]
}) {
  const lines = [
    `subject anchor: ${input.subjectProfile}`,
    `content anchor: ${input.productProfile}`,
    `background anchor: ${input.backgroundConstraints.length ? input.backgroundConstraints.join(" / ") : "keep one stable environment"}`,
    `negative constraints: ${input.negativeConstraints.length ? input.negativeConstraints.join(" / ") : "none"}`,
  ]

  if (input.continuityConstraints.length) {
    lines.push(`continuity constraints: ${input.continuityConstraints.join(" / ")}`)
  }

  return lines.join(". ")
}

function buildSourceAnchoredImagePrompt(input: {
  sceneScript: string
  aspectRatio: string
  sceneGoal: string
  startFrameDescription: string
  startFrameIntent: string
  continuityConstraints: string[]
}) {
  return [
    input.sceneScript,
    `Scene goal: ${input.sceneGoal}.`,
    `Start frame: ${input.startFrameDescription}.`,
    `Opening intent: ${input.startFrameIntent}.`,
    `Create a ${input.aspectRatio} key visual that matches this exact beat of the source script.`,
    input.continuityConstraints.length
      ? `Continuity constraints: ${input.continuityConstraints.join(" / ")}.`
      : "Preserve the same primary subject and setting unless the source script explicitly changes them.",
    "Keep the subject, action, and emotional beat aligned with the source wording. No captions or UI elements.",
  ].join(" ")
}

function buildSourceAnchoredVideoPrompt(input: {
  sceneScript: string
  aspectRatio: string
  durationSec: number
  sceneGoal: string
  startFrameDescription: string
  startFrameIntent: string
  endFrameIntent: string
  continuityConstraints: string[]
}) {
  return [
    input.sceneScript,
    `Scene goal: ${input.sceneGoal}.`,
    `Start frame: ${input.startFrameDescription}.`,
    `Opening intent: ${input.startFrameIntent}.`,
    `Ending intent: ${input.endFrameIntent}.`,
    `Generate a ${input.aspectRatio} short-form social video shot for this exact beat of the source script.`,
    `Target duration: ${input.durationSec} seconds.`,
    input.continuityConstraints.length
      ? `Continuity constraints: ${input.continuityConstraints.join(" / ")}.`
      : "Preserve the same primary subject and setting unless the source script explicitly changes them.",
    "The action, visual focus, and pacing must stay faithful to the source beat.",
  ].join(" ")
}

function parseSceneDurationValue(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }

  if (typeof value === "string") {
    const match = value.match(/(\d+(?:\.\d+)?)/)
    if (match?.[1]) {
      const parsed = Number.parseFloat(match[1])
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.round(parsed)
      }
    }
  }

  return fallback
}

export function buildCanonicalScenePlanFromBaseScenes(
  scenes: StoryboardScene[],
  planned: TextPlanningOutput,
) {
  const aspectRatio = planned.blueprint.renderSpec.aspectRatio
  return scenes.map((scene, index, allScenes) => {
    const plannedScene = planned.scenePlan[index]
    const sceneGoal = plannedScene?.scenePurpose?.trim() || scene.sceneGoal || scene.title
    const script =
      plannedScene?.script?.trim() ||
      plannedScene?.voiceoverScript?.trim() ||
      scene.script
    const voiceoverScript =
      plannedScene?.voiceoverScript?.trim() ||
      plannedScene?.script?.trim() ||
      scene.voiceoverScript ||
      scene.script
    const startFrameDescription =
      plannedScene?.startFrameDescription?.trim() ||
      scene.startFrameDescription ||
      sceneGoal
    const startFrameIntent =
      plannedScene?.startFrameIntent?.trim() || scene.startFrameIntent || sceneGoal
    const endFrameIntent =
      plannedScene?.endFrameIntent?.trim() ||
      scene.endFrameIntent ||
      (index === allScenes.length - 1 ? "Close on the final scene." : `Hand off from scene ${index + 1}.`)
    const continuityConstraints =
      plannedScene?.continuityConstraints?.length
        ? plannedScene.continuityConstraints
        : scene.continuityConstraints ?? []
    const durationSec = plannedScene?.durationSec ?? scene.durationSec
    return {
      sceneIndex: scene.index,
      scenePurpose: sceneGoal,
      durationSec,
      script,
      voiceoverScript,
      startFrameDescription,
      imagePrompt:
        plannedScene?.imagePrompt?.trim() ||
        buildSourceAnchoredImagePrompt({
          sceneScript: script,
          aspectRatio,
          sceneGoal,
          startFrameDescription,
          startFrameIntent,
          continuityConstraints,
        }),
      videoPrompt:
        plannedScene?.videoPrompt?.trim() ||
        buildSourceAnchoredVideoPrompt({
          sceneScript: script,
          aspectRatio,
          durationSec,
          sceneGoal,
          startFrameDescription,
          startFrameIntent,
          endFrameIntent,
          continuityConstraints,
        }),
      startFrameIntent,
      endFrameIntent,
      transitionHint: normalizeTransitionHint(index, allScenes.length, plannedScene?.transitionHint),
      continuityConstraints,
    }
  })
}

export function applyModelPlanningOutput(detail: TaskDetail, planned: TextPlanningOutput): {
  detail: TaskDetail
  blueprint: PlannedExecutionBlueprint
  planned: TextPlanningOutput
} {
  const sourceScript = detail.script
  const baseDetail = alignDetailScenes(detail, sourceScript)
  const canonicalScenePlan = buildCanonicalScenePlanFromBaseScenes(baseDetail.scenes, planned)
  const finalVoiceoverScript = planned.finalVoiceoverScript.trim() || sourceScript
  const ctaLine = planned.ctaLine.trim() || canonicalScenePlan.at(-1)?.voiceoverScript || finalVoiceoverScript
  const canonicalPlanned: TextPlanningOutput = {
    ...planned,
    finalVoiceoverScript,
    ctaLine,
    scenePlan: canonicalScenePlan,
    blueprint: {
      ...planned.blueprint,
      totalVoiceoverScript: finalVoiceoverScript,
    },
  }
  const blueprint = buildPlannedExecutionBlueprint(baseDetail, canonicalPlanned)
  const normalizedScenes = buildScenesFromBlueprint(baseDetail, blueprint)

  return {
    detail: {
      ...baseDetail,
      script: finalVoiceoverScript,
      blueprintVersion: baseDetail.blueprintVersion > 0 ? baseDetail.blueprintVersion : 1,
      blueprintStatus: baseDetail.blueprintStatus,
      taskRunConfig: {
        ...baseDetail.taskRunConfig,
        blueprintVersion: baseDetail.taskRunConfig.blueprintVersion > 0 ? baseDetail.taskRunConfig.blueprintVersion : 1,
        blueprintStatus: baseDetail.taskRunConfig.blueprintStatus,
      },
      visualStyleGuide: canonicalPlanned.visualStyleGuide,
      ctaLine: canonicalPlanned.ctaLine,
      scenes: normalizedScenes,
      updatedAt: new Date().toISOString(),
    },
    blueprint,
    planned: canonicalPlanned,
  }
}

export function buildPlannedExecutionBlueprint(
  detail: TaskDetail,
  planned: TextPlanningOutput,
): PlannedExecutionBlueprint {
  const bilingualUnderstandingPreview =
    planned.bilingualUnderstandingPreview ??
    planned.blueprint.bilingualUnderstandingPreview ??
    detail.taskRunConfig.understandingPreview ??
    null
  const englishExecutionBrief =
    planned.englishExecutionBrief ??
    planned.blueprint.englishExecutionBrief ??
    detail.taskRunConfig.executionBrief ??
    null
  const sceneContracts = planned.scenePlan.map((scene, index, allScenes) => {
    const keyframePlan =
      englishExecutionBrief?.keyframePlan.find((plan) => plan.index === index + 1) ??
      englishExecutionBrief?.keyframePlan.find((plan) => plan.index === index) ??
      englishExecutionBrief?.keyframePlan[index] ??
      null
    const visualGoal = keyframePlan?.visualGoal
    return {
      id: `scene_${index + 1}`,
      index,
      sceneGoal: keyframePlan?.narrativeRole || scene.scenePurpose,
      voiceoverScript: scene.voiceoverScript,
      startFrameDescription: visualGoal || scene.startFrameDescription,
      imagePrompt: keyframePlan?.imagePrompt || scene.imagePrompt,
      videoPrompt: keyframePlan?.videoPrompt || scene.videoPrompt,
      startFrameIntent: visualGoal || scene.startFrameIntent,
      endFrameIntent: visualGoal || scene.endFrameIntent,
      durationSec: scene.durationSec,
      transitionHint: normalizeTransitionHint(index, allScenes.length, scene.transitionHint),
      continuityConstraints: scene.continuityConstraints ?? [],
    }
  })

  return {
    executionMode: detail.taskRunConfig.executionMode,
    renderSpec: detail.taskRunConfig.renderSpecJson,
    globalTheme: detail.title,
    visualStyleGuide: planned.blueprint.visualStyleGuide,
    bilingualUnderstandingPreview,
    englishExecutionBrief,
    subjectProfile: planned.blueprint.subjectProfile,
    productProfile: planned.blueprint.productProfile,
    backgroundConstraints: planned.blueprint.backgroundConstraints,
    negativeConstraints: planned.blueprint.negativeConstraints,
    visualPlan: planned.blueprint.visualPlan ?? {
      sourceBrief: detail.taskRunConfig.visualSeedInput,
      keyframeCount: detail.taskRunConfig.keyframeCount,
      generationMode: detail.taskRunConfig.keyframeGenerationMode,
      characterConsistency: true,
      subjectProfile: planned.blueprint.subjectProfile,
      setting: planned.blueprint.backgroundConstraints.length
        ? planned.blueprint.backgroundConstraints.join(" / ")
        : "A visually coherent environment inferred from the script.",
      style: planned.blueprint.visualStyleGuide,
      mood: planned.visualStyleGuide,
      negativePrompt: planned.blueprint.negativeConstraints.length
        ? planned.blueprint.negativeConstraints.join(" / ")
        : "No captions, no UI, no watermark, no distorted hands, no inconsistent faces.",
      continuityRules: [
        "Keep the same primary subject identity across all keyframes unless the script explicitly changes it.",
        ...planned.blueprint.backgroundConstraints,
      ],
    },
    totalVoiceoverScript: planned.finalVoiceoverScript,
    sceneContracts,
  }
}

export function buildScenesFromBlueprint(detail: TaskDetail, blueprint: PlannedExecutionBlueprint): StoryboardScene[] {
  let cursorSec = 0

  const rebuilt = blueprint.sceneContracts.map((scene, index) => {
    const startLabel = `${String(Math.floor(cursorSec / 60)).padStart(2, "0")}:${String(cursorSec % 60).padStart(2, "0")}`
    cursorSec += scene.durationSec
    const endLabel = `${String(Math.floor(cursorSec / 60)).padStart(2, "0")}:${String(cursorSec % 60).padStart(2, "0")}`
    const defaults = resolveSceneReviewDefaults(index, {
      requireStoryboardReview: detail.taskRunConfig.requireStoryboardReview,
      requireKeyframeReview: detail.taskRunConfig.requireKeyframeReview,
    })

    return {
      id: scene.id,
      index,
      title: scene.sceneGoal,
      sceneGoal: scene.sceneGoal,
      voiceoverScript: scene.voiceoverScript,
      startFrameDescription: scene.startFrameDescription,
      script: scene.voiceoverScript,
      imagePrompt: scene.imagePrompt,
      videoPrompt: scene.videoPrompt,
      startFrameIntent: scene.startFrameIntent,
      endFrameIntent: scene.endFrameIntent,
      durationSec: scene.durationSec,
      startLabel,
      endLabel,
      reviewStatus: defaults.reviewStatus,
      keyframeStatus: defaults.keyframeStatus,
      continuityConstraints: scene.continuityConstraints ?? [],
      reviewNote: null,
      reviewedAt: null,
      keyframeReviewNote: null,
      keyframeReviewedAt: null,
    } satisfies StoryboardScene
  })

  return mergeSceneReviewMetadata(rebuilt, detail.scenes)
}

export async function getCurrentTaskBlueprintRecord(taskId: string): Promise<TaskBlueprintRecord | null> {
  const records = await readTaskBlueprintRecords()
  return (records[taskId] ?? []).slice().sort((left, right) => left.version - right.version).at(-1) ?? null
}

export async function readKeyframeBundleSnapshot(manifestPath?: string | null) {
  if (!manifestPath) {
    return null
  }

  try {
    const rawManifest = await fs.readFile(manifestPath, "utf8")
    const manifest = JSON.parse(rawManifest) as {
      sceneCount?: number
      frames?: unknown[]
    }
    const frameCount =
      typeof manifest.sceneCount === "number"
        ? manifest.sceneCount
        : Array.isArray(manifest.frames)
          ? manifest.frames.length
          : 0

    return {
      keyframeDir: path.dirname(manifestPath),
      manifestPath,
      frameCount,
    }
  } catch {
    return null
  }
}

export async function upsertTaskBlueprintSnapshot(input: {
  detail: TaskDetail
  blueprint: PlannedExecutionBlueprint
  status: TaskBlueprintRecord["status"]
  keyframeManifestPath?: string | null
}): Promise<TaskBlueprintRecord> {
  const records = await readTaskBlueprintRecords()
  const currentRecords = records[input.detail.taskId] ?? []
  const version = input.detail.blueprintVersion > 0 ? input.detail.blueprintVersion : 1
  const existing = currentRecords.find((record) => record.version === version)
  const updatedAt = new Date().toISOString()
  const nextRecord: TaskBlueprintRecord = {
    taskId: input.detail.taskId,
    version,
    status: input.status,
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt,
    blueprint: {
      taskId: input.detail.taskId,
      projectId: input.detail.projectId,
      version,
      createdAt: existing?.blueprint.createdAt ?? updatedAt,
      ...input.blueprint,
    },
    keyframeManifestPath: input.keyframeManifestPath ?? existing?.keyframeManifestPath ?? null,
  }

  records[input.detail.taskId] = [...currentRecords.filter((record) => record.version !== version), nextRecord]
    .sort((left, right) => left.version - right.version)
  await writeTaskBlueprintRecords(records)
  return nextRecord
}

export type SceneVideoGenerationInput = {
  scene: StoryboardScene
  keyframePath: string | null
  inputStrategy: "keyframe_plus_prompt" | "prompt_only"
}

export async function buildSceneVideoGenerationInputs(input: {
  detail: TaskDetail
  blueprintRecord: TaskBlueprintRecord | null
}): Promise<SceneVideoGenerationInput[]> {
  if (!input.blueprintRecord?.keyframeManifestPath) {
    return input.detail.scenes.map((scene) => ({
      scene,
      keyframePath: null,
      inputStrategy: "prompt_only",
    }))
  }

  try {
    const manifestRaw = await fs.readFile(input.blueprintRecord.keyframeManifestPath, "utf8")
    const manifest = JSON.parse(manifestRaw) as {
      frames?: Array<{ sceneId?: string; sceneIndex?: number; filePath?: string }>
    }
    return input.detail.scenes.map((scene) => {
      const frame =
        manifest.frames?.find((item) => item.sceneId === scene.id) ??
        manifest.frames?.find((item) => item.sceneIndex === scene.index) ??
        null

      if (frame?.filePath) {
        return {
          scene,
          keyframePath: frame.filePath,
          inputStrategy: "keyframe_plus_prompt",
        }
      }

      return {
        scene,
        keyframePath: null,
        inputStrategy: "prompt_only",
      }
    })
  } catch {
    return input.detail.scenes.map((scene) => ({
      scene,
      keyframePath: null,
      inputStrategy: "prompt_only",
    }))
  }
}

function extractGenerationId(payload: any) {
  const id =
    payload?.task_id ||
    payload?.id ||
    payload?.data?.task_id ||
    payload?.data?.id ||
    payload?.data?.data?.task_id ||
    payload?.data?.data?.id ||
    null
  return id === null || id === undefined ? null : String(id)
}

function extractGenerationStatus(payload: any) {
  return `${payload?.status || payload?.data?.status || payload?.data?.data?.status || ""}`.toLowerCase()
}

function extractImageReferences(payload: any) {
  const candidates = [payload, payload?.data, payload?.data?.data, payload?.result, payload?.data?.result]
  const references: Array<{ url: string | null; b64Json: string | null; mimeType: string | null }> = []

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const items = Array.isArray(candidate) ? candidate : [candidate]
    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue
      }

      const url =
        typeof item.url === "string"
          ? item.url
          : typeof item.image_url === "string"
            ? item.image_url
            : typeof item.result_url === "string"
              ? item.result_url
              : typeof item.output_url === "string"
                ? item.output_url
                : null
      const b64Json =
        typeof item.b64_json === "string"
          ? item.b64_json
          : typeof item.base64 === "string"
            ? item.base64
            : null
      const mimeType =
        typeof item.mime_type === "string"
          ? item.mime_type
          : typeof item.mimeType === "string"
            ? item.mimeType
            : null

      if (url || b64Json) {
        references.push({ url, b64Json, mimeType })
      }
    }

    if (references.length) {
      return references
    }
  }

  return []
}

function extractImageReference(payload: any) {
  const references = extractImageReferences(payload)
  if (references[0]) {
    return references[0]
  }

  return null
}

function inferImageExtension(contentType: string | null | undefined, fallbackUrl?: string | null) {
  const normalizedContentType = `${contentType ?? ""}`.toLowerCase()
  if (normalizedContentType.includes("jpeg") || normalizedContentType.includes("jpg")) {
    return "jpg"
  }
  if (normalizedContentType.includes("webp")) {
    return "webp"
  }
  if (normalizedContentType.includes("gif")) {
    return "gif"
  }
  if (normalizedContentType.includes("png")) {
    return "png"
  }

  if (fallbackUrl) {
    try {
      const ext = path.extname(new URL(fallbackUrl).pathname).replace(/^\./, "").toLowerCase()
      if (ext === "jpeg") {
        return "jpg"
      }
      if (["png", "jpg", "webp", "gif"].includes(ext)) {
        return ext
      }
    } catch {
      // Ignore invalid URLs and fall through to the default extension.
    }
  }

  return "png"
}

async function resolveImageBytes(reference: { url: string | null; b64Json: string | null; mimeType: string | null }) {
  const dataUrlPrefix = "data:image/"

  if (reference.url?.startsWith(dataUrlPrefix)) {
    const commaIndex = reference.url.indexOf(",")
    const header = reference.url.slice(0, commaIndex)
    const body = reference.url.slice(commaIndex + 1)
    const mimeType = header.slice("data:".length, header.indexOf(";")) || "image/png"
    return {
      bytes: Buffer.from(body, "base64"),
      extension: inferImageExtension(mimeType),
    }
  }

  if (reference.b64Json) {
    const b64 = reference.b64Json.startsWith(dataUrlPrefix)
      ? reference.b64Json.slice(reference.b64Json.indexOf(",") + 1)
      : reference.b64Json
    return {
      bytes: Buffer.from(b64, "base64"),
      extension: inferImageExtension(reference.mimeType ?? "image/png"),
    }
  }

  if (!reference.url) {
    throw new Error("Image generation did not return a URL or base64 payload")
  }

  const download = await axios.get<ArrayBuffer>(reference.url, {
    responseType: "arraybuffer",
    timeout: 300000,
  })

  const contentType = `${download.headers["content-type"] ?? reference.mimeType ?? ""}` || null
  return {
    bytes: Buffer.from(download.data),
    extension: inferImageExtension(contentType, reference.url),
  }
}

async function requestGatewayImageGeneration(input: {
  model: string
  prompt: string
  size: string
  signal?: AbortSignal
}) {
  if (!gatewayApiKey) {
    throw new Error("GENERGI_MEDIA_GATEWAY_API_KEY is missing")
  }

  const payload = {
    model: input.model,
    prompt: input.prompt,
    n: 1,
    size: input.size,
    aspect_ratio: input.size,
    response_format: "b64_json",
  }

  let lastError: unknown = null
  for (const endpoint of gatewayImageGenerationPaths) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        throwIfTaskCanceled(input.signal)
        const response = await axios.post(`${gatewayBaseUrl}${endpoint}`, payload, {
          headers: buildGatewayHeaders(),
          timeout: IMAGE_GATEWAY_REQUEST_TIMEOUT_MS,
          signal: input.signal,
        })
        return { endpoint, data: response.data }
      } catch (error) {
        if (input.signal?.aborted || (axios.isAxiosError(error) && error.code === "ERR_CANCELED")) {
          throw createTaskCanceledError(input.signal)
        }
        lastError = error
        const status = axios.isAxiosError(error) ? error.response?.status : null
        if (status === 404 || status === 405) {
          break
        }
        if (isRetryableGatewayStatus(status) && attempt < 3) {
          await sleep(1500 * attempt, input.signal)
          continue
        }
        throw error
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Image generation failed for all gateway endpoints: ${String(lastError)}`)
}

async function pollGatewayImageGeneration(endpoint: string, generationId: string, signal?: AbortSignal) {
  const deadline = Date.now() + 15 * 60 * 1000
  while (Date.now() < deadline) {
    await sleep(5000, signal)
    const response = await axios.get(`${gatewayBaseUrl}${endpoint}/${generationId}`, {
      headers: {
        Authorization: `Bearer ${gatewayApiKey}`,
      },
      timeout: IMAGE_GATEWAY_REQUEST_TIMEOUT_MS,
      signal,
    })
    const ref = extractImageReference(response.data)
    if (ref) {
      return { data: response.data, reference: ref }
    }

    const status = extractGenerationStatus(response.data)
    if (status === "failed" || status === "error" || status === "canceled" || status === "cancelled") {
      throw new Error(`Image generation failed: ${JSON.stringify(response.data)}`)
    }
  }

  throw new Error(`Image generation polling timed out for task ${generationId}`)
}

async function createGatewayImageArtifact(input: { model: string; prompt: string; size: string; signal?: AbortSignal }) {
  const createResponse = await requestGatewayImageGeneration(input)
  const payload = createResponse.data

  let reference = extractImageReference(payload)
  const generationId = extractGenerationId(payload)

  if (!reference && generationId) {
    const polled = await pollGatewayImageGeneration(createResponse.endpoint, generationId, input.signal)
    reference = polled.reference
  }

  if (!reference) {
    throw new Error(`Image generation did not return image data: ${JSON.stringify(payload)}`)
  }

  return {
    ...await resolveImageBytes(reference),
    generationId,
  }
}

type GeminiNativeImageRuntime = {
  kind: "gemini-native"
  baseUrl: string
  apiKey: string
  providerId: string
  providerKey: string
  providerModelId: string
  model: string
}

async function resolveTextPlanningRuntime(detail: TaskDetail, runtime: RuntimeGenerationConfig): Promise<TextPlanningRuntime> {
  const slotSnapshots = detail.taskRunConfig.slotSnapshots ?? []
  const textSnapshot =
    slotSnapshots.find((slot) =>
      slot.slotType === "textModel" &&
      (slot.modelKey === runtime.textModelId ||
        slot.modelId === runtime.textModelId ||
        slot.providerModelId === runtime.textModelId),
    ) ?? slotSnapshots.find((slot) => slot.slotType === "textModel")

  if (textSnapshot) {
    const providers = await readProviderRecords()
    const provider = providers.find((item) => item.id === textSnapshot.providerId)
    const connection = resolveProviderConnectionFields(provider)
    if (!provider || !connection.endpointUrl || !connection.apiKey) {
      throw new Error(`TEXT_PROVIDER_CONNECTION_MISSING_FOR_SNAPSHOT: ${textSnapshot.providerKey}`)
    }

    return {
      provider: textSnapshot.providerType.trim().toLowerCase(),
      apiKey: connection.apiKey,
      baseUrl: resolveProviderApiBaseUrl(connection.endpointUrl),
      model: textSnapshot.providerModelId,
      providerKey: textSnapshot.providerKey,
      modelKey: textSnapshot.modelKey,
      capabilityJson: textSnapshot.capabilityJson ?? {},
      fallbackTriggers: [],
      source: "task_snapshot" as const,
    }
  }

  return {
    provider: runtime.textProvider.trim().toLowerCase(),
    apiKey: process.env.GENERGI_TEXT_API_KEY ?? "",
    baseUrl: resolveProviderApiBaseUrl(process.env.GENERGI_TEXT_BASE_URL ?? ""),
    model: resolvePlanningModelId(runtime),
    providerKey: undefined,
    modelKey: runtime.textModelId,
    capabilityJson: {},
    fallbackTriggers: [],
    source: "environment" as const,
  }
}

async function resolveTextPlanningFallbackRuntimes(detail: TaskDetail): Promise<TextPlanningRuntime[]> {
  const textSnapshot = (detail.taskRunConfig.slotSnapshots ?? []).find((slot) => slot.slotType === "textModel")
  const fallbackCandidates = textSnapshot?.fallbackCandidates ?? []
  if (!fallbackCandidates.length) {
    return []
  }

  const providers = await readProviderRecords()
  const runtimes: TextPlanningRuntime[] = []
  for (const candidate of fallbackCandidates) {
    const provider = providers.find((item) => item.id === candidate.providerId)
    const connection = resolveProviderConnectionFields(provider)
    if (!provider || !connection.endpointUrl || !connection.apiKey) {
      continue
    }

    runtimes.push({
      provider: candidate.providerType.trim().toLowerCase(),
      apiKey: connection.apiKey,
      baseUrl: resolveProviderApiBaseUrl(connection.endpointUrl),
      model: candidate.providerModelId,
      providerKey: candidate.providerKey,
      modelKey: candidate.modelKey,
      capabilityJson: candidate.capabilityJson ?? {},
      fallbackTriggers: candidate.fallbackTriggers ?? [],
      source: "task_snapshot",
    })
  }

  return runtimes
}

type OpenAIChatImageRuntime = {
  kind: "openai-chat-image"
  baseUrl: string
  apiKey: string
  providerId: string
  providerKey: string
  providerModelId: string
  model: string
}

type OpenAIImagesGenerationRuntime = {
  kind: "openai-images-generation"
  baseUrl: string
  apiKey: string
  providerId: string
  providerKey: string
  providerModelId: string
  model: string
  quality?: string
  responseFormat?: string
  maxBatchImages?: number
  batchReturnMode?: "api_multi_image" | "composite_grid"
  compositeGridSize?: string
  compositeGridLayout?: string
}

type GatewayImageRuntime = {
  kind: "gateway"
  model: string
}

type ImageGenerationRuntime =
  | GeminiNativeImageRuntime
  | OpenAIChatImageRuntime
  | OpenAIImagesGenerationRuntime
  | GatewayImageRuntime

type OpenAIImagesFallbackRuntime = OpenAIImagesGenerationRuntime & {
  fallbackTriggers: string[]
}

export async function resolveImageGenerationRuntime(
  detail: TaskDetail,
  model: string,
): Promise<ImageGenerationRuntime> {
  const slotSnapshots = detail.taskRunConfig.slotSnapshots ?? []
  const imageSnapshot =
    slotSnapshots.find((slot) => slot.slotType === "imageModel" && (slot.modelKey === model || slot.modelId === model || slot.providerModelId === model)) ??
    slotSnapshots.find((slot) => slot.slotType === "imageModel")

  const transport = `${imageSnapshot?.capabilityJson?.imageTransport ?? ""}`.trim().toLowerCase()
  if (imageSnapshot && transport === "gemini-generate-content") {
    const providers = await readProviderRecords()
    const provider = providers.find((item) => item.id === imageSnapshot.providerId)
    const connection = resolveProviderConnectionFields(provider)
    if (!provider || !connection.endpointUrl || !connection.apiKey) {
      throw new Error(`Gemini-native image provider is incomplete for ${imageSnapshot.providerKey}`)
    }

    return {
      kind: "gemini-native",
      baseUrl: resolveProviderApiBaseUrl(connection.endpointUrl),
      apiKey: connection.apiKey,
      providerId: provider.id,
      providerKey: provider.providerKey,
      providerModelId: imageSnapshot.providerModelId,
      model: imageSnapshot.modelKey,
    }
  }

  if (imageSnapshot && transport === "openai-chat-completions") {
    const providers = await readProviderRecords()
    const provider = providers.find((item) => item.id === imageSnapshot.providerId)
    const connection = resolveProviderConnectionFields(provider)
    if (!provider || !connection.endpointUrl || !connection.apiKey) {
      throw new Error(`OpenAI chat image provider is incomplete for ${imageSnapshot.providerKey}`)
    }

    return {
      kind: "openai-chat-image",
      baseUrl: resolveProviderApiBaseUrl(connection.endpointUrl),
      apiKey: connection.apiKey,
      providerId: provider.id,
      providerKey: provider.providerKey,
      providerModelId: imageSnapshot.providerModelId,
      model: imageSnapshot.modelKey,
    }
  }

  if (imageSnapshot && transport === "openai-images-generations") {
    const providers = await readProviderRecords()
    const provider = providers.find((item) => item.id === imageSnapshot.providerId)
    const connection = resolveProviderConnectionFields(provider)
    if (!provider || !connection.endpointUrl || !connection.apiKey) {
      throw new Error(`OpenAI images generation provider is incomplete for ${imageSnapshot.providerKey}`)
    }

    const quality = imageSnapshot.capabilityJson?.quality
    const responseFormat = imageSnapshot.capabilityJson?.responseFormat
    const maxBatchImages = Number(imageSnapshot.capabilityJson?.maxBatchImages ?? imageSnapshot.capabilityJson?.max_batch_images ?? 4)
    const rawBatchReturnMode = `${imageSnapshot.capabilityJson?.batchReturnMode ?? imageSnapshot.capabilityJson?.batch_return_mode ?? ""}`.trim()
    const inferredCompositeGrid = imageSnapshot.providerModelId.trim().toLowerCase() === "gpt-image-2"
    const batchReturnMode = rawBatchReturnMode || (inferredCompositeGrid ? "composite_grid" : "")
    const compositeGridSize = imageSnapshot.capabilityJson?.compositeGridSize ?? imageSnapshot.capabilityJson?.composite_grid_size
    const compositeGridLayout = imageSnapshot.capabilityJson?.compositeGridLayout ?? imageSnapshot.capabilityJson?.composite_grid_layout

    return {
      kind: "openai-images-generation",
      baseUrl: resolveProviderApiBaseUrl(connection.endpointUrl),
      apiKey: connection.apiKey,
      providerId: provider.id,
      providerKey: provider.providerKey,
      providerModelId: imageSnapshot.providerModelId,
      model: imageSnapshot.modelKey,
      quality: typeof quality === "string" && quality.trim() ? quality.trim() : undefined,
      responseFormat: typeof responseFormat === "string" && responseFormat.trim() ? responseFormat.trim() : undefined,
      maxBatchImages: Number.isFinite(maxBatchImages) && maxBatchImages > 0 ? Math.floor(maxBatchImages) : 4,
      batchReturnMode: batchReturnMode === "composite_grid" ? "composite_grid" : "api_multi_image",
      compositeGridSize: typeof compositeGridSize === "string" && compositeGridSize.trim() ? compositeGridSize.trim() : undefined,
      compositeGridLayout: typeof compositeGridLayout === "string" && compositeGridLayout.trim() ? compositeGridLayout.trim() : undefined,
    }
  }

  return {
    kind: "gateway",
    model: normalizeImageModel(model),
  }
}

async function resolveOpenAIImagesFallbackRuntimes(detail: TaskDetail): Promise<OpenAIImagesFallbackRuntime[]> {
  const imageSnapshot = (detail.taskRunConfig.slotSnapshots ?? []).find((slot) => slot.slotType === "imageModel")
  const fallbackCandidates = imageSnapshot?.fallbackCandidates ?? []
  if (!fallbackCandidates.length) {
    return []
  }

  const providers = await readProviderRecords()
  const runtimes: OpenAIImagesFallbackRuntime[] = []
  for (const candidate of fallbackCandidates) {
    const transport = `${candidate.capabilityJson?.imageTransport ?? ""}`.trim().toLowerCase()
    if (transport !== "openai-images-generations") {
      continue
    }
    const provider = providers.find((item) => item.id === candidate.providerId)
    const connection = resolveProviderConnectionFields(provider)
    if (!provider || !connection.endpointUrl || !connection.apiKey) {
      continue
    }

    const quality = candidate.capabilityJson?.quality
    const responseFormat = candidate.capabilityJson?.responseFormat
    const maxBatchImages = Number(candidate.capabilityJson?.maxBatchImages ?? candidate.capabilityJson?.max_batch_images ?? 4)
    const rawBatchReturnMode = `${candidate.capabilityJson?.batchReturnMode ?? candidate.capabilityJson?.batch_return_mode ?? ""}`.trim()
    const inferredCompositeGrid = candidate.providerModelId.trim().toLowerCase() === "gpt-image-2"
    const batchReturnMode = rawBatchReturnMode || (inferredCompositeGrid ? "composite_grid" : "")
    const compositeGridSize = candidate.capabilityJson?.compositeGridSize ?? candidate.capabilityJson?.composite_grid_size
    const compositeGridLayout = candidate.capabilityJson?.compositeGridLayout ?? candidate.capabilityJson?.composite_grid_layout

    runtimes.push({
      kind: "openai-images-generation",
      baseUrl: resolveProviderApiBaseUrl(connection.endpointUrl),
      apiKey: connection.apiKey,
      providerId: provider.id,
      providerKey: provider.providerKey,
      providerModelId: candidate.providerModelId,
      model: candidate.modelKey,
      quality: typeof quality === "string" && quality.trim() ? quality.trim() : undefined,
      responseFormat: typeof responseFormat === "string" && responseFormat.trim() ? responseFormat.trim() : undefined,
      maxBatchImages: Number.isFinite(maxBatchImages) && maxBatchImages > 0 ? Math.floor(maxBatchImages) : 4,
      batchReturnMode: batchReturnMode === "composite_grid" ? "composite_grid" : "api_multi_image",
      compositeGridSize: typeof compositeGridSize === "string" && compositeGridSize.trim() ? compositeGridSize.trim() : undefined,
      compositeGridLayout: typeof compositeGridLayout === "string" && compositeGridLayout.trim() ? compositeGridLayout.trim() : undefined,
      fallbackTriggers: candidate.fallbackTriggers ?? [],
    })
  }

  return runtimes
}

function getImageFallbackTrigger(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return null
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  const statusMatch = message.match(/\((\d{3})(?:\s|[):])/)
  const statusCode = statusMatch ? Number(statusMatch[1]) : null
  if (statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 422) {
    return null
  }
  if (statusCode === 408 || /timeout|timed out|econnaborted/.test(message)) {
    return "timeout"
  }
  if (statusCode === 429 || /rate limit|too many requests/.test(message)) {
    return "rate_limit"
  }
  if (/empty|no image|no output|blank/.test(message)) {
    return "empty_result"
  }
  if (/invalid response|malformed|did not return|parse|json/.test(message)) {
    return "invalid_response"
  }
  if ((statusCode && statusCode >= 500) || /gateway|provider|upstream|unavailable|bad gateway/.test(message)) {
    return "provider_error"
  }
  return null
}

export async function createGeminiNativeImageArtifact(
  input: {
    baseUrl: string
    apiKey: string
    model: string
    prompt: string
    signal?: AbortSignal
  },
  deps: {
    postJson?: (url: string, body: Record<string, unknown>) => Promise<any>
  } = {},
) {
  const url = `${resolveProviderApiBaseUrl(input.baseUrl)}/v1beta/models/${input.model}:generateContent?key=${input.apiKey}`
  const body = {
    contents: [
      {
        parts: [{ text: input.prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  }

  const responseData = deps.postJson
    ? await deps.postJson(url, body)
    : (
      await axios.post(url, body, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 300000,
        signal: input.signal,
      })
    ).data

  const reference = extractGeminiInlineImageReference(responseData)
  if (!reference) {
    throw new Error(`Gemini native image response did not include inline image data: ${JSON.stringify(responseData)}`)
  }

  return {
    ...await resolveImageBytes({
      url: null,
      b64Json: reference.b64Json,
      mimeType: reference.mimeType,
    }),
    generationId: null,
  }
}

function extractOpenAIChatImageReference(payload: any) {
  const directReference = extractImageReference(payload)
  if (directReference) {
    return directReference
  }

  const message = payload?.choices?.[0]?.message
  if (typeof message?.content === "string") {
    const dataUrlMatch = message.content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/)
    if (dataUrlMatch?.[0]) {
      return { url: dataUrlMatch[0], b64Json: null, mimeType: null }
    }

    const markdownImageMatch = message.content.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/)
    if (markdownImageMatch?.[1]) {
      return { url: markdownImageMatch[1], b64Json: null, mimeType: null }
    }
  }

  const imageCandidates = Array.isArray(message?.images) ? message.images : []
  for (const item of imageCandidates) {
    if (!item || typeof item !== "object") {
      continue
    }

    const url =
      typeof item.url === "string"
        ? item.url
        : typeof item.image_url === "string"
          ? item.image_url
          : typeof item.image_url?.url === "string"
            ? item.image_url.url
            : null
    const b64Json =
      typeof item.b64_json === "string"
        ? item.b64_json
        : typeof item.image_base64 === "string"
          ? item.image_base64
          : typeof item.base64 === "string"
            ? item.base64
            : null
    const mimeType =
      typeof item.mime_type === "string"
        ? item.mime_type
        : typeof item.mimeType === "string"
          ? item.mimeType
          : null

    if (url || b64Json) {
      return { url, b64Json, mimeType }
    }
  }

  const contentBlocks = Array.isArray(message?.content) ? message.content : []
  for (const block of contentBlocks) {
    if (!block || typeof block !== "object") {
      continue
    }

    const type = `${block.type ?? ""}`.toLowerCase()
    const url =
      typeof block.image_url === "string"
        ? block.image_url
        : typeof block.image_url?.url === "string"
          ? block.image_url.url
          : typeof block.url === "string"
            ? block.url
            : null
    const b64Json =
      typeof block.b64_json === "string"
        ? block.b64_json
        : typeof block.image_base64 === "string"
          ? block.image_base64
          : typeof block.base64 === "string"
            ? block.base64
            : null
    const mimeType =
      typeof block.mime_type === "string"
        ? block.mime_type
        : typeof block.mimeType === "string"
          ? block.mimeType
          : null

    if ((type.includes("image") || url || b64Json) && (url || b64Json)) {
      return { url, b64Json, mimeType }
    }
  }

  return null
}

export async function createOpenAIChatCompletionsImageArtifact(
  input: {
    baseUrl: string
    apiKey: string
    model: string
    prompt: string
    size: string
    signal?: AbortSignal
  },
  deps: {
    postJson?: (url: string, body: Record<string, unknown>) => Promise<any>
  } = {},
) {
  const url = `${resolveProviderApiBaseUrl(input.baseUrl)}/v1/chat/completions`
  const body = {
    model: input.model,
    modalities: ["text", "image"],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: input.prompt }],
      },
    ],
    size: input.size,
    response_format: { type: "b64_json" },
    stream: false,
  }

  let responseData: any
  try {
    responseData = deps.postJson
      ? await deps.postJson(url, body)
      : (
        await axios.post(url, body, {
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 300000,
          signal: input.signal,
        })
      ).data
  } catch (error) {
    throw toProviderRequestError("OpenAI chat image request failed", error)
  }

  const reference = extractOpenAIChatImageReference(responseData)
  if (!reference) {
    throw new Error(`OpenAI chat image response did not include image data: ${JSON.stringify(responseData)}`)
  }

  return {
    ...await resolveImageBytes(reference),
    generationId: null,
  }
}

export async function createOpenAIImagesGenerationArtifact(
  input: {
    baseUrl: string
    apiKey: string
    model: string
    prompt: string
    size: string
    quality?: string
    responseFormat?: string
    signal?: AbortSignal
  },
  deps: {
    postJson?: (url: string, body: Record<string, unknown>) => Promise<any>
  } = {},
) {
  const artifacts = await createOpenAIImagesGenerationArtifacts(
    {
      ...input,
      count: 1,
    },
    deps,
  )
  const artifact = artifacts[0]
  if (!artifact) {
    throw new Error("OpenAI images generation response did not include image data")
  }
  return artifact
}

export async function createOpenAIImagesGenerationArtifacts(
  input: {
    baseUrl: string
    apiKey: string
    model: string
    prompt: string
    size: string
    count?: number
    quality?: string
    responseFormat?: string
    signal?: AbortSignal
  },
  deps: {
    postJson?: (url: string, body: Record<string, unknown>) => Promise<any>
  } = {},
) {
  const url = `${resolveProviderApiBaseUrl(input.baseUrl)}/v1/images/generations`
  const count = Math.max(1, Math.floor(input.count ?? 1))
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    n: count,
    size: input.size,
  }

  if (input.quality) {
    body.quality = input.quality
  }

  if (input.responseFormat) {
    body.response_format = input.responseFormat
  }

  let responseData: any
  try {
    responseData = deps.postJson
      ? await deps.postJson(url, body)
      : (
        await axios.post(url, body, {
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: IMAGE_GATEWAY_REQUEST_TIMEOUT_MS,
          signal: input.signal,
        })
      ).data
  } catch (error) {
    throw toProviderRequestError("OpenAI images generation request failed", error)
  }

  const generationId = extractGenerationId(responseData)
  const references = extractImageReferences(responseData)
  if (!references.length) {
    throw new Error(`OpenAI images generation response did not include image data: ${JSON.stringify(responseData)}`)
  }

  return Promise.all(
    references.slice(0, count).map(async (reference, index) => ({
      ...await resolveImageBytes(reference),
      generationId: references.length > 1 && generationId ? `${generationId}:${index + 1}` : generationId,
    })),
  )
}

function extractAnthropicText(payload: any) {
  const blocks = Array.isArray(payload?.content) ? payload.content : []
  return blocks
    .filter((item: any) => item?.type === "text" && typeof item.text === "string")
    .map((item: any) => item.text)
    .join("\n")
    .trim()
}

function extractOpenAIText(payload: any) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === "string") {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .filter((item: any) => item?.type === "text" && typeof item.text === "string")
      .map((item: any) => item.text)
      .join("\n")
      .trim()
  }

  return ""
}

function extractOpenAIResponsesText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const output = Array.isArray(payload?.output) ? payload.output : []
  const textParts: string[] = []

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : []
    for (const block of content) {
      if (
        (block?.type === "output_text" || block?.type === "text") &&
        typeof block.text === "string"
      ) {
        textParts.push(block.text)
      }
    }
  }

  const joined = textParts.join("\n").trim()
  return joined || extractOpenAIText(payload)
}

function resolveOpenAITextWireApi(input: {
  model: string
  capabilityJson?: Record<string, unknown>
}) {
  const explicit =
    (typeof input.capabilityJson?.routingProfile === "object" && input.capabilityJson.routingProfile && !Array.isArray(input.capabilityJson.routingProfile)
      ? (input.capabilityJson.routingProfile as Record<string, unknown>).wireApi
      : undefined) ??
    input.capabilityJson?.wireApi ??
    input.capabilityJson?.wire_api ??
    input.capabilityJson?.textWireApi ??
    input.capabilityJson?.text_wire_api ??
    process.env.GENERGI_TEXT_WIRE_API
  if (typeof explicit === "string") {
    const normalized = explicit.trim().toLowerCase().replace(/[-\s]+/g, "_")
    if (normalized === "responses" || normalized === "response") {
      return "responses" as const
    }
    if (normalized === "chat_completions" || normalized === "chat_completion" || normalized === "chat") {
      return "chat_completions" as const
    }
  }

  return input.model.trim().toLowerCase().startsWith("gpt-5")
    ? "responses" as const
    : "chat_completions" as const
}

async function requestOpenAICompatiblePlanning(input: {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  promptContext: string
  wireApi: "chat_completions" | "responses"
}) {
  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    "content-type": "application/json",
  }

  if (input.wireApi === "responses") {
    const response = await axios.post(
      `${input.baseUrl}/v1/responses`,
      {
        model: input.model,
        instructions: input.systemPrompt,
        input: input.promptContext,
        text: {
          format: { type: "json_object" },
        },
      },
      {
        headers,
        timeout: 120000,
      },
    )
    return extractOpenAIResponsesText(response.data)
  }

  const response = await axios.post(
    `${input.baseUrl}/v1/chat/completions`,
    {
      model: input.model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.promptContext },
      ],
    },
    {
      headers,
      timeout: 120000,
    },
  )
  return extractOpenAIText(response.data)
}

function getTextPlanningFailureTrigger(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === 401 || status === 403) {
      return null
    }
    if (status === 404) {
      return null
    }
    if (status === 400 || status === 422) {
      return null
    }
    if (status === 408) {
      return "timeout"
    }
    if (status === 429) {
      return "rate_limit"
    }
    if (status && status >= 500) {
      return "provider_error"
    }
    if (error.code === "ECONNABORTED" || /timeout|timed out/i.test(error.message)) {
      return "timeout"
    }
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (/unauthori[sz]ed|forbidden|invalid api key|api key|auth/.test(message)) {
    return null
  }
  if (/model_not_found|model not found|not found|unsupported model|unknown model/.test(message)) {
    return null
  }
  if (/bad request|invalid request|request format|invalid parameter|unsupported parameter/.test(message)) {
    return null
  }
  if (/timeout|timed out|econnaborted|408/.test(message)) {
    return "timeout"
  }
  if (/429|rate limit|too many requests|quota/.test(message)) {
    return "rate_limit"
  }
  if (/empty|no content|no output|blank/.test(message)) {
    return "empty_result"
  }
  if (/invalid response|malformed|parse|json|schema|could not be normalized/.test(message)) {
    return "invalid_response"
  }
  if (/5\d\d|gateway|provider|upstream|failed|unavailable|bad gateway/.test(message)) {
    return "provider_error"
  }
  return null
}

function formatTextPlanningError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function requestTextPlanningRaw(input: {
  runtime: TextPlanningRuntime
  systemPrompt: string
  promptContext: string
  wireApi: "messages" | "chat_completions" | "responses" | null
}) {
  const { runtime } = input
  if (runtime.provider === "anthropic-compatible" || runtime.provider === "anthropic-native") {
    const response = await axios.post(
      `${runtime.baseUrl}/v1/messages`,
      {
        model: runtime.model,
        max_tokens: 1200,
        system: input.systemPrompt,
        messages: [{ role: "user", content: input.promptContext }],
      },
      {
        headers: {
          "x-api-key": runtime.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 120000,
      },
    )
    return extractAnthropicText(response.data)
  }

  if (runtime.provider === "openai-compatible") {
    return requestOpenAICompatiblePlanning({
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      model: runtime.model,
      systemPrompt: input.systemPrompt,
      promptContext: input.promptContext,
      wireApi: input.wireApi === "responses" ? "responses" : "chat_completions",
    })
  }

  return ""
}

function extractJsonObject(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim()
  }

  const firstBrace = text.indexOf("{")
  const lastBrace = text.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1)
  }

  return text.trim()
}

export function buildPlanningPromptContext(input: {
  originalScript: string
  projectId: string
  targetDurationSec: number
  platform: string
  executionMode: "automated" | "review_required"
  terminalPresetId: string
  renderSpec: {
    width: number
    height: number
    aspectRatio: string
    compositionGuideline: string
    motionGuideline: string
  }
  generationMode: "user_locked" | "system_enhanced"
  generationRoute: "single_shot" | "multi_scene"
  routeReason: string
  maxSingleShotSec: number
  enhancementKeywords: string[]
  maxSceneCount?: number
  visualSeedInput?: string | null
  keyframeGenerationMode?: "batch" | "single"
}) {
  const requiredSceneCount =
    input.generationRoute === "multi_scene"
      ? input.maxSceneCount ?? resolveSceneCountForDurationWithLimit(input.targetDurationSec, input.maxSingleShotSec)
      : 1
  return [
    `project id: ${input.projectId}`,
    `execution mode: ${input.executionMode}`,
    `terminal preset: ${input.terminalPresetId}`,
    `render size: ${input.renderSpec.width}x${input.renderSpec.height}`,
    `render aspect ratio: ${input.renderSpec.aspectRatio}`,
    `composition guideline: ${input.renderSpec.compositionGuideline}`,
    `motion guideline: ${input.renderSpec.motionGuideline}`,
    `target duration: ${input.targetDurationSec}s`,
    `generation route: ${input.generationRoute}`,
    `route reason: ${input.routeReason}`,
    `model single-shot ceiling: ${input.maxSingleShotSec}s`,
    "original script:",
    input.originalScript,
    "visual brief:",
    input.visualSeedInput?.trim() || "not provided; infer a consistent character, setting, style, mood, and negative prompt from the original script",
    "output requirements:",
    "- preserve the user's original topic, domain, subject, scene, and CTA intent",
    "- do not add new products, offers, commercial angles, or environments that are not present in the original script",
    "- do not replace the original topic with a different marketing angle",
    "- keep the planning close to the original content order unless duration compression requires minimal restructuring",
    "- if the script implies a recurring character, subject, or room, keep it consistent across all scenes",
    "- compress and structure the original script; do not rewrite it into a different concept",
    "- return machine-usable JSON only",
    "- do not output explanations",
    "- do not output markdown separators",
    "- do not output what changed and why",
    "- finalVoiceoverScript must be direct voiceover text",
    "- scenePlan.script and scenePlan.voiceoverScript are the final narration draft for downstream TTS and subtitles",
    "- scenePlan.imagePrompt and scenePlan.videoPrompt are the final downstream prompts for image and video generation",
    "- also return bilingualUnderstandingPreview for operators: every preview field must include zh and en",
    "- also return englishExecutionBrief.version = \"execution-brief-v1\" and englishExecutionBrief.finalPromptLanguage = \"en\"",
    "- englishExecutionBrief.keyframePlan must contain the final English imagePrompt and videoPrompt for each keyframe in order",
    "- downstream image and video models will use englishExecutionBrief only; do not put Chinese text inside englishExecutionBrief prompts",
    `- keyframe mode: ${input.keyframeGenerationMode ?? "batch"}`,
    "- each scenePlan.imagePrompt must work as one frame in a consistent storyboard image set",
    "- make every scene prompt directly usable by the next model call; do not use placeholders such as TBD, same as above, or generic references",
    "- when route is multi_scene, use the requested keyframe count as the scene count unless single_shot is selected",
    input.generationRoute === "single_shot"
      ? "- scenePlan must contain exactly one scene"
      : `- scenePlan must contain exactly ${requiredSceneCount} scenes and their duration total must match the target duration`,
  ].join("\n")
}

export function validatePlanningOutput(
  raw: unknown,
  expected: {
    generationRoute: "single_shot" | "multi_scene"
    targetDurationSec: number
    maxSceneCount?: number
    maxSingleShotSec?: number
    executionMode?: "automated" | "review_required"
    renderSpec?: {
      terminalPresetId: "phone_portrait" | "phone_landscape" | "tablet_portrait" | "tablet_landscape"
      width: number
      height: number
      aspectRatio: string
      safeArea: { topPct: number; rightPct: number; bottomPct: number; leftPct: number }
      compositionGuideline: string
      motionGuideline: string
    }
    generationMode?: "user_locked" | "system_enhanced"
    originalScript?: string
  },
):
  | { ok: true; value: TextPlanningOutput }
  | {
      ok: false
      reason: string
    } {
  const scenePlanRaw =
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { scenePlan?: unknown[] }).scenePlan)
      ? (raw as { scenePlan: unknown[] }).scenePlan
      : null

  const usesLegacySceneFields =
    Array.isArray(scenePlanRaw) &&
    scenePlanRaw.some(
      (scene) =>
        scene &&
        typeof scene === "object" &&
        ("sceneNumber" in scene ||
          "sceneId" in scene ||
          "sceneIndex" in scene ||
          "duration" in scene ||
          "durationSeconds" in scene ||
          "purpose" in scene ||
          "visualDirection" in scene ||
          "motionNotes" in scene ||
          "textOverlay" in scene ||
          "onScreenText" in scene ||
          "transition" in scene),
    )

  const normalizedRaw =
    raw &&
    typeof raw === "object" &&
    Array.isArray(scenePlanRaw) &&
    usesLegacySceneFields
      ? {
          generationRoute:
            (raw as { generationRoute?: unknown }).generationRoute === "single_shot"
              ? "single_shot"
              : "multi_scene",
          targetDurationSec:
            parseSceneDurationValue(
              (raw as { targetDurationSec?: number | string; targetDuration?: number | string; targetDurationSeconds?: number | string }).targetDurationSec ??
                (raw as { targetDuration?: number | string }).targetDuration ??
                (raw as { targetDurationSeconds?: number | string }).targetDurationSeconds,
              expected.targetDurationSec,
            ),
          finalVoiceoverScript:
            (raw as { finalVoiceoverScript?: string }).finalVoiceoverScript ??
            ((raw as { scenePlan: Array<{ voiceoverSegment?: string; voiceoverScript?: string; script?: string }> }).scenePlan
              .map((scene) => scene.voiceoverScript ?? scene.script ?? scene.voiceoverSegment ?? "")
              .join(" ")
              .trim()),
          visualStyleGuide:
            (raw as { visualStyleGuide?: string }).visualStyleGuide ??
            "Use the returned visual, mood, and camera notes as the canonical style guide.",
          bilingualUnderstandingPreview:
            (raw as { bilingualUnderstandingPreview?: unknown }).bilingualUnderstandingPreview ?? null,
          englishExecutionBrief:
            (raw as { englishExecutionBrief?: unknown }).englishExecutionBrief ?? null,
          ctaLine:
            (raw as { ctaLine?: string }).ctaLine ??
            (
              (raw as { scenePlan: Array<{ voiceoverSegment?: string; voiceoverScript?: string; script?: string }> }).scenePlan.at(-1)?.voiceoverScript ??
              (raw as { scenePlan: Array<{ voiceoverSegment?: string; voiceoverScript?: string; script?: string }> }).scenePlan.at(-1)?.script ??
              (raw as { scenePlan: Array<{ voiceoverSegment?: string; voiceoverScript?: string; script?: string }> }).scenePlan.at(-1)?.voiceoverSegment ??
              ""
            ),
          scenePlan: (raw as {
            scenePlan: Array<{
              sceneNumber?: number
              sceneId?: number | string
              sceneIndex?: number
              duration?: string | number
              durationSeconds?: number
              durationSec?: number
              visual?: string
              visualDirection?: string
              voiceoverSegment?: string
              mood?: string
              camera?: string
              purpose?: string
              scenePurpose?: string
              script?: string
              imagePrompt?: string
              videoPrompt?: string
              textOverlay?: string
              onScreenText?: string
              motionNotes?: string
              transition?: string
              transitionHint?: string
              startFrameDescription?: string
              voiceoverScript?: string
              startFrameIntent?: string
              endFrameIntent?: string
              continuityConstraints?: string[]
            }>
          }).scenePlan.map((scene, index, allScenes) => {
            const script = scene.script ?? scene.voiceoverSegment ?? ""
            const visual = scene.visualDirection ?? scene.visual ?? script
            const mood = scene.mood ? ` Mood: ${scene.mood}.` : ""
            const camera = scene.camera ? ` Camera: ${scene.camera}.` : ""
            const motionNotes = scene.motionNotes ? ` Motion: ${scene.motionNotes}.` : ""
            const overlayText = scene.textOverlay ?? scene.onScreenText
            const overlay = overlayText ? ` Overlay context: ${overlayText}.` : ""
            const normalizedSceneIndex =
              typeof scene.sceneNumber === "number"
                ? Math.max(scene.sceneNumber - 1, 0)
                : typeof scene.sceneId === "number"
                  ? Math.max(scene.sceneId - 1, 0)
                  : typeof scene.sceneId === "string" && /\d+/.test(scene.sceneId)
                    ? Math.max(Number.parseInt(scene.sceneId.match(/\d+/)?.[0] ?? `${index + 1}`, 10) - 1, 0)
                : typeof scene.sceneIndex === "number"
                  ? Math.max(scene.sceneIndex - (scene.sceneIndex > 0 ? 1 : 0), 0)
                  : index
            return {
              sceneIndex: normalizedSceneIndex,
              scenePurpose: scene.scenePurpose ?? scene.purpose ?? `Scene ${index + 1}`,
              durationSec: parseSceneDurationValue(
                scene.durationSec ?? scene.durationSeconds ?? scene.duration,
                Math.floor(expected.targetDurationSec / allScenes.length),
              ),
              script,
              voiceoverScript: scene.voiceoverScript ?? script,
              startFrameDescription: scene.startFrameDescription ?? visual,
              imagePrompt: scene.imagePrompt ?? `${visual}${mood}${camera}${overlay}`.trim(),
              videoPrompt:
                scene.videoPrompt ??
                `${visual}${mood}${camera}${motionNotes}${overlay} Generate a short-form social video shot that matches this exact beat.`.trim(),
              startFrameIntent: scene.startFrameIntent ?? (scene.scenePurpose ?? scene.purpose ?? `Introduce scene ${index + 1}`),
              endFrameIntent: scene.endFrameIntent ?? (index === allScenes.length - 1 ? "Close on the final message" : `Hand off from scene ${index + 1}`),
              transitionHint: scene.transitionHint ?? scene.transition ?? (index === allScenes.length - 1 ? "close" : "cut"),
              continuityConstraints: Array.isArray(scene.continuityConstraints) ? scene.continuityConstraints : [],
            }
          }),
          blueprint: {
            executionMode: expected.executionMode ?? "review_required",
            renderSpec:
              expected.renderSpec ?? {
                terminalPresetId: "phone_portrait",
                width: 1080,
                height: 1920,
                aspectRatio: "9:16",
                safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
                compositionGuideline: "Keep the subject centered.",
                motionGuideline: "Prefer slow push-ins.",
              },
            globalTheme:
              (raw as { globalTheme?: string }).globalTheme ??
              "Preserve the original content theme with platform-native execution.",
            visualStyleGuide:
              (raw as { visualStyleGuide?: string }).visualStyleGuide ??
              "Use the returned image and video prompts as the canonical visual guide.",
            bilingualUnderstandingPreview:
              (raw as { bilingualUnderstandingPreview?: unknown }).bilingualUnderstandingPreview ?? null,
            englishExecutionBrief:
              (raw as { englishExecutionBrief?: unknown }).englishExecutionBrief ?? null,
            subjectProfile:
              (raw as { subjectProfile?: string }).subjectProfile ??
              "Maintain one consistent subject profile across all scenes.",
            productProfile:
              (raw as { productProfile?: string }).productProfile ??
              "Keep product presentation consistent across all scenes.",
            backgroundConstraints: [],
            negativeConstraints: [],
            totalVoiceoverScript:
              (raw as { finalVoiceoverScript?: string }).finalVoiceoverScript ??
              ((raw as { scenePlan: Array<{ voiceoverSegment?: string; voiceoverScript?: string; script?: string }> }).scenePlan
                .map((scene) => scene.voiceoverScript ?? scene.script ?? scene.voiceoverSegment ?? "")
                .join(" ")
                .trim()),
            sceneContracts: ((raw as {
              scenePlan: Array<{
                sceneNumber?: number
                sceneId?: number | string
                sceneIndex?: number
                duration?: string | number
                durationSeconds?: number
                durationSec?: number
                visual?: string
                visualDirection?: string
                voiceoverSegment?: string
                mood?: string
                camera?: string
                purpose?: string
                scenePurpose?: string
                script?: string
                imagePrompt?: string
                videoPrompt?: string
                textOverlay?: string
                onScreenText?: string
                motionNotes?: string
                transition?: string
                transitionHint?: string
                startFrameDescription?: string
                voiceoverScript?: string
                startFrameIntent?: string
                endFrameIntent?: string
                continuityConstraints?: string[]
              }>
            }).scenePlan.map((scene, index, allScenes) => {
              const script = scene.script ?? scene.voiceoverSegment ?? ""
              const visual = scene.visualDirection ?? scene.visual ?? script
              const mood = scene.mood ? ` Mood: ${scene.mood}.` : ""
              const camera = scene.camera ? ` Camera: ${scene.camera}.` : ""
              const motionNotes = scene.motionNotes ? ` Motion: ${scene.motionNotes}.` : ""
              const overlayText = scene.textOverlay ?? scene.onScreenText
              const overlay = overlayText ? ` Overlay context: ${overlayText}.` : ""
              const normalizedSceneIndex =
                typeof scene.sceneNumber === "number"
                  ? Math.max(scene.sceneNumber - 1, 0)
                  : typeof scene.sceneId === "number"
                    ? Math.max(scene.sceneId - 1, 0)
                    : typeof scene.sceneId === "string" && /\d+/.test(scene.sceneId)
                      ? Math.max(Number.parseInt(scene.sceneId.match(/\d+/)?.[0] ?? `${index + 1}`, 10) - 1, 0)
                  : typeof scene.sceneIndex === "number"
                    ? Math.max(scene.sceneIndex - (scene.sceneIndex > 0 ? 1 : 0), 0)
                    : index
              const durationSec = parseSceneDurationValue(
                scene.durationSec ?? scene.durationSeconds ?? scene.duration,
                Math.floor(expected.targetDurationSec / allScenes.length),
              )
              return {
                id: `scene_${normalizedSceneIndex + 1}`,
                index: normalizedSceneIndex,
                sceneGoal: scene.scenePurpose ?? scene.purpose ?? `Scene ${index + 1}`,
                voiceoverScript: scene.voiceoverScript ?? script,
                startFrameDescription: scene.startFrameDescription ?? visual,
                imagePrompt: scene.imagePrompt ?? `${visual}${mood}${camera}${overlay}`.trim(),
                videoPrompt:
                  scene.videoPrompt ??
                  `${visual}${mood}${camera}${motionNotes}${overlay} Generate a short-form social video shot that matches this exact beat.`.trim(),
                startFrameIntent: scene.startFrameIntent ?? (scene.scenePurpose ?? scene.purpose ?? `Introduce scene ${index + 1}`),
                endFrameIntent: scene.endFrameIntent ?? (index === allScenes.length - 1 ? "Close on the final message" : `Hand off from scene ${index + 1}`),
                durationSec,
                transitionHint: scene.transitionHint ?? scene.transition ?? (index === allScenes.length - 1 ? "close" : "cut"),
                continuityConstraints: Array.isArray(scene.continuityConstraints) ? scene.continuityConstraints : [],
              }
            })),
          },
        }
      : raw

  const parsed = textPlanningOutputSchema.safeParse(normalizedRaw)
  if (!parsed.success) {
    return { ok: false, reason: `planning output schema invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}` }
  }

  const executionBrief =
    parsed.data.englishExecutionBrief ??
    parsed.data.blueprint.englishExecutionBrief ??
    null
  const understandingPreview =
    parsed.data.bilingualUnderstandingPreview ??
    parsed.data.blueprint.bilingualUnderstandingPreview ??
    null
  const scenePlan = executionBrief
    ? parsed.data.scenePlan.map((scene, index) => {
        const keyframe = executionBrief.keyframePlan[index]
        if (!keyframe) {
          return scene
        }
        return {
          ...scene,
          scenePurpose: keyframe.narrativeRole || scene.scenePurpose,
          startFrameDescription: keyframe.visualGoal || scene.startFrameDescription,
          imagePrompt: keyframe.imagePrompt,
          videoPrompt: keyframe.videoPrompt,
          startFrameIntent: keyframe.visualGoal || scene.startFrameIntent,
          endFrameIntent: keyframe.visualGoal || scene.endFrameIntent,
        }
      })
    : parsed.data.scenePlan
  const parsedData = {
    ...parsed.data,
    bilingualUnderstandingPreview: understandingPreview,
    englishExecutionBrief: executionBrief,
    scenePlan,
    blueprint: {
      ...parsed.data.blueprint,
      bilingualUnderstandingPreview: understandingPreview,
      englishExecutionBrief: executionBrief,
    },
  }

  const output = parsedData.blueprint.sceneContracts.length
    ? {
        ...parsedData,
        blueprint: {
          ...parsedData.blueprint,
          sceneContracts: executionBrief
            ? parsedData.blueprint.sceneContracts.map((scene, index) => {
                const keyframe = executionBrief.keyframePlan[index]
                if (!keyframe) {
                  return scene
                }
                return {
                  ...scene,
                  sceneGoal: keyframe.narrativeRole || scene.sceneGoal,
                  startFrameDescription: keyframe.visualGoal || scene.startFrameDescription,
                  imagePrompt: keyframe.imagePrompt,
                  videoPrompt: keyframe.videoPrompt,
                  startFrameIntent: keyframe.visualGoal || scene.startFrameIntent,
                  endFrameIntent: keyframe.visualGoal || scene.endFrameIntent,
                }
              })
            : parsedData.blueprint.sceneContracts,
        },
      }
    : {
        ...parsedData,
        blueprint: {
          ...parsedData.blueprint,
          totalVoiceoverScript: parsedData.finalVoiceoverScript,
          sceneContracts: parsedData.scenePlan.map((scene, index, allScenes) => ({
            id: `scene_${index + 1}`,
            index,
            sceneGoal: scene.scenePurpose,
            voiceoverScript: scene.voiceoverScript,
            startFrameDescription: scene.startFrameDescription,
            imagePrompt: scene.imagePrompt,
            videoPrompt: scene.videoPrompt,
            startFrameIntent: scene.startFrameIntent,
            endFrameIntent: scene.endFrameIntent,
            durationSec: scene.durationSec,
            transitionHint: normalizeTransitionHint(index, allScenes.length, scene.transitionHint),
            continuityConstraints: scene.continuityConstraints ?? [],
          })),
        },
      }
  return { ok: true, value: output }
}

function normalizeForComparison(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function calculateWordBudget(targetDurationSec: number) {
  return Math.max(12, Math.floor(targetDurationSec * 2.2))
}

function clampRate(rate: number) {
  return Math.max(-50, Math.min(50, Math.round(rate)))
}

export function resolveTtsRateForTargetDuration(
  actualDurationSec: number,
  targetDurationSec: number,
  currentRate = 0,
) {
  if (!Number.isFinite(actualDurationSec) || !Number.isFinite(targetDurationSec) || targetDurationSec <= 0) {
    return currentRate
  }

  const desiredRateDelta = ((actualDurationSec / targetDurationSec) - 1) * 100
  return clampRate(currentRate + desiredRateDelta)
}

export function normalizeRewriteToVoiceoverScript(text: string, targetDurationSec: number) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-–—]{3,}$/.test(line))
    .filter((line) => !/^here('|’)s a tighter/i.test(line))
    .filter((line) => !/^a few notes/i.test(line))
    .filter((line) => !/^want me to/i.test(line))
    .filter((line) => !/^[-*]\s/.test(line))
    .map((line) => line.replace(/\*\*/g, ""))
    .map((line) => line.replace(/^[A-Za-z ]+\(\d+\s*-\s*\d+s\):\s*/i, ""))

  const normalized = lines
    .join(" ")
    .replace(/^[-–—\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()

  const rawSentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  const sentences =
    /[.!?"]$/.test(normalized) || rawSentences.length <= 1
      ? rawSentences
      : rawSentences.slice(0, -1)

  const budget = calculateWordBudget(targetDurationSec)
  const sentenceWordCounts = sentences.map((sentence) => sentence.split(/\s+/).filter(Boolean).length)
  const totalWords = sentenceWordCounts.reduce((sum, count) => sum + count, 0)
  if (totalWords <= budget) {
    return sentences.join(" ").replace(/^[-–—\s]+/, "").trim()
  }

  const selectedIndices = new Set<number>()
  selectedIndices.add(0)
  const lastIndex = sentences.length - 1
  if (lastIndex > 0) {
    selectedIndices.add(lastIndex)
  }

  let usedWords = sentenceWordCounts[0] ?? 0
  const reservedEndingWords = lastIndex > 0 ? sentenceWordCounts[lastIndex] ?? 0 : 0
  if (lastIndex > 0) {
    usedWords += reservedEndingWords
  }

  for (let index = 1; index < lastIndex; index += 1) {
    const sentence = sentences[index]
    const sentenceWords = sentenceWordCounts[index]
    const isLowValueBridge = /^here('|’)s the thing[.!?]?$/i.test(sentence)
    if (isLowValueBridge) {
      continue
    }

    if (usedWords + sentenceWords > budget) {
      continue
    }

    selectedIndices.add(index)
    usedWords += sentenceWords
  }

  const selected = sentences.filter((_, index) => selectedIndices.has(index))

  return selected.join(" ").replace(/^[-–—\s]+/, "").trim()
}

export function buildSystemEnhancedFallbackScript(originalScript: string, targetDurationSec: number) {
  const normalized = originalScript.replace(/\s+/g, " ").trim()
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  const hook = sentences[0] ?? normalized
  const second = sentences[1] ?? ""
  const third = sentences[2] ?? ""
  const closing = sentences.at(-1) ?? normalized

  const hasDeskChaos = /messy|clutter|chaos|cables/i.test(normalized)
  const hasProductReveal = /charger|organize|setup/i.test(normalized)
  const hasRelief = /stress|calm|clean/i.test(normalized)
  const hasUpgrade = /upgrade|link in bio|shop|grab/i.test(normalized)

  const hookLine = hasDeskChaos
    ? "Messy desk? Cables everywhere."
    : hook.replace(/\.$/, "").trim()

  const revealLine = hasProductReveal
    ? "One compact charger clears the setup fast."
    : second || "One clean switch changes everything."

  const payoffLine = hasRelief
    ? "Clean desk. Clear head."
    : third || "Clean setup. Instant relief."

  const ctaLine = hasUpgrade
    ? "Upgrade your desk today."
    : "Upgrade your desk today. Link in bio."

  const enhanced = [hookLine, revealLine, payoffLine, ctaLine]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

  return normalizeRewriteToVoiceoverScript(enhanced, targetDurationSec)
}

function alignDetailScenes(detail: TaskDetail, script: string): TaskDetail {
  return {
    ...detail,
    script,
    scenes: buildStoryboardScenes({
      script,
      targetDurationSec: detail.taskRunConfig.targetDurationSec ?? 30,
      maxSceneDurationSec: resolveVideoModelCapability(detail.taskRunConfig.videoModel.id).maxSingleShotSec,
      visualKeyframeCount: detail.taskRunConfig.keyframeCount,
      aspectRatio: detail.taskRunConfig.aspectRatio,
      existingScenes: detail.scenes,
      reviewRequirements: {
        requireStoryboardReview: detail.taskRunConfig.requireStoryboardReview,
        requireKeyframeReview: detail.taskRunConfig.requireKeyframeReview,
      },
    }),
    updatedAt: new Date().toISOString(),
  }
}

function buildPlanningFallback(detail: TaskDetail): TextPlanningOutput {
  const finalVoiceoverScript = detail.script
  const scenes = buildStoryboardScenes({
    script: finalVoiceoverScript,
    targetDurationSec: detail.taskRunConfig.targetDurationSec ?? 30,
    maxSceneDurationSec: resolveVideoModelCapability(detail.taskRunConfig.videoModel.id).maxSingleShotSec,
    visualKeyframeCount: detail.taskRunConfig.keyframeCount,
    aspectRatio: detail.taskRunConfig.aspectRatio,
    reviewRequirements: {
      requireStoryboardReview: detail.taskRunConfig.requireStoryboardReview,
      requireKeyframeReview: detail.taskRunConfig.requireKeyframeReview,
    },
  })
  const blueprint = buildPlannedExecutionBlueprint(detail, {
    generationRoute: detail.taskRunConfig.generationRoute,
    targetDurationSec: detail.taskRunConfig.targetDurationSec,
    finalVoiceoverScript,
    visualStyleGuide: "Preserve the original subject, scene, and semantic intent with minimal structural cleanup.",
    ctaLine: scenes.at(-1)?.script ?? finalVoiceoverScript,
    scenePlan: scenes.map((scene) => ({
      sceneIndex: scene.index,
      scenePurpose: scene.title,
      durationSec: scene.durationSec,
      script: scene.script,
      voiceoverScript: scene.voiceoverScript ?? scene.script,
      startFrameDescription: scene.startFrameDescription ?? scene.title,
      imagePrompt: scene.imagePrompt,
      videoPrompt: scene.videoPrompt,
      startFrameIntent: scene.startFrameIntent ?? scene.title,
      endFrameIntent: scene.endFrameIntent ?? scene.title,
      transitionHint: scene.index === 0 ? "open" : scene.index === scenes.length - 1 ? "close" : "cut",
      continuityConstraints: scene.continuityConstraints ?? [],
    })),
    blueprint: {
      executionMode: detail.taskRunConfig.executionMode,
      renderSpec: detail.taskRunConfig.renderSpecJson,
      globalTheme: detail.title,
      visualStyleGuide: "Preserve the original subject, scene, and semantic intent with minimal structural cleanup.",
      subjectProfile: "Keep the same primary subject or speaker implied by the source script across every scene. Do not invent a new mascot, toy, or unrelated character.",
      productProfile: "Only depict a product, service, report, or offer if the source script explicitly mentions one. Do not substitute a different product category.",
      backgroundConstraints: ["Keep one stable environment unless the source script explicitly changes location."],
      negativeConstraints: ["Do not introduce unrelated products", "Do not change the topic domain", "No subtitles", "No watermark", "No UI elements"],
      totalVoiceoverScript: finalVoiceoverScript,
      sceneContracts: [],
    },
  })

  return {
    generationRoute: detail.taskRunConfig.generationRoute,
    targetDurationSec: detail.taskRunConfig.targetDurationSec,
    finalVoiceoverScript,
    visualStyleGuide: "Preserve the original subject, scene, and semantic intent with minimal structural cleanup.",
    ctaLine: scenes.at(-1)?.script ?? finalVoiceoverScript,
    scenePlan: scenes.map((scene) => ({
      sceneIndex: scene.index,
      scenePurpose: scene.title,
      durationSec: scene.durationSec,
      script: scene.script,
      voiceoverScript: scene.voiceoverScript ?? scene.script,
      startFrameDescription: scene.startFrameDescription ?? scene.title,
      imagePrompt: scene.imagePrompt,
      videoPrompt: scene.videoPrompt,
      startFrameIntent: scene.startFrameIntent ?? scene.title,
      endFrameIntent: scene.endFrameIntent ?? scene.title,
      transitionHint: scene.index === 0 ? "open" : scene.index === scenes.length - 1 ? "close" : "cut",
      continuityConstraints: scene.continuityConstraints ?? [],
    })),
    blueprint,
  }
}

async function requestStructuredPlanning(detail: TaskDetail): Promise<StructuredPlanningAttempt> {
  const runtime = resolveRuntimeGenerationConfig(detail)
  const textRuntime = await resolveTextPlanningRuntime(detail, runtime)

  const preference = GENERATION_PREFERENCES.find((item) => item.id === detail.taskRunConfig.generationMode)
  const capability = resolveVideoModelCapability(detail.taskRunConfig.videoModel.id)
  const maxSceneCount =
    detail.taskRunConfig.generationRoute === "single_shot"
      ? 1
      : detail.taskRunConfig.keyframeCount
  const promptContext = buildPlanningPromptContext({
    originalScript: detail.script,
    projectId: detail.projectId,
    targetDurationSec: detail.taskRunConfig.targetDurationSec,
    platform: detail.taskRunConfig.channelId,
    executionMode: detail.taskRunConfig.executionMode,
    terminalPresetId: detail.taskRunConfig.terminalPresetId,
    renderSpec: detail.taskRunConfig.renderSpecJson,
    generationMode: detail.taskRunConfig.generationMode,
    generationRoute: detail.taskRunConfig.generationRoute,
    routeReason: detail.taskRunConfig.routeReason,
    maxSingleShotSec: capability.maxSingleShotSec,
    enhancementKeywords: preference?.keywords ?? [],
    maxSceneCount,
    visualSeedInput: detail.taskRunConfig.visualSeedInput,
    keyframeGenerationMode: detail.taskRunConfig.keyframeGenerationMode,
  })

  const fallbackRuntimes = await resolveTextPlanningFallbackRuntimes(detail)
  const textModelFallbackEvents: TextModelFallbackEvent[] = []
  let firstFailure: StructuredPlanningAttempt["planningError"] = null

  if (!textRuntime.provider || !textRuntime.apiKey || !textRuntime.baseUrl) {
    return {
      output: null,
      promptContext,
      rawResponse: null,
      parsedResponse: null,
      provider: textRuntime.provider || null,
      model: textRuntime.model || null,
      baseUrl: textRuntime.baseUrl || null,
      wireApi: null,
      textModelFallbackEvents,
      planningError: {
        trigger: null,
        message: "text provider runtime is incomplete",
        provider: textRuntime.provider || null,
        model: textRuntime.model || null,
      },
    }
  }

  const systemPrompt =
    "You are a short-form video director and planner. Return only valid JSON that matches the requested planning structure. Do not explain your decisions."

  const runtimes = [textRuntime, ...fallbackRuntimes]
  const findNextFallbackRuntime = (trigger: string, afterIndex: number) => {
    for (let index = afterIndex + 1; index < runtimes.length; index += 1) {
      const candidate = runtimes[index]
      if (candidate.fallbackTriggers?.includes(trigger)) {
        return { runtime: candidate, index }
      }
    }
    return null
  }

  for (let runtimeIndex = 0; runtimeIndex < runtimes.length; runtimeIndex += 1) {
    const activeRuntime = runtimes[runtimeIndex]
    if (!activeRuntime.apiKey || !activeRuntime.baseUrl || !activeRuntime.model) {
      continue
    }
    const wireApi = activeRuntime.provider === "openai-compatible"
      ? resolveOpenAITextWireApi({
          model: activeRuntime.model,
          capabilityJson: activeRuntime.capabilityJson,
        })
      : activeRuntime.provider === "anthropic-compatible" || activeRuntime.provider === "anthropic-native"
        ? "messages" as const
        : null

    let rawText = ""

    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        rawText = await requestTextPlanningRaw({
          runtime: activeRuntime,
          systemPrompt,
          promptContext,
          wireApi,
        })
        if (rawText) {
          break
        }
      }
    } catch (error) {
      const trigger = getTextPlanningFailureTrigger(error)
      const planningError = {
        trigger,
        message: formatTextPlanningError(error),
        provider: activeRuntime.provider || null,
        model: activeRuntime.model || null,
      }
      firstFailure ??= planningError
      const fallback = trigger ? findNextFallbackRuntime(trigger, runtimeIndex) : null
      if (trigger && fallback) {
        const nextRuntime = fallback.runtime
        textModelFallbackEvents.push({
          trigger,
          fromProvider: activeRuntime.providerKey ?? activeRuntime.provider ?? null,
          fromModel: activeRuntime.model,
          toProvider: nextRuntime.providerKey ?? nextRuntime.provider,
          toModel: nextRuntime.model,
        })
        runtimeIndex = fallback.index - 1
        continue
      }

      return {
        output: null,
        promptContext,
        rawResponse: null,
        parsedResponse: null,
        provider: activeRuntime.provider || null,
        model: activeRuntime.model || null,
        baseUrl: activeRuntime.baseUrl || null,
        wireApi,
        textModelFallbackEvents,
        planningError,
      }
    }

    if (!rawText) {
      const planningError = {
        trigger: "empty_result",
        message: "text model returned empty planning response",
        provider: activeRuntime.provider || null,
        model: activeRuntime.model || null,
      }
      firstFailure ??= planningError
      const fallback = findNextFallbackRuntime("empty_result", runtimeIndex)
      if (fallback) {
        const nextRuntime = fallback.runtime
        textModelFallbackEvents.push({
          trigger: "empty_result",
          fromProvider: activeRuntime.providerKey ?? activeRuntime.provider ?? null,
          fromModel: activeRuntime.model,
          toProvider: nextRuntime.providerKey ?? nextRuntime.provider,
          toModel: nextRuntime.model,
        })
        runtimeIndex = fallback.index - 1
        continue
      }
      continue
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(extractJsonObject(rawText))
    } catch {
      const planningError = {
        trigger: "invalid_response",
        message: "text model response was not valid JSON",
        provider: activeRuntime.provider,
        model: activeRuntime.model,
      }
      firstFailure ??= planningError
      const fallback = findNextFallbackRuntime("invalid_response", runtimeIndex)
      if (fallback) {
        const nextRuntime = fallback.runtime
        textModelFallbackEvents.push({
          trigger: "invalid_response",
          fromProvider: activeRuntime.providerKey ?? activeRuntime.provider ?? null,
          fromModel: activeRuntime.model,
          toProvider: nextRuntime.providerKey ?? nextRuntime.provider,
          toModel: nextRuntime.model,
        })
        runtimeIndex = fallback.index - 1
        continue
      }

      return {
        output: null,
        promptContext,
        rawResponse: rawText,
        parsedResponse: null,
        provider: activeRuntime.provider,
        model: activeRuntime.model,
        baseUrl: activeRuntime.baseUrl,
        wireApi,
        textModelFallbackEvents,
        planningError,
      }
    }

    const validated = validatePlanningOutput(parsedJson, {
      generationRoute: detail.taskRunConfig.generationRoute,
      targetDurationSec: detail.taskRunConfig.targetDurationSec,
      maxSceneCount,
      maxSingleShotSec: capability.maxSingleShotSec,
      executionMode: detail.taskRunConfig.executionMode,
      renderSpec: detail.taskRunConfig.renderSpecJson,
      generationMode: detail.taskRunConfig.generationMode,
      originalScript: detail.script,
    })

    if (validated.ok) {
      return {
        output: validated.value,
        promptContext,
        rawResponse: rawText,
        parsedResponse: parsedJson,
        provider: activeRuntime.provider,
        model: activeRuntime.model,
        baseUrl: activeRuntime.baseUrl,
        wireApi,
        textModelFallbackEvents,
        planningError: firstFailure,
      }
    }

    const planningError = {
      trigger: "invalid_response",
      message: validated.reason,
      provider: activeRuntime.provider,
      model: activeRuntime.model,
    }
    firstFailure ??= planningError
    const fallback = findNextFallbackRuntime("invalid_response", runtimeIndex)
    if (fallback) {
      const nextRuntime = fallback.runtime
      textModelFallbackEvents.push({
        trigger: "invalid_response",
        fromProvider: activeRuntime.providerKey ?? activeRuntime.provider ?? null,
        fromModel: activeRuntime.model,
        toProvider: nextRuntime.providerKey ?? nextRuntime.provider,
        toModel: nextRuntime.model,
      })
      runtimeIndex = fallback.index - 1
      continue
    }

    return {
      output: null,
      promptContext,
      rawResponse: rawText,
      parsedResponse: parsedJson,
      provider: activeRuntime.provider,
      model: activeRuntime.model,
      baseUrl: activeRuntime.baseUrl,
      wireApi,
      textModelFallbackEvents,
      planningError,
    }
  }

  return {
    output: null,
    promptContext,
    rawResponse: null,
    parsedResponse: null,
    provider: textRuntime.provider,
    model: textRuntime.model,
    baseUrl: textRuntime.baseUrl,
    wireApi: textRuntime.provider === "anthropic-compatible" || textRuntime.provider === "anthropic-native"
      ? "messages"
      : textRuntime.provider === "openai-compatible"
        ? resolveOpenAITextWireApi({ model: textRuntime.model, capabilityJson: textRuntime.capabilityJson })
        : null,
    textModelFallbackEvents,
    planningError: firstFailure,
  }
}

export async function rewriteTaskWithTextProvider(detail: TaskDetail): Promise<TaskDetail> {
  const prepared = await buildPreparedTaskDetail(detail)
  return prepared.detail
}

async function buildPreparedTaskDetail(detail: TaskDetail): Promise<{
  detail: TaskDetail
  blueprint: PlannedExecutionBlueprint
  planningTrace: PlanningTraceArtifact
}> {
  const sourceScript = detail.script
  const baseDetail = alignDetailScenes(detail, sourceScript)
  const structuredAttempt = await requestStructuredPlanning(baseDetail)
  const planningOutput = structuredAttempt.output ?? buildPlanningFallback(baseDetail)
  const adopted = applyModelPlanningOutput(baseDetail, planningOutput)

  return {
    detail: adopted.detail,
    blueprint: adopted.blueprint,
    planningTrace: {
      sourceScript,
      planningPrompt: structuredAttempt.promptContext,
      planningResponse: structuredAttempt.rawResponse,
      planningAudit: {
        provider: structuredAttempt.provider,
        model: structuredAttempt.model,
        baseUrl: structuredAttempt.baseUrl,
        wireApi: structuredAttempt.wireApi,
        textModelFallbackEvents: structuredAttempt.textModelFallbackEvents ?? [],
        planningError: structuredAttempt.planningError ?? null,
        usedFallback: !structuredAttempt.output,
        fallbackReason: structuredAttempt.output
          ? null
          : structuredAttempt.rawResponse
            ? "text model response could not be normalized"
            : "text model returned no usable planning response",
        parsedResponse: structuredAttempt.parsedResponse,
        selectedPlan: adopted.planned,
      },
    },
  }
}

export async function prepareTaskBlueprint(detail: TaskDetail): Promise<{
  detail: TaskDetail
  blueprintRecord: TaskBlueprintRecord
  planningTrace: PlanningTraceArtifact
}> {
  const prepared = await buildPreparedTaskDetail(detail)
  const blueprintRecord = await upsertTaskBlueprintSnapshot({
    detail: {
      ...prepared.detail,
      blueprintVersion: prepared.detail.blueprintVersion > 0 ? prepared.detail.blueprintVersion : 1,
      blueprintStatus: prepared.detail.blueprintStatus,
      taskRunConfig: {
        ...prepared.detail.taskRunConfig,
        blueprintVersion: prepared.detail.taskRunConfig.blueprintVersion > 0 ? prepared.detail.taskRunConfig.blueprintVersion : 1,
      },
    },
    blueprint: prepared.blueprint,
    status: "pending_generation",
  })

  return {
    detail: {
      ...prepared.detail,
      script: prepared.detail.script,
      blueprintVersion: blueprintRecord.version,
      blueprintStatus: blueprintRecord.status,
      taskRunConfig: {
        ...prepared.detail.taskRunConfig,
        blueprintVersion: blueprintRecord.version,
        blueprintStatus: blueprintRecord.status,
      },
      visualStyleGuide: blueprintRecord.blueprint.visualStyleGuide,
      ctaLine: prepared.detail.ctaLine,
      scenes: prepared.detail.scenes,
      updatedAt: new Date().toISOString(),
    },
    blueprintRecord,
    planningTrace: prepared.planningTrace,
  }
}

export async function prepareExecutionSource(
  detail: TaskDetail,
  options: {
    continueExecution?: boolean
    approvedBlueprintRecord?: TaskBlueprintRecord | null
  } = {},
): Promise<{
  detail: TaskDetail
  blueprintRecord: TaskBlueprintRecord
  planningTrace: PlanningTraceArtifact | null
  approvedKeyframes: {
    keyframeDir: string
    manifestPath: string
    frameCount: number
  } | null
}> {
  const canReuseReviewedBlueprint = (record?: TaskBlueprintRecord | null) =>
    record?.status === "approved" || record?.status === "queued_for_video"

  if (options.continueExecution) {
    const approvedBlueprintRecord = options.approvedBlueprintRecord ?? await getCurrentTaskBlueprintRecord(detail.taskId)
    if (approvedBlueprintRecord && canReuseReviewedBlueprint(approvedBlueprintRecord)) {
      const rebuiltScenes = buildScenesFromBlueprint(detail, approvedBlueprintRecord.blueprint)
      const rebuiltDetail = normalizeTaskDetailRecord({
        ...detail,
        script: approvedBlueprintRecord.blueprint.totalVoiceoverScript,
        blueprintVersion: approvedBlueprintRecord.version,
        blueprintStatus: approvedBlueprintRecord.status,
        taskRunConfig: {
          ...detail.taskRunConfig,
          blueprintVersion: approvedBlueprintRecord.version,
          blueprintStatus: approvedBlueprintRecord.status,
        },
        visualStyleGuide: approvedBlueprintRecord.blueprint.visualStyleGuide,
        ctaLine:
          approvedBlueprintRecord.blueprint.sceneContracts.at(-1)?.voiceoverScript ??
          detail.ctaLine,
        scenes: rebuiltScenes,
        updatedAt: new Date().toISOString(),
      })

      return {
        detail: rebuiltDetail,
        blueprintRecord: approvedBlueprintRecord,
        planningTrace: null,
        approvedKeyframes: await readKeyframeBundleSnapshot(approvedBlueprintRecord.keyframeManifestPath),
      }
    }
  }

  const prepared = await prepareTaskBlueprint(detail)
  return {
    detail: prepared.detail,
    blueprintRecord: prepared.blueprintRecord,
    planningTrace: prepared.planningTrace,
    approvedKeyframes: null,
  }
}

export async function writeTaskSourceFiles(
  detail: TaskDetail,
  planningTrace?: PlanningTraceArtifact,
) {
  const dir = ensureTaskDir(detail.taskId)
  writeFileSync(path.join(dir, "script.txt"), detail.script, "utf8")
  if (planningTrace?.sourceScript) {
    writeFileSync(path.join(dir, "source-script.txt"), planningTrace.sourceScript, "utf8")
  }
  if (planningTrace?.planningPrompt) {
    writeFileSync(path.join(dir, "planning-prompt.txt"), planningTrace.planningPrompt, "utf8")
  }
  if (planningTrace?.planningResponse) {
    writeFileSync(path.join(dir, "planning-response.txt"), planningTrace.planningResponse, "utf8")
  }
  if (planningTrace?.planningAudit) {
    writeFileSync(path.join(dir, "planning-audit.json"), JSON.stringify(planningTrace.planningAudit, null, 2), "utf8")
  }
  writeFileSync(
    path.join(dir, "visual-plan.json"),
    JSON.stringify(
      {
        visualSeedInput: detail.taskRunConfig.visualSeedInput,
        keyframeGenerationMode: detail.taskRunConfig.keyframeGenerationMode,
        keyframeCount: detail.taskRunConfig.keyframeCount,
        aspectRatio: detail.taskRunConfig.aspectRatio,
        scenes: detail.scenes.map((scene) => ({
          sceneId: scene.id,
          sceneIndex: scene.index,
          title: scene.title,
          imagePrompt: scene.imagePrompt,
          continuityConstraints: scene.continuityConstraints ?? [],
        })),
      },
      null,
      2,
    ),
    "utf8",
  )
  writeFileSync(
    path.join(dir, "keyframe-prompt-summary.txt"),
    buildBatchKeyframePrompt({
      scenes: detail.scenes,
      aspectRatio: detail.taskRunConfig.aspectRatio,
      visualSeedInput: detail.taskRunConfig.visualSeedInput,
    }),
    "utf8",
  )
  writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(detail, null, 2), "utf8")
  return dir
}

async function fileExists(filePath: string) {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

export async function buildTaskDocumentAssetRecords(input: {
  taskId: string
  taskDir: string
  createdAt: string
}): Promise<AssetRecord[]> {
  const candidates: Array<{
    id: string
    assetType: AssetRecord["assetType"]
    label: string
    path: string
  }> = [
    { id: `${input.taskId}_script`, assetType: "script", label: "英文脚本", path: path.join(input.taskDir, "script.txt") },
    { id: `${input.taskId}_source_script`, assetType: "source_script", label: "任务母本", path: path.join(input.taskDir, "source-script.txt") },
    { id: `${input.taskId}_planning_prompt`, assetType: "planning_prompt", label: "文本规划提示词", path: path.join(input.taskDir, "planning-prompt.txt") },
    { id: `${input.taskId}_planning_response`, assetType: "planning_response", label: "文本模型原始返回", path: path.join(input.taskDir, "planning-response.txt") },
    { id: `${input.taskId}_planning_audit`, assetType: "planning_audit", label: "文本规划审计 JSON", path: path.join(input.taskDir, "planning-audit.json") },
    { id: `${input.taskId}_visual_plan`, assetType: "visual_plan", label: "视觉计划 JSON", path: path.join(input.taskDir, "visual-plan.json") },
    { id: `${input.taskId}_keyframe_prompt_summary`, assetType: "keyframe_prompt_summary", label: "关键画面提示词汇总", path: path.join(input.taskDir, "keyframe-prompt-summary.txt") },
    { id: `${input.taskId}_storyboard`, assetType: "storyboard", label: "分镜 JSON", path: path.join(input.taskDir, "storyboard.json") },
  ]

  const assets: AssetRecord[] = []
  for (const candidate of candidates) {
    if (await fileExists(candidate.path)) {
      assets.push({
        id: candidate.id,
        taskId: input.taskId,
        assetType: candidate.assetType,
        label: candidate.label,
        status: "ready",
        path: candidate.path,
        createdAt: input.createdAt,
      })
    }
  }

  return assets
}

export async function buildKeyframeAssetRecords(input: {
  taskId: string
  manifestPath: string
  label: string
  createdAt: string
}): Promise<AssetRecord[]> {
  const assets: AssetRecord[] = [
    {
      id: `${input.taskId}_keyframes`,
      taskId: input.taskId,
      assetType: "keyframe_bundle",
      label: input.label,
      status: "ready",
      path: input.manifestPath,
      createdAt: input.createdAt,
    },
  ]

  const rawManifest = await fs.readFile(input.manifestPath, "utf8")
  const manifest = JSON.parse(rawManifest) as {
    frames?: Array<{
      sceneId?: string
      sceneIndex?: number
      title?: string
      fileName?: string
      filePath?: string
    }>
  }

  for (const frame of manifest.frames ?? []) {
    const sceneId = `${frame.sceneId ?? `scene_${frame.sceneIndex ?? assets.length}`}`.trim()
    const sceneIndex = typeof frame.sceneIndex === "number" ? frame.sceneIndex : assets.length - 1
    const imagePath = frame.filePath?.trim()
      ? frame.filePath.trim()
      : frame.fileName
        ? path.join(path.dirname(input.manifestPath), frame.fileName)
        : null
    if (!imagePath) {
      continue
    }

    assets.push({
      id: `${input.taskId}_keyframe_${sceneId}`,
      taskId: input.taskId,
      assetType: "keyframe_image",
      label: `关键画面 ${sceneIndex + 1}${frame.title ? ` · ${frame.title}` : ""}`,
      status: "ready",
      path: imagePath,
      createdAt: input.createdAt,
    })
  }

  return assets
}

export async function buildProgressAssetRecords(input: {
  taskId: string
  taskDir: string
  createdAt: string
  keyframeManifestPath?: string | null
  keyframeLabel?: string | null
}): Promise<AssetRecord[]> {
  const documentAssets = await buildTaskDocumentAssetRecords({
    taskId: input.taskId,
    taskDir: input.taskDir,
    createdAt: input.createdAt,
  })

  const keyframeAssets =
    input.keyframeManifestPath && input.keyframeLabel
      ? await buildKeyframeAssetRecords({
          taskId: input.taskId,
          manifestPath: input.keyframeManifestPath,
          label: input.keyframeLabel,
          createdAt: input.createdAt,
        })
      : []

  return [...documentAssets, ...keyframeAssets]
}

export type PartialAssetRetryScope = "scene" | "keyframe" | "video"

export async function retryPartialTaskAssets(input: {
  taskId: string
  detail: TaskDetail
  scope: PartialAssetRetryScope
  sceneId: string
  imageModel: string
  videoModel: string
  blueprintRecord?: TaskBlueprintRecord | null
  signal?: AbortSignal
}, deps: {
  createKeyframeBundle?: typeof createKeyframeBundle
  createSceneVideoBundle?: typeof createSceneVideoBundle
  buildFinalVideoWithNarration?: typeof buildFinalVideoWithNarration
  synthesizeNarration?: typeof synthesizeNarration
} = {}) {
  const scene = input.detail.scenes.find((item) => item.id === input.sceneId)
  if (!scene) {
    throw new Error(`Partial retry scene not found: ${input.sceneId}`)
  }

  const createdAt = new Date().toISOString()
  const taskDir = ensureTaskDir(input.taskId)
  const runtime = resolveRuntimeGenerationConfig(input.detail)
  const runtimeLabels = buildWorkerRuntimeLabels(runtime, {
    sceneCount: input.detail.scenes.length,
    targetDurationSec: input.detail.taskRunConfig.targetDurationSec,
    keyframeCount: input.detail.scenes.length,
  })
  const createNarrowKeyframes = deps.createKeyframeBundle ?? createKeyframeBundle
  const createNarrowSceneVideos = deps.createSceneVideoBundle ?? createSceneVideoBundle
  const buildFinalVideo = deps.buildFinalVideoWithNarration ?? buildFinalVideoWithNarration
  const createNarration = deps.synthesizeNarration ?? synthesizeNarration

  let keyframeManifestPath = input.blueprintRecord?.keyframeManifestPath ?? path.join(taskDir, "keyframes", "manifest.json")
  let keyframeFrameCount = input.detail.scenes.length
  const assets: AssetRecord[] = [
    ...await buildTaskDocumentAssetRecords({
      taskId: input.taskId,
      taskDir,
      createdAt,
    }),
  ]

  if (input.scope === "keyframe" || input.scope === "scene") {
    const keyframes = await createNarrowKeyframes({
      taskId: input.taskId,
      detail: input.detail,
      model: input.imageModel,
      sceneIds: [scene.id],
      signal: input.signal,
    })
    keyframeManifestPath = keyframes.manifestPath
    keyframeFrameCount = keyframes.frameCount
  } else {
    const existingKeyframes = await readKeyframeBundleSnapshot(keyframeManifestPath)
    keyframeFrameCount = existingKeyframes?.frameCount ?? keyframeFrameCount
  }

  if (await fileExists(keyframeManifestPath)) {
    assets.push(
      ...await buildKeyframeAssetRecords({
        taskId: input.taskId,
        manifestPath: keyframeManifestPath,
        label: buildWorkerRuntimeLabels(runtime, {
          sceneCount: input.detail.scenes.length,
          targetDurationSec: input.detail.taskRunConfig.targetDurationSec,
          keyframeCount: keyframeFrameCount,
        }).keyframes,
        createdAt,
      }),
    )
  }

  if (input.scope === "keyframe") {
    return {
      phase: "review_ready" as const,
      sceneId: scene.id,
      keyframeManifestPath,
      assets,
      actualDurationSec: null,
    }
  }

  const sceneVideos = await createNarrowSceneVideos({
    taskId: input.taskId,
    detail: input.detail,
    model: input.videoModel,
    sceneIds: [scene.id],
    blueprintRecord: input.blueprintRecord ?? null,
    signal: input.signal,
  })
  const generatedSceneVideo = sceneVideos.find((video) => video.sceneId === scene.id) ?? sceneVideos[0]
  if (!generatedSceneVideo) {
    throw new Error(`Partial retry did not produce a scene video for ${scene.id}`)
  }

  const sourceVideoPaths = input.detail.scenes.map((item) => path.join(taskDir, "video", `scene-${item.index + 1}.mp4`))
  const missingSceneVideo = await Promise.all(sourceVideoPaths.map(async (videoPath) => ({
    videoPath,
    exists: await fileExists(videoPath),
  }))).then((items) => items.find((item) => !item.exists) ?? null)
  if (missingSceneVideo) {
    throw new Error(`Cannot rebuild final video because scene video is missing: ${missingSceneVideo.videoPath}`)
  }

  let narrationPath = path.join(taskDir, "narration.mp3")
  let subtitlesPath = path.join(taskDir, "subtitles.srt")
  if (!(await fileExists(narrationPath)) || !(await fileExists(subtitlesPath))) {
    const narration = await createNarration(input.detail)
    narrationPath = narration.audioPath
    subtitlesPath = narration.srtPath
  }

  const finalVideo = await buildFinalVideo({
    taskId: input.taskId,
    sourceVideoPaths,
    narrationPath,
    subtitlesPath,
    renderSpec: input.detail.taskRunConfig.renderSpecJson,
    targetDurationSec: input.detail.taskRunConfig.targetDurationSec,
    audioStrategy: input.detail.taskRunConfig.audioStrategy,
  })

  assets.push(
    {
      id: `${input.taskId}_scene_video_${scene.id}`,
      taskId: input.taskId,
      assetType: "scene_video",
      label: `分段视频 ${scene.index + 1} · ${scene.title}`,
      status: "ready",
      path: generatedSceneVideo.videoPath,
      createdAt,
    },
    {
      id: `${input.taskId}_subtitles`,
      taskId: input.taskId,
      assetType: "subtitles",
      label: "英文字幕",
      status: "ready",
      path: subtitlesPath,
      createdAt,
    },
    {
      id: `${input.taskId}_audio`,
      taskId: input.taskId,
      assetType: "audio",
      label: runtimeLabels.audio,
      status: "ready",
      path: narrationPath,
      createdAt,
    },
    {
      id: `${input.taskId}_video`,
      taskId: input.taskId,
      assetType: "video_bundle",
      label: buildWorkerRuntimeLabels(runtime, {
        sceneCount: input.detail.scenes.length,
        targetDurationSec: input.detail.taskRunConfig.targetDurationSec,
        keyframeCount: keyframeFrameCount,
      }).video,
      status: "ready",
      path: finalVideo.outputPath,
      createdAt,
    },
  )

  return {
    phase: "completed" as const,
    sceneId: scene.id,
    keyframeManifestPath,
    assets,
    actualDurationSec: finalVideo.actualDurationSec,
  }
}

export async function synthesizeNarration(detail: TaskDetail) {
  const dir = ensureTaskDir(detail.taskId)
  const runtime = resolveRuntimeGenerationConfig(detail)
  const voice = process.env.GENERGI_TTS_VOICE ?? "en-US-AvaMultilingualNeural"
  const targetDurationSec = detail.taskRunConfig.targetDurationSec
  const attempts = [0]
  const edge = runtime.ttsProvider === "edge-tts" ? new EdgeTTS() : null

  if (!edge) {
    throw new Error(`Unsupported TTS provider: ${detail.taskRunConfig.ttsProvider}`)
  }

  let result = await edge.synthesize(detail.script, voice, { rate: attempts[0], pitch: 0, volume: 0 })
  let bestDuration = await result.getDurationSeconds()
  let bestResult = result

  if (Math.abs(bestDuration - targetDurationSec) > 2) {
    const adjustedRate = resolveTtsRateForTargetDuration(bestDuration, targetDurationSec, attempts[0])
    if (adjustedRate !== attempts[0]) {
      attempts.push(adjustedRate)
      const adjustedResult = await edge.synthesize(detail.script, voice, { rate: adjustedRate, pitch: 0, volume: 0 })
      const adjustedDuration = await adjustedResult.getDurationSeconds()
      if (Math.abs(adjustedDuration - targetDurationSec) < Math.abs(bestDuration - targetDurationSec)) {
        bestResult = adjustedResult
        bestDuration = adjustedDuration
      }
    }
  }

  const audioPath = path.join(dir, "narration.mp3")
  const alignedSrtPath = path.join(dir, "subtitles.srt")
  await bestResult.toFile(audioPath)
  writeFileSync(alignedSrtPath, bestResult.getCaptionSrtString(), "utf8")
  const subtitles = await createSubtitleProvider(runtime.subtitleStrategy).generate({
    taskId: detail.taskId,
    audioPath,
    alignedSrtPath,
    outputDir: dir,
    language: detail.taskRunConfig.contentLocale,
  })
  return {
    audioPath,
    srtPath: subtitles.srtPath,
    durationSec: bestDuration,
  }
}

export async function createVideoFromPrompt(input: {
  taskId: string
  scene: StoryboardScene
  model: string
  keyframePath?: string | null
  signal?: AbortSignal
}) {
  if (!gatewayApiKey) {
    throw new Error("GENERGI_MEDIA_GATEWAY_API_KEY is missing")
  }

  let conditioningImage: string | null = null
  if (input.keyframePath) {
    try {
      const bytes = await fs.readFile(input.keyframePath)
      conditioningImage = `data:image/${path.extname(input.keyframePath).replace(".", "") || "png"};base64,${bytes.toString("base64")}`
    } catch {
      conditioningImage = null
    }
  }

  let createResponse
  let lastCreateError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      throwIfTaskCanceled(input.signal)
      createResponse = await axios.post(
        `${gatewayBaseUrl}/v1/video/generations`,
        {
          model: normalizeVideoModel(input.model),
          prompt: input.scene.videoPrompt || input.scene.script || input.scene.title,
          duration: Math.max(Math.round(input.scene.durationSec), 4),
          ...(conditioningImage ? { image: conditioningImage } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${gatewayApiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 120000,
          signal: input.signal,
        },
      )
      break
    } catch (error) {
      if (input.signal?.aborted || (axios.isAxiosError(error) && error.code === "ERR_CANCELED")) {
        throw createTaskCanceledError(input.signal)
      }
      lastCreateError = error
      const status = axios.isAxiosError(error) ? error.response?.status : null
      if (isRetryableGatewayStatus(status) && attempt < 3) {
        await sleep(2000 * attempt, input.signal)
        continue
      }
      throw error
    }
  }

  if (!createResponse) {
    throw lastCreateError instanceof Error ? lastCreateError : new Error(`Video generation create failed: ${String(lastCreateError)}`)
  }

  const taskId = createResponse.data?.task_id || createResponse.data?.id
  if (!taskId) {
    throw new Error(`Video provider did not return task id: ${JSON.stringify(createResponse.data)}`)
  }

  const deadline = Date.now() + 15 * 60 * 1000
  while (Date.now() < deadline) {
    await sleep(5000, input.signal)
    const pollResponse = await axios.get(`${gatewayBaseUrl}/v1/video/generations/${taskId}`, {
      headers: {
        Authorization: `Bearer ${gatewayApiKey}`,
      },
      timeout: 120000,
      signal: input.signal,
    })

    const status = `${pollResponse.data?.data?.status || pollResponse.data?.data?.data?.status || ""}`.toLowerCase()
    const videoUrl =
      pollResponse.data?.data?.data?.video_url ||
      pollResponse.data?.data?.video_url ||
      pollResponse.data?.data?.result_url ||
      pollResponse.data?.result_url

    if (status === "success" || status === "completed") {
      if (!videoUrl) {
        throw new Error(`Video generation succeeded but no video URL was returned: ${JSON.stringify(pollResponse.data)}`)
      }

      const dir = ensureTaskDir(input.taskId)
      const targetPath = path.join(dir, "video", `scene-${input.scene.index + 1}.mp4`)
      const download = await axios.get<ArrayBuffer>(videoUrl, {
        responseType: "arraybuffer",
        timeout: 300000,
        signal: input.signal,
      })
      await writeFileAtomic(targetPath, Buffer.from(download.data))
      return { videoPath: targetPath, remoteTaskId: taskId }
    }

    if (status === "failed" || status === "error") {
      throw new Error(`Video generation failed: ${JSON.stringify(pollResponse.data)}`)
    }
  }

  throw new Error(`Video generation polling timed out for task ${taskId}`)
}

export async function createSceneVideoBundle(input: {
  taskId: string
  detail: TaskDetail
  model: string
  sceneIds?: string[]
  blueprintRecord?: TaskBlueprintRecord | null
  onSceneStart?: (scene: StoryboardScene, totalScenes: number) => Promise<void> | void
  signal?: AbortSignal
}, deps: {
  createVideoFromPrompt?: typeof createVideoFromPrompt
} = {}) {
  const sceneInputs = await buildSceneVideoGenerationInputs({
    detail: input.detail,
    blueprintRecord: input.blueprintRecord ?? null,
  })
  const requestedSceneIds = input.sceneIds?.length ? new Set(input.sceneIds) : null
  const targetSceneInputs = requestedSceneIds
    ? sceneInputs.filter((sceneInput) => requestedSceneIds.has(sceneInput.scene.id))
    : sceneInputs
  if (requestedSceneIds && targetSceneInputs.length !== requestedSceneIds.size) {
    throw new Error(`Scene video retry target not found: ${[...requestedSceneIds].join(", ")}`)
  }
  const createSceneVideo = deps.createVideoFromPrompt ?? createVideoFromPrompt
  const videos = await mapWithConcurrencyLimit(
    targetSceneInputs,
    resolveSceneVideoConcurrency(),
    async (sceneInput) => {
      await input.onSceneStart?.(sceneInput.scene, targetSceneInputs.length)

      let timeout: ReturnType<typeof setTimeout> | null = null
      const video = await Promise.race([
        createSceneVideo({
          taskId: input.taskId,
          scene: sceneInput.scene,
          model: input.model,
          keyframePath: sceneInput.keyframePath,
          signal: input.signal,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Scene ${sceneInput.scene.index + 1} video generation timeout`)),
            resolveSceneVideoTimeoutMs(),
          )
        }),
      ]).finally(() => {
        if (timeout) {
          clearTimeout(timeout)
        }
      })
      return {
        ...video,
        sceneId: sceneInput.scene.id,
        sceneIndex: sceneInput.scene.index,
        durationSec: sceneInput.scene.durationSec,
        inputStrategy: sceneInput.inputStrategy,
        keyframePath: sceneInput.keyframePath,
      }
    },
  )
  return videos
}

export async function createKeyframeBundle(input: {
  taskId: string
  detail: TaskDetail
  model: string
  sceneIds?: string[]
  signal?: AbortSignal
  onSceneStart?: (scene: StoryboardScene, totalScenes: number) => Promise<void> | void
}, deps: {
  createGeminiNativeImageArtifact?: typeof createGeminiNativeImageArtifact
  createGatewayImageArtifact?: typeof createGatewayImageArtifact
  createOpenAIImagesGenerationArtifact?: typeof createOpenAIImagesGenerationArtifact
  createOpenAIImagesGenerationArtifacts?: typeof createOpenAIImagesGenerationArtifacts
  splitCompositeGridArtifact?: typeof splitCompositeGridArtifact
} = {}) {
  const dir = ensureTaskDir(input.taskId)
  const keyframeDir = path.join(dir, "keyframes")
  mkdirSync(keyframeDir, { recursive: true })

  const createdAt = new Date().toISOString()
  const aspectRatio = input.detail.taskRunConfig.aspectRatio
  const requestedSceneIds = input.sceneIds?.length ? new Set(input.sceneIds) : null
  const targetScenes = requestedSceneIds
    ? input.detail.scenes.filter((scene) => requestedSceneIds.has(scene.id))
    : input.detail.scenes
  if (requestedSceneIds && targetScenes.length !== requestedSceneIds.size) {
    throw new Error(`Keyframe retry target not found: ${[...requestedSceneIds].join(", ")}`)
  }
  const manifestPath = path.join(keyframeDir, "manifest.json")
  const existingFrames: Array<{
    sceneId?: string
    sceneIndex?: number
    title?: string
    prompt?: string
    fileName?: string
    filePath?: string
    model?: string
    remoteTaskId?: string | null
  }> = requestedSceneIds
    ? await fs.readFile(manifestPath, "utf8")
        .then((rawManifest) => {
          const manifest = JSON.parse(rawManifest) as {
            frames?: Array<{
              sceneId?: string
              sceneIndex?: number
              title?: string
              prompt?: string
              fileName?: string
              filePath?: string
              model?: string
              remoteTaskId?: string | null
            }>
          }
          return Array.isArray(manifest.frames) ? manifest.frames : []
        })
        .catch(() => [])
    : []
  const frames: Array<{
    sceneId: string
    sceneIndex: number
    title: string
    prompt?: string
    fileName: string
    filePath: string
    model?: string
    remoteTaskId?: string | null
    promptSource?: KeyframePromptSource
    executionBriefKeyframeIndex?: number | null
    timestampRange?: string | null
    narrativeRole?: string | null
    visualGoal?: string | null
    promptHash?: string
    imagePromptHash?: string
    promptSummary?: string
    generationMode?: "batch" | "single"
    batchId?: string | null
    batchIndex?: number | null
    cropSourceFileName?: string | null
    cropPanelRect?: { x: number; y: number; width: number; height: number } | null
  }> = []
  const imageRuntime = await resolveImageGenerationRuntime(input.detail, input.model)
  const imageFallbackCandidates = (input.detail.taskRunConfig.slotSnapshots ?? [])
    .find((slot) => slot.slotType === "imageModel")
    ?.fallbackCandidates ?? []
  const imageFallbackRuntimes = imageFallbackCandidates.length
    ? await resolveOpenAIImagesFallbackRuntimes(input.detail)
    : []
  const imageModelTrace =
    imageRuntime.kind === "openai-images-generation"
      ? {
          providerId: imageRuntime.providerId,
          providerKey: imageRuntime.providerKey,
          modelId: imageRuntime.model,
          providerModelId: imageRuntime.providerModelId,
          wireApi: "images_generations",
          requestPath: "/v1/images/generations",
        }
      : imageRuntime.kind === "openai-chat-image"
        ? {
            providerId: imageRuntime.providerId,
            providerKey: imageRuntime.providerKey,
            modelId: imageRuntime.model,
            providerModelId: imageRuntime.providerModelId,
            wireApi: "chat_completions",
            requestPath: "/v1/chat/completions",
          }
        : imageRuntime.kind === "gemini-native"
          ? {
              providerId: imageRuntime.providerId,
              providerKey: imageRuntime.providerKey,
              modelId: imageRuntime.model,
              providerModelId: imageRuntime.providerModelId,
              wireApi: "gemini_generate_content",
              requestPath: ":generateContent",
            }
          : {
              providerId: null,
              providerKey: "gateway",
              modelId: imageRuntime.model,
              providerModelId: imageRuntime.model,
              wireApi: "gateway_image",
              requestPath: "/v1/images/generations",
            }
  const createGeminiArtifact = deps.createGeminiNativeImageArtifact ?? createGeminiNativeImageArtifact
  const createGatewayArtifact = deps.createGatewayImageArtifact ?? createGatewayImageArtifact
  const createOpenAIImagesArtifact = deps.createOpenAIImagesGenerationArtifact ?? createOpenAIImagesGenerationArtifact
  const createOpenAIImagesArtifacts = deps.createOpenAIImagesGenerationArtifacts ?? createOpenAIImagesGenerationArtifacts
  const splitCompositeGrid = deps.splitCompositeGridArtifact ?? splitCompositeGridArtifact
  const hashPrompt = (prompt: string) => createHash("sha256").update(prompt).digest("hex").slice(0, 16)
  const modelFallbackEvents: Array<{
    at: string
    trigger: string
    reason: string
    fromModel: string
    toModel: string
  }> = []
  const findFallbackRuntime = (error: unknown) => {
    const trigger = getImageFallbackTrigger(error)
    if (!trigger) {
      return null
    }
    const runtime = imageFallbackRuntimes.find((candidate) => candidate.fallbackTriggers.includes(trigger)) ?? null
    return runtime ? { trigger, runtime } : null
  }
  const getRuntimeModelId = (runtime: ImageGenerationRuntime) =>
    runtime.kind === "gateway" ? runtime.model : runtime.providerModelId
  const createImageArtifactWithFallback = async (prompt: string) => {
    try {
      const artifact =
        imageRuntime.kind === "gemini-native"
          ? await createGeminiArtifact({
              baseUrl: imageRuntime.baseUrl,
              apiKey: imageRuntime.apiKey,
              model: imageRuntime.providerModelId,
              prompt,
              signal: input.signal,
            })
          : imageRuntime.kind === "openai-chat-image"
            ? await createOpenAIChatCompletionsImageArtifact({
                baseUrl: imageRuntime.baseUrl,
                apiKey: imageRuntime.apiKey,
                model: imageRuntime.providerModelId,
                prompt,
                size: "1024x1024",
                signal: input.signal,
              })
            : imageRuntime.kind === "openai-images-generation"
              ? await createOpenAIImagesArtifact({
                  baseUrl: imageRuntime.baseUrl,
                  apiKey: imageRuntime.apiKey,
                  model: imageRuntime.providerModelId,
                  prompt,
                  size: "1024x1024",
                  quality: imageRuntime.quality,
                  responseFormat: imageRuntime.responseFormat,
                  signal: input.signal,
                })
              : await createGatewayArtifact({
                  model: imageRuntime.model,
                  prompt,
                  size: "1024x1024",
                  signal: input.signal,
                })
      return { artifact, runtime: imageRuntime }
    } catch (error) {
      const fallback = findFallbackRuntime(error)
      if (!fallback) {
        throw error
      }
      modelFallbackEvents.push({
        at: new Date().toISOString(),
        trigger: fallback.trigger,
        reason: error instanceof Error ? error.message : String(error),
        fromModel: getRuntimeModelId(imageRuntime),
        toModel: fallback.runtime.providerModelId,
      })
      const artifact = await createOpenAIImagesArtifact({
        baseUrl: fallback.runtime.baseUrl,
        apiKey: fallback.runtime.apiKey,
        model: fallback.runtime.providerModelId,
        prompt,
        size: "1024x1024",
        quality: fallback.runtime.quality,
        responseFormat: fallback.runtime.responseFormat,
        signal: input.signal,
      })
      return { artifact, runtime: fallback.runtime }
    }
  }
  const createOpenAIImagesBatchWithFallback = async (inputBatch: {
    prompt: string
    count: number
    size: string
  }) => {
    if (imageRuntime.kind !== "openai-images-generation") {
      throw new Error("Batch keyframes require OpenAI images generation runtime")
    }
    try {
      const artifacts = await createOpenAIImagesArtifacts({
        baseUrl: imageRuntime.baseUrl,
        apiKey: imageRuntime.apiKey,
        model: imageRuntime.providerModelId,
        prompt: inputBatch.prompt,
        count: inputBatch.count,
        size: inputBatch.size,
        quality: imageRuntime.quality,
        responseFormat: imageRuntime.responseFormat,
        signal: input.signal,
      })
      return { artifacts, runtime: imageRuntime }
    } catch (error) {
      const fallback = findFallbackRuntime(error)
      if (!fallback) {
        throw error
      }
      modelFallbackEvents.push({
        at: new Date().toISOString(),
        trigger: fallback.trigger,
        reason: error instanceof Error ? error.message : String(error),
        fromModel: imageRuntime.providerModelId,
        toModel: fallback.runtime.providerModelId,
      })
      const artifacts = await createOpenAIImagesArtifacts({
        baseUrl: fallback.runtime.baseUrl,
        apiKey: fallback.runtime.apiKey,
        model: fallback.runtime.providerModelId,
        prompt: inputBatch.prompt,
        count: inputBatch.count,
        size: inputBatch.size,
        quality: fallback.runtime.quality,
        responseFormat: fallback.runtime.responseFormat,
        signal: input.signal,
      })
      return { artifacts, runtime: fallback.runtime }
    }
  }
  const executionBrief = input.detail.taskRunConfig.executionBrief ?? null
  const executionBriefHash = executionBrief ? hashShort(executionBrief) : null
  const getFramePrompt = (scene: StoryboardScene) =>
    resolveSceneKeyframePrompt({
      detail: input.detail,
      scene,
      aspectRatio,
    })
	  const writeGeneratedFrame = async (scene: StoryboardScene, prompt: string, generated: {
	    bytes: Buffer
	    extension: string
	    generationId: string | null
	  }, metadata: {
    generationMode?: "batch" | "single"
    batchId?: string | null
    batchIndex?: number | null
    promptSource?: KeyframePromptSource
    keyframePlan?: ReturnType<typeof resolveExecutionBriefKeyframe>
	    cropSourceFileName?: string | null
	    cropPanelRect?: { x: number; y: number; width: number; height: number } | null
	    model?: string
	  } = {}) => {
    const existingFrame = existingFrames.find((frame) => frame.sceneId === scene.id || frame.sceneIndex === scene.index)
    const existingFileName = existingFrame?.fileName?.trim()
    const existingExtension = existingFileName ? path.extname(existingFileName).replace(/^\./, "").toLowerCase() : ""
    const fileName = existingFileName && existingExtension === generated.extension.toLowerCase()
      ? existingFileName
      : `scene-${String(scene.index + 1).padStart(2, "0")}.${generated.extension}`
    const filePath = path.join(keyframeDir, fileName)
    await writeFileAtomic(filePath, generated.bytes)
    return {
      sceneId: scene.id,
      sceneIndex: scene.index,
      title: scene.title,
      prompt,
      fileName,
      filePath,
	      model: metadata.model ?? input.model,
      remoteTaskId: generated.generationId,
      generationMode: metadata.generationMode ?? input.detail.taskRunConfig.keyframeGenerationMode,
      batchId: metadata.batchId ?? null,
      batchIndex: metadata.batchIndex ?? null,
      promptSource: metadata.promptSource ?? "scene.imagePrompt",
      executionBriefKeyframeIndex: metadata.keyframePlan?.index ?? null,
      timestampRange: metadata.keyframePlan?.timestampRange ?? null,
      narrativeRole: metadata.keyframePlan?.narrativeRole ?? null,
      visualGoal: metadata.keyframePlan?.visualGoal ?? null,
      promptHash: hashPrompt(prompt),
      imagePromptHash: hashPrompt(prompt),
      promptSummary: prompt.slice(0, 240),
      cropSourceFileName: metadata.cropSourceFileName ?? null,
      cropPanelRect: metadata.cropPanelRect ?? null,
    }
  }
  const generateSingleFrame = async (scene: StoryboardScene) => {
    throwIfTaskCanceled(input.signal)
    await input.onSceneStart?.(scene, targetScenes.length)
    const framePrompt = getFramePrompt(scene)
    const prompt = framePrompt.prompt
    const generated = await createImageArtifactWithFallback(prompt)

    return writeGeneratedFrame(scene, prompt, generated.artifact, {
      generationMode: "single",
      promptSource: framePrompt.promptSource,
      keyframePlan: framePrompt.keyframePlan,
      model: getRuntimeModelId(generated.runtime),
    })
  }
  type GeneratedFrameRecord = {
    sceneId: string
    sceneIndex: number
    title: string
    prompt?: string
    fileName: string
    filePath: string
    model?: string
    remoteTaskId?: string | null
    generationMode?: "batch" | "single"
    batchId?: string | null
    batchIndex?: number | null
    promptHash?: string
    promptSummary?: string
    promptSource?: KeyframePromptSource
    executionBriefKeyframeIndex?: number | null
    timestampRange?: string | null
    narrativeRole?: string | null
    visualGoal?: string | null
    imagePromptHash?: string
    cropSourceFileName?: string | null
    cropPanelRect?: { x: number; y: number; width: number; height: number } | null
  }
  let createdFrames: GeneratedFrameRecord[] | null = null
  const batchGroups: Array<{
    batchId: string
    requestedCount: number
    returnedCount: number
    elapsedMs: number
    providerId: string
    modelId: string
    providerModelId: string
    promptHash: string
    frameIndexes: number[]
    fallbackUsed: boolean
    returnMode?: "api_multi_image" | "composite_grid"
    compositeLayout?: string | null
    compositeSize?: string | null
    panelSize?: string | null
  }> = []
  const fallbackEvents: Array<{
    at: string
    reason: string
    from: "batch"
    to: "single"
    affectedFrameIndexes: number[]
  }> = []
  const shouldUseBatchKeyframes =
    !requestedSceneIds &&
    input.detail.taskRunConfig.keyframeGenerationMode === "batch" &&
    imageRuntime.kind === "openai-images-generation" &&
    targetScenes.length > 1

  if (shouldUseBatchKeyframes) {
    for (const scene of targetScenes) {
      throwIfTaskCanceled(input.signal)
      await input.onSceneStart?.(scene, targetScenes.length)
    }

    const maxBatchImages = Math.max(1, imageRuntime.maxBatchImages ?? targetScenes.length)
    const batchCreatedFrames: GeneratedFrameRecord[] = []
    for (let startIndex = 0; startIndex < targetScenes.length; startIndex += maxBatchImages) {
      const batchScenes = targetScenes.slice(startIndex, startIndex + maxBatchImages)
      const batchId = `batch-${batchGroups.length + 1}`
      const explicitLayout = parseCompositeLayout(imageRuntime.compositeGridLayout)
      const layoutMatchesSceneCount = explicitLayout
        ? explicitLayout.columns * explicitLayout.rows === batchScenes.length
        : false
      const compositeLayout = resolveCompositeGridLayout(batchScenes.length, aspectRatio, {
        layout: layoutMatchesSceneCount ? imageRuntime.compositeGridLayout : undefined,
        size: layoutMatchesSceneCount ? imageRuntime.compositeGridSize : undefined,
      })
      const useCompositeGrid = imageRuntime.batchReturnMode === "composite_grid" && batchScenes.length > 1
      const promptReadyScenes = batchScenes.map((scene) => {
        const framePrompt = getFramePrompt(scene)
        return buildPromptReadyScene(scene, framePrompt.prompt, framePrompt.keyframePlan?.visualGoal)
      })
      const prompt = useCompositeGrid
        ? buildCompositeGridKeyframePrompt({
            scenes: promptReadyScenes,
            aspectRatio,
            visualSeedInput: input.detail.taskRunConfig.visualSeedInput,
            layout: compositeLayout,
          })
        : buildBatchKeyframePrompt({
            scenes: promptReadyScenes,
            aspectRatio,
            visualSeedInput: input.detail.taskRunConfig.visualSeedInput,
          })

      try {
        const batchStartedAt = Date.now()
        const batchResult = await createOpenAIImagesBatchWithFallback({
          prompt,
          count: batchScenes.length,
          size: useCompositeGrid ? compositeLayout.size : "1024x1024",
        })
        const generatedArtifacts = batchResult.artifacts

        const compositePanels = useCompositeGrid && generatedArtifacts.length === 1
          ? await splitCompositeGrid({
              artifact: generatedArtifacts[0],
              scenes: batchScenes,
              layout: compositeLayout,
              workDir: keyframeDir,
              signal: input.signal,
            })
          : []
        const returnedCount = useCompositeGrid && compositePanels.length
          ? Math.min(compositePanels.length, batchScenes.length)
          : Math.min(generatedArtifacts.length, batchScenes.length)
        batchGroups.push({
          batchId,
          requestedCount: batchScenes.length,
          returnedCount,
          elapsedMs: Date.now() - batchStartedAt,
          providerId: batchResult.runtime.providerId,
          modelId: batchResult.runtime.model,
          providerModelId: batchResult.runtime.providerModelId,
          promptHash: hashPrompt(prompt),
          frameIndexes: batchScenes.slice(0, returnedCount).map((scene) => scene.index),
          fallbackUsed: returnedCount < batchScenes.length,
          returnMode: useCompositeGrid ? "composite_grid" : "api_multi_image",
          compositeLayout: useCompositeGrid ? compositeLayout.label : null,
          compositeSize: useCompositeGrid ? compositeLayout.size : null,
          panelSize: useCompositeGrid ? `${compositeLayout.panelWidth}x${compositeLayout.panelHeight}` : null,
        })

        if (useCompositeGrid && compositePanels.length) {
          batchCreatedFrames.push(
            ...await Promise.all(
              compositePanels.slice(0, returnedCount).map((panel) => {
                const framePrompt = getFramePrompt(panel.scene)
                return writeGeneratedFrame(panel.scene, framePrompt.prompt, {
                  bytes: panel.bytes,
                  extension: panel.extension,
                  generationId: panel.generationId,
                }, {
                  generationMode: "batch",
                  batchId,
                  batchIndex: panel.batchIndex,
                  promptSource: framePrompt.promptSource,
                  keyframePlan: framePrompt.keyframePlan,
	                  cropSourceFileName: "cropSourceFileName" in panel ? panel.cropSourceFileName : null,
	                  cropPanelRect: "cropPanelRect" in panel ? panel.cropPanelRect : null,
	                  model: batchResult.runtime.providerModelId,
	                })
              }),
            ),
          )
        } else {
          batchCreatedFrames.push(
            ...await Promise.all(
              batchScenes.slice(0, returnedCount).map((scene, index) => {
                const framePrompt = getFramePrompt(scene)
                return writeGeneratedFrame(scene, framePrompt.prompt, generatedArtifacts[index], {
                  generationMode: "batch",
                  batchId,
                  batchIndex: index,
	                  promptSource: framePrompt.promptSource,
	                  keyframePlan: framePrompt.keyframePlan,
	                  model: batchResult.runtime.providerModelId,
	                })
              }),
            ),
          )
        }
        const missingScenes = batchScenes.slice(returnedCount)
        if (missingScenes.length) {
          fallbackEvents.push({
            at: new Date().toISOString(),
            reason: `Batch image response returned ${returnedCount}/${batchScenes.length} frames`,
            from: "batch",
            to: "single",
            affectedFrameIndexes: missingScenes.map((scene) => scene.index),
          })
          batchCreatedFrames.push(...await Promise.all(missingScenes.map((scene) => generateSingleFrame(scene))))
        }
      } catch (error) {
        fallbackEvents.push({
          at: new Date().toISOString(),
          reason: error instanceof Error ? error.message : "Batch image generation failed",
          from: "batch",
          to: "single",
          affectedFrameIndexes: batchScenes.map((scene) => scene.index),
        })
        batchCreatedFrames.push(...await Promise.all(batchScenes.map((scene) => generateSingleFrame(scene))))
      }
    }
    createdFrames = batchCreatedFrames
  }
  if (!createdFrames) {
    createdFrames = await Promise.all(targetScenes.map((scene) => generateSingleFrame(scene)))
  }
  const replacedKeys = new Set(createdFrames.map((frame) => `${frame.sceneId}:${frame.sceneIndex}`))
  const preservedFrames = existingFrames
    .filter((frame) => !replacedKeys.has(`${frame.sceneId ?? ""}:${frame.sceneIndex ?? -1}`))
    .filter((frame): frame is typeof frame & { sceneId: string; sceneIndex: number; fileName: string; filePath: string } =>
      typeof frame.sceneId === "string" &&
      typeof frame.sceneIndex === "number" &&
      typeof frame.fileName === "string" &&
      typeof frame.filePath === "string"
    )
    .map((frame) => ({
      ...frame,
      title: typeof frame.title === "string"
        ? frame.title
        : input.detail.scenes.find((scene) => scene.id === frame.sceneId || scene.index === frame.sceneIndex)?.title ?? frame.sceneId,
    }))
  frames.push(...[...preservedFrames, ...createdFrames].sort((left, right) => left.sceneIndex - right.sceneIndex))

  const promptSources = new Set(frames.map((frame) => frame.promptSource ?? "scene.imagePrompt"))
  const firstBatchGroup = batchGroups[0] ?? null
  const manifest = {
    taskId: input.taskId,
    createdAt,
    model:
      imageRuntime.kind === "gateway"
        ? imageRuntime.model
        : imageRuntime.providerModelId,
    aspectRatio,
    version: "keyframe-manifest-v3",
    keyframeGenerationMode: input.detail.taskRunConfig.keyframeGenerationMode,
    promptCompilerVersion: "visual-execution-prompt-v1",
    promptSource: promptSources.size === 1 ? [...promptSources][0] : "mixed",
    finalPromptLanguage: executionBrief ? executionBrief.finalPromptLanguage : null,
    executionBriefVersion: executionBrief?.version ?? null,
    executionBriefHash,
    modelTrace: imageModelTrace,
    returnMode: firstBatchGroup?.returnMode ?? "single_image",
    compositeLayout: firstBatchGroup?.compositeLayout ?? null,
    compositeSize: firstBatchGroup?.compositeSize ?? null,
    panelSize: firstBatchGroup?.panelSize ?? null,
    requestedFrameCount: targetScenes.length,
    returnedFrameCount: createdFrames.length,
    batchGroups,
    fallbackEvents,
    modelFallbackEvents,
    sceneCount: frames.length,
    frames,
  }
  await writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2))

  return {
    keyframeDir,
    manifestPath,
    frameCount: frames.length,
  }
}

export async function createFallbackKeyframeBundleFromVideo(input: {
  taskId: string
  scene: StoryboardScene
  videoPath: string
}) {
  const dir = ensureTaskDir(input.taskId)
  const keyframeDir = path.join(dir, "keyframes")
  mkdirSync(keyframeDir, { recursive: true })

  const fileName = `scene-${String(input.scene.index + 1).padStart(2, "0")}.jpg`
  const filePath = path.join(keyframeDir, fileName)
  await extractKeyframeFromVideo({
    videoPath: input.videoPath,
    outputPath: filePath,
    timeSeconds: 0.2,
  })

  const manifestPath = path.join(keyframeDir, "manifest.json")
  const manifest = {
    taskId: input.taskId,
    createdAt: new Date().toISOString(),
    source: "video-fallback",
    sceneCount: 1,
    frames: [
      {
        sceneId: input.scene.id,
        sceneIndex: input.scene.index,
        title: input.scene.title,
        fileName,
        filePath,
        derivedFrom: input.videoPath,
      },
    ],
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
  return {
    keyframeDir,
    manifestPath,
    frameCount: 1,
  }
}

export async function createFallbackKeyframeBundleFromVideos(
  input: {
    taskId: string
    scenes: Array<Pick<StoryboardScene, "id" | "index" | "title">>
    sceneVideos: Array<{
      sceneId: string
      sceneIndex: number
      videoPath: string
    }>
  },
  options: {
    extractor?: typeof extractKeyframeFromVideo
  } = {},
) {
  const dir = ensureTaskDir(input.taskId)
  const keyframeDir = path.join(dir, "keyframes")
  mkdirSync(keyframeDir, { recursive: true })
  const extractor = options.extractor ?? extractKeyframeFromVideo

  const frames = []

  for (const sceneVideo of input.sceneVideos) {
    const scene = input.scenes.find((item) => item.id === sceneVideo.sceneId || item.index === sceneVideo.sceneIndex)
    if (!scene) {
      continue
    }

    const fileName = `scene-${String(scene.index + 1).padStart(2, "0")}.jpg`
    const filePath = path.join(keyframeDir, fileName)
    await extractor({
      videoPath: sceneVideo.videoPath,
      outputPath: filePath,
      timeSeconds: 0.2,
    })

    frames.push({
      sceneId: scene.id,
      sceneIndex: scene.index,
      title: scene.title,
      fileName,
      filePath,
      derivedFrom: sceneVideo.videoPath,
    })
  }

  const manifestPath = path.join(keyframeDir, "manifest.json")
  const manifest = {
    taskId: input.taskId,
    createdAt: new Date().toISOString(),
    source: "video-fallback",
    sceneCount: frames.length,
    frames,
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8")

  return {
    keyframeDir,
    manifestPath,
    frameCount: frames.length,
  }
}

export async function buildFinalVideoWithNarration(input: {
  taskId: string
  sourceVideoPaths: string[]
  narrationPath: string
  subtitlesPath?: string | null
  renderSpec?: TaskDetail["taskRunConfig"]["renderSpecJson"] | null
  targetDurationSec: number
  audioStrategy?: TaskDetail["taskRunConfig"]["audioStrategy"]
}, deps: {
  concatVideos?: typeof concatVideos
  trimVideoDuration?: typeof trimVideoDuration
  writeStyledAssSubtitleFile?: typeof writeStyledAssSubtitleFile
  muxNarrationIntoVideo?: typeof muxNarrationIntoVideo
  mixNarrationWithVideoAudio?: typeof mixNarrationWithVideoAudio
  getMediaDurationSeconds?: typeof getMediaDurationSeconds
} = {}) {
  const dir = ensureTaskDir(input.taskId)
  const stitchedVideoPath = path.join(dir, "video", "stitched-scenes.mp4")
  const trimmedVideoPath = path.join(dir, "video", "trimmed-scenes.mp4")
  const outputPath = path.join(dir, "video", "final-with-audio.mp4")
  const subtitlesAssPath = path.join(dir, "subtitles.ass")
  const concatScenes = deps.concatVideos ?? concatVideos
  const trimScenes = deps.trimVideoDuration ?? trimVideoDuration
  const writeAssSubtitles = deps.writeStyledAssSubtitleFile ?? writeStyledAssSubtitleFile
  const muxFinalVideo = deps.muxNarrationIntoVideo ?? muxNarrationIntoVideo
  const mixFinalAudio = deps.mixNarrationWithVideoAudio ?? mixNarrationWithVideoAudio
  const readDuration = deps.getMediaDurationSeconds ?? getMediaDurationSeconds
  const preserveNativeAudio = input.audioStrategy === "native_plus_tts_ducked"
  try {
    await concatScenes({
      videoPaths: input.sourceVideoPaths,
      outputPath: stitchedVideoPath,
      workingDirectory: path.join(dir, "video"),
    })
    await trimScenes({
      videoPath: stitchedVideoPath,
      outputPath: trimmedVideoPath,
      durationSec: input.targetDurationSec,
      preserveAudio: preserveNativeAudio,
    })
    if (input.subtitlesPath && input.renderSpec) {
      try {
        await writeAssSubtitles({
          srtPath: input.subtitlesPath,
          assPath: subtitlesAssPath,
          renderSpec: input.renderSpec,
        })
        if (preserveNativeAudio) {
          await mixFinalAudio({
            videoPath: trimmedVideoPath,
            audioPath: input.narrationPath,
            subtitlePath: subtitlesAssPath,
            outputPath,
          })
        } else {
          await muxFinalVideo({
            videoPath: trimmedVideoPath,
            audioPath: input.narrationPath,
            subtitlePath: subtitlesAssPath,
            outputPath,
          })
        }
      } catch (error) {
        console.warn("[worker] subtitle burn-in failed, retrying audio-only mux:", error instanceof Error ? error.message : String(error))
        await muxFinalVideo({
          videoPath: trimmedVideoPath,
          audioPath: input.narrationPath,
          outputPath,
        })
      }
    } else {
      if (preserveNativeAudio) {
        try {
          await mixFinalAudio({
            videoPath: trimmedVideoPath,
            audioPath: input.narrationPath,
            outputPath,
          })
        } catch (error) {
          console.warn("[worker] native audio mix failed, retrying narration-only mux:", error instanceof Error ? error.message : String(error))
          await muxFinalVideo({
            videoPath: trimmedVideoPath,
            audioPath: input.narrationPath,
            outputPath,
          })
        }
      } else {
        await muxFinalVideo({
          videoPath: trimmedVideoPath,
          audioPath: input.narrationPath,
          outputPath,
        })
      }
    }
  } catch (error) {
    console.warn("[worker] ffmpeg concat/mux failed, falling back to stitched source video:", error instanceof Error ? error.message : String(error))
    await fs.copyFile(input.sourceVideoPaths[0], outputPath)
  }
  return {
    outputPath,
    actualDurationSec: await readDuration({ mediaPath: outputPath }),
  }
}
