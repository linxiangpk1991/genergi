import { mkdirSync, writeFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { createDecipheriv, createHash } from "node:crypto"

import axios from "axios"

import {
  buildStoryboardScenes,
  readTaskBlueprintRecords,
  mergeSceneReviewMetadata,
  planningSceneSchema,
  resolveSceneCountForDurationWithLimit,
  resolveSceneReviewDefaults,
  readProviderRecords,
  writeTaskBlueprintRecords,
  textPlanningOutputSchema,
  type ExecutionBlueprint,
  type PlannedExecutionBlueprint,
  type StoryboardScene,
  type TaskBlueprintRecord,
  type TaskDetail,
  type TextPlanningOutput,
} from "@genergi/shared"
import { GENERATION_PREFERENCES, resolveVideoModelCapability } from "@genergi/config"
import { EdgeTTS } from "./edge-tts.js"
import { concatVideos, extractKeyframeFromVideo, getMediaDurationSeconds, muxNarrationIntoVideo, trimVideoDuration } from "./ffmpeg.js"

const gatewayBaseUrl = process.env.GENERGI_MEDIA_GATEWAY_BASE_URL ?? "https://open.xiaojingai.com"
const gatewayApiKey = process.env.GENERGI_MEDIA_GATEWAY_API_KEY ?? ""
const gatewayImageGenerationPaths = ["/v1/images/generations", "/v1/image/generations"]

function ensureTaskDir(taskId: string) {
  const root = process.env.GENERGI_DATA_DIR ?? ".data"
  const dir = path.resolve(root, "exports", taskId)
  mkdirSync(dir, { recursive: true })
  mkdirSync(path.join(dir, "video"), { recursive: true })
  mkdirSync(path.join(dir, "keyframes"), { recursive: true })
  return dir
}

function buildGatewayHeaders() {
  return {
    Authorization: `Bearer ${gatewayApiKey}`,
    "Content-Type": "application/json",
  }
}

function getModelControlMasterKey() {
  const source = process.env.GENERGI_MODEL_CONTROL_MASTER_KEY ?? "genergi-model-control-dev-key"
  return createHash("sha256").update(source).digest()
}

function decryptControlPlaneSecret(ciphertext: string) {
  const [prefix, ivEncoded, tagEncoded, payloadEncoded] = ciphertext.split(":")
  if (ciphertext && prefix !== "enc") {
    return ciphertext
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

function isRetryableGatewayStatus(status?: number | null) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
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

function buildKeyframePrompt(scene: StoryboardScene, aspectRatio: string) {
  const basePrompt = scene.imagePrompt.trim() || scene.videoPrompt.trim() || scene.title.trim()
  const orientation = aspectRatio.includes(":") ? aspectRatio : "9:16"
  return [
    basePrompt,
    `Vertical keyframe for a ${orientation} short-form social video.`,
    "Cinematic composition, premium product readability, crisp subject separation, no watermark, no UI chrome, no caption text.",
  ].join(" ")
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

export function buildPlannedExecutionBlueprint(
  detail: TaskDetail,
  planned: TextPlanningOutput,
): PlannedExecutionBlueprint {
  const sceneContracts = planned.scenePlan.map((scene, index, allScenes) => ({
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
  }))

  return {
    executionMode: detail.taskRunConfig.executionMode,
    renderSpec: detail.taskRunConfig.renderSpecJson,
    globalTheme: detail.title,
    visualStyleGuide: planned.blueprint.visualStyleGuide,
    subjectProfile: planned.blueprint.subjectProfile,
    productProfile: planned.blueprint.productProfile,
    backgroundConstraints: planned.blueprint.backgroundConstraints,
    negativeConstraints: planned.blueprint.negativeConstraints,
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

function extractImageReference(payload: any) {
  const candidates = [payload, payload?.data, payload?.data?.data, payload?.result, payload?.data?.result]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const item = Array.isArray(candidate) ? candidate[0] : candidate
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
      return { url, b64Json, mimeType }
    }
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
        const response = await axios.post(`${gatewayBaseUrl}${endpoint}`, payload, {
          headers: buildGatewayHeaders(),
          timeout: 120000,
        })
        return { endpoint, data: response.data }
      } catch (error) {
        lastError = error
        const status = axios.isAxiosError(error) ? error.response?.status : null
        if (status === 404 || status === 405) {
          break
        }
        if (isRetryableGatewayStatus(status) && attempt < 3) {
          await sleep(1500 * attempt)
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

async function pollGatewayImageGeneration(endpoint: string, generationId: string) {
  const deadline = Date.now() + 15 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const response = await axios.get(`${gatewayBaseUrl}${endpoint}/${generationId}`, {
      headers: {
        Authorization: `Bearer ${gatewayApiKey}`,
      },
      timeout: 120000,
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

async function createGatewayImageArtifact(input: { model: string; prompt: string; size: string }) {
  const createResponse = await requestGatewayImageGeneration(input)
  const payload = createResponse.data

  let reference = extractImageReference(payload)
  const generationId = extractGenerationId(payload)

  if (!reference && generationId) {
    const polled = await pollGatewayImageGeneration(createResponse.endpoint, generationId)
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

type GatewayImageRuntime = {
  kind: "gateway"
  model: string
}

export async function resolveImageGenerationRuntime(detail: TaskDetail, model: string): Promise<GeminiNativeImageRuntime | GatewayImageRuntime> {
  const slotSnapshots = detail.taskRunConfig.slotSnapshots ?? []
  const imageSnapshot =
    slotSnapshots.find((slot) => slot.slotType === "imageModel" && (slot.modelKey === model || slot.modelId === model || slot.providerModelId === model)) ??
    slotSnapshots.find((slot) => slot.slotType === "imageModel")

  const transport = `${imageSnapshot?.capabilityJson?.imageTransport ?? ""}`.trim().toLowerCase()
  if (imageSnapshot && transport === "gemini-generate-content") {
    const providers = await readProviderRecords()
    const provider = providers.find((item) => item.id === imageSnapshot.providerId)
    const endpointUrl = `${provider?.endpointUrl ?? ""}`.trim()
    const encryptedSecret = `${provider?.encryptedSecret ?? ""}`.trim()
    if (!provider || !endpointUrl || !encryptedSecret) {
      throw new Error(`Gemini-native image provider is incomplete for ${imageSnapshot.providerKey}`)
    }

    return {
      kind: "gemini-native",
      baseUrl: resolveProviderApiBaseUrl(endpointUrl),
      apiKey: decryptControlPlaneSecret(encryptedSecret),
      providerId: provider.id,
      providerKey: provider.providerKey,
      providerModelId: imageSnapshot.providerModelId,
      model: imageSnapshot.modelKey,
    }
  }

  return {
    kind: "gateway",
    model: normalizeImageModel(model),
  }
}

export async function createGeminiNativeImageArtifact(
  input: {
    baseUrl: string
    apiKey: string
    model: string
    prompt: string
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
}) {
  const requiredSceneCount =
    input.generationRoute === "multi_scene"
      ? input.maxSceneCount ?? resolveSceneCountForDurationWithLimit(input.targetDurationSec, input.maxSingleShotSec)
      : 1
  const modeInstruction =
    input.generationMode === "user_locked"
      ? [
          "- preserve the user's original wording and tone as much as possible",
          "- do not change the core phrasing unless it is necessary for grammar or timing",
          "- keep the planning close to the original content structure",
        ]
      : [
          "- you may strengthen the hook, pacing, and CTA while preserving the original theme",
          "- use the enhancement keywords to make the output more platform-native and more direct",
          "- prefer stronger contrast, clearer transitions, and higher conversion clarity",
        ]
  return [
    `project id: ${input.projectId}`,
    `platform: ${input.platform}`,
    `execution mode: ${input.executionMode}`,
    `terminal preset: ${input.terminalPresetId}`,
    `render size: ${input.renderSpec.width}x${input.renderSpec.height}`,
    `render aspect ratio: ${input.renderSpec.aspectRatio}`,
    `composition guideline: ${input.renderSpec.compositionGuideline}`,
    `motion guideline: ${input.renderSpec.motionGuideline}`,
    `target duration: ${input.targetDurationSec}s`,
    `generation mode: ${input.generationMode}`,
    `generation route: ${input.generationRoute}`,
    `route reason: ${input.routeReason}`,
    `model single-shot ceiling: ${input.maxSingleShotSec}s`,
    input.enhancementKeywords.length
      ? `enhancement keywords: ${input.enhancementKeywords.join(", ")}`
      : "enhancement keywords: none",
    "original script:",
    input.originalScript,
    "output requirements:",
    ...modeInstruction,
    "- return machine-usable JSON only",
    "- do not output explanations",
    "- do not output markdown separators",
    "- do not output what changed and why",
    "- finalVoiceoverScript must be direct voiceover text",
    "- when route is multi_scene, use the minimum number of scenes needed to satisfy the current model single-shot ceiling",
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
    generationMode?: "user_locked" | "system_enhanced"
    originalScript?: string
  },
):
  | { ok: true; value: TextPlanningOutput }
  | {
      ok: false
      reason: string
    } {
  if (raw && typeof raw === "object" && "commentary" in raw) {
    return { ok: false, reason: "commentary field is not allowed in planning output" }
  }

  const normalizedRaw =
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { scenePlan?: unknown[] }).scenePlan) &&
    (raw as { scenePlan: unknown[] }).scenePlan.some(
      (scene) => scene && typeof scene === "object" && "sceneNumber" in scene,
    )
      ? {
          generationRoute:
            (raw as { generationRoute?: unknown }).generationRoute === "single_shot"
              ? "single_shot"
              : "multi_scene",
          targetDurationSec:
            (raw as { targetDurationSec?: number; targetDuration?: number }).targetDurationSec ??
            (raw as { targetDuration?: number }).targetDuration ??
            expected.targetDurationSec,
          finalVoiceoverScript:
            (raw as { finalVoiceoverScript?: string }).finalVoiceoverScript ??
            ((raw as { scenePlan: Array<{ voiceoverSegment?: string }> }).scenePlan
              .map((scene) => scene.voiceoverSegment ?? "")
              .join(" ")
              .trim()),
          visualStyleGuide:
            (raw as { visualStyleGuide?: string }).visualStyleGuide ??
            "Use the returned visual, mood, and camera notes as the canonical style guide.",
          ctaLine:
            (raw as { ctaLine?: string }).ctaLine ??
            ((raw as { scenePlan: Array<{ voiceoverSegment?: string }> }).scenePlan.at(-1)?.voiceoverSegment ?? ""),
          scenePlan: (raw as {
            scenePlan: Array<{
              sceneNumber?: number
              durationSeconds?: number
              durationSec?: number
              visual?: string
              voiceoverSegment?: string
              mood?: string
              camera?: string
              scenePurpose?: string
              script?: string
              imagePrompt?: string
              videoPrompt?: string
              transitionHint?: string
              startFrameDescription?: string
              voiceoverScript?: string
              startFrameIntent?: string
              endFrameIntent?: string
              continuityConstraints?: string[]
            }>
          }).scenePlan.map((scene, index, allScenes) => {
            const script = scene.script ?? scene.voiceoverSegment ?? ""
            const visual = scene.visual ?? script
            const mood = scene.mood ? ` Mood: ${scene.mood}.` : ""
            const camera = scene.camera ? ` Camera: ${scene.camera}.` : ""
            return {
              sceneIndex: scene.sceneNumber != null ? Math.max(scene.sceneNumber - 1, 0) : index,
              scenePurpose: scene.scenePurpose ?? `Scene ${index + 1}`,
              durationSec: scene.durationSec ?? scene.durationSeconds ?? Math.floor(expected.targetDurationSec / allScenes.length),
              script,
              voiceoverScript: scene.voiceoverScript ?? script,
              startFrameDescription: scene.startFrameDescription ?? visual,
              imagePrompt: scene.imagePrompt ?? `${visual}${mood}${camera}`.trim(),
              videoPrompt:
                scene.videoPrompt ??
                `${visual}${mood}${camera} Generate a short-form social video shot that matches this exact beat.`.trim(),
              startFrameIntent: scene.startFrameIntent ?? (scene.scenePurpose ?? `Introduce scene ${index + 1}`),
              endFrameIntent: scene.endFrameIntent ?? (index === allScenes.length - 1 ? "Close on the final message" : `Hand off from scene ${index + 1}`),
              transitionHint: scene.transitionHint ?? (index === allScenes.length - 1 ? "close" : "cut"),
              continuityConstraints: Array.isArray(scene.continuityConstraints) ? scene.continuityConstraints : [],
            }
          }),
          blueprint: {
            globalTheme:
              (raw as { globalTheme?: string }).globalTheme ??
              "Preserve the original content theme with platform-native execution.",
            visualStyleGuide:
              (raw as { visualStyleGuide?: string }).visualStyleGuide ??
              "Use the returned image and video prompts as the canonical visual guide.",
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
              ((raw as { scenePlan: Array<{ voiceoverSegment?: string }> }).scenePlan
                .map((scene) => scene.voiceoverSegment ?? "")
                .join(" ")
                .trim()),
            sceneContracts: [],
          },
        }
      : raw

  const parsed = textPlanningOutputSchema.safeParse(normalizedRaw)
  if (!parsed.success) {
    return { ok: false, reason: `planning output schema invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}` }
  }

  const output = parsed.data.blueprint.sceneContracts.length
    ? parsed.data
    : {
        ...parsed.data,
        blueprint: {
          ...parsed.data.blueprint,
          totalVoiceoverScript: parsed.data.finalVoiceoverScript,
          sceneContracts: parsed.data.scenePlan.map((scene, index, allScenes) => ({
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
  if (output.generationRoute !== expected.generationRoute) {
    return { ok: false, reason: `route mismatch: expected ${expected.generationRoute}, received ${output.generationRoute}` }
  }

  if (output.targetDurationSec !== expected.targetDurationSec) {
    return { ok: false, reason: `target duration mismatch: expected ${expected.targetDurationSec}, received ${output.targetDurationSec}` }
  }

  const totalDuration = output.scenePlan.reduce((sum, scene) => sum + scene.durationSec, 0)
  if (totalDuration !== expected.targetDurationSec) {
    return { ok: false, reason: `scene duration total ${totalDuration}s does not match target ${expected.targetDurationSec}s` }
  }

  if (output.generationRoute === "single_shot" && output.scenePlan.length !== 1) {
    return { ok: false, reason: "single_shot output must contain exactly one scene" }
  }

  if (output.generationRoute === "multi_scene" && output.scenePlan.length <= 1) {
    return { ok: false, reason: "multi_scene output must contain more than one scene" }
  }

  if (expected.maxSceneCount != null && output.scenePlan.length !== expected.maxSceneCount) {
    return {
      ok: false,
      reason: `scene count mismatch: expected ${expected.maxSceneCount}, received ${output.scenePlan.length}`,
    }
  }

  const maxSingleShotSec = expected.maxSingleShotSec
  if (
    maxSingleShotSec != null &&
    output.scenePlan.some((scene) => scene.durationSec > maxSingleShotSec)
  ) {
    return {
      ok: false,
      reason: `scene duration exceeds current model single-shot limit of ${maxSingleShotSec}s`,
    }
  }

  const invalidScene = output.scenePlan.find((scene) => !planningSceneSchema.safeParse(scene).success)
  if (invalidScene) {
    return { ok: false, reason: "scenePlan contains invalid scene entries" }
  }

  if (
    expected.generationMode === "system_enhanced" &&
    expected.originalScript &&
    normalizeForComparison(output.finalVoiceoverScript) === normalizeForComparison(expected.originalScript)
  ) {
    return { ok: false, reason: "system-enhanced output is too close to the original wording" }
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
  const finalVoiceoverScript =
    detail.taskRunConfig.generationMode === "system_enhanced"
      ? buildSystemEnhancedFallbackScript(detail.script, detail.taskRunConfig.targetDurationSec)
      : detail.script
  const scenes = buildStoryboardScenes({
    script: finalVoiceoverScript,
    targetDurationSec: detail.taskRunConfig.targetDurationSec ?? 30,
    maxSceneDurationSec: resolveVideoModelCapability(detail.taskRunConfig.videoModel.id).maxSingleShotSec,
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
    visualStyleGuide:
      detail.taskRunConfig.generationMode === "system_enhanced"
        ? "System enhanced social-video pacing."
        : "Preserve original tone with minimal structural cleanup.",
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
      visualStyleGuide:
        detail.taskRunConfig.generationMode === "system_enhanced"
          ? "System enhanced social-video pacing."
          : "Preserve original tone with minimal structural cleanup.",
      subjectProfile: "Maintain one consistent subject profile across all scenes.",
      productProfile: "Keep product presentation consistent across all scenes.",
      backgroundConstraints: [],
      negativeConstraints: ["No subtitles", "No watermark", "No UI elements"],
      totalVoiceoverScript: finalVoiceoverScript,
      sceneContracts: [],
    },
  })

  return {
    generationRoute: detail.taskRunConfig.generationRoute,
    targetDurationSec: detail.taskRunConfig.targetDurationSec,
    finalVoiceoverScript,
    visualStyleGuide: detail.taskRunConfig.generationMode === "system_enhanced" ? "System enhanced social-video pacing." : "Preserve original tone with minimal structural cleanup.",
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

async function requestStructuredPlanning(detail: TaskDetail): Promise<TextPlanningOutput | null> {
  const runtime = resolveRuntimeGenerationConfig(detail)
  const provider = runtime.textProvider.trim().toLowerCase()
  const apiKey = process.env.GENERGI_TEXT_API_KEY ?? ""
  const baseUrl = resolveProviderApiBaseUrl(process.env.GENERGI_TEXT_BASE_URL ?? "")
  const model = resolvePlanningModelId(runtime)

  if (!provider || !apiKey || !baseUrl) {
    return null
  }

  const preference = GENERATION_PREFERENCES.find((item) => item.id === detail.taskRunConfig.generationMode)
  const capability = resolveVideoModelCapability(detail.taskRunConfig.videoModel.id)
  const maxSceneCount =
    detail.taskRunConfig.generationRoute === "single_shot"
      ? 1
      : resolveSceneCountForDurationWithLimit(detail.taskRunConfig.targetDurationSec, capability.maxSingleShotSec)
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
  })

  const systemPrompt =
    "You are a short-form video director and planner. Return only valid JSON that matches the requested planning structure. Do not explain your decisions."

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let rawText = ""

    if (provider === "anthropic-compatible" || provider === "anthropic-native") {
      const response = await axios.post(
        `${baseUrl}/v1/messages`,
        {
          model,
          max_tokens: 1200,
          system: systemPrompt,
          messages: [{ role: "user", content: promptContext }],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 120000,
        },
      )
      rawText = extractAnthropicText(response.data)
    } else if (provider === "openai-compatible") {
      const response = await axios.post(
        `${baseUrl}/v1/chat/completions`,
        {
          model,
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: promptContext },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          timeout: 120000,
        },
      )
      rawText = extractOpenAIText(response.data)
    }

    if (!rawText) {
      continue
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(extractJsonObject(rawText))
    } catch {
      continue
    }

    const validated = validatePlanningOutput(parsedJson, {
      generationRoute: detail.taskRunConfig.generationRoute,
      targetDurationSec: detail.taskRunConfig.targetDurationSec,
      maxSceneCount,
      maxSingleShotSec: capability.maxSingleShotSec,
      generationMode: detail.taskRunConfig.generationMode,
      originalScript: detail.script,
    })

    if (validated.ok) {
      return validated.value
    }
  }

  return null
}

export async function rewriteTaskWithTextProvider(detail: TaskDetail): Promise<TaskDetail> {
  const prepared = await buildPreparedTaskDetail(detail)
  return prepared.detail
}

async function buildPreparedTaskDetail(detail: TaskDetail): Promise<{
  detail: TaskDetail
  blueprint: PlannedExecutionBlueprint
}> {
  try {
    const planned = (await requestStructuredPlanning(detail)) ?? buildPlanningFallback(detail)
    const normalizedRewrite = normalizeRewriteToVoiceoverScript(planned.finalVoiceoverScript, detail.taskRunConfig.targetDurationSec ?? 30)
    const normalizedScenes = buildScenesFromBlueprint(detail, planned.blueprint)

    return {
      detail: {
        ...detail,
        script: normalizedRewrite || detail.script,
        blueprintVersion: detail.blueprintVersion > 0 ? detail.blueprintVersion : 1,
        blueprintStatus: detail.blueprintStatus,
        taskRunConfig: {
          ...detail.taskRunConfig,
          blueprintVersion: detail.taskRunConfig.blueprintVersion > 0 ? detail.taskRunConfig.blueprintVersion : 1,
          blueprintStatus: detail.taskRunConfig.blueprintStatus,
        },
        visualStyleGuide: planned.visualStyleGuide,
        ctaLine: planned.ctaLine,
        scenes: normalizedScenes,
        updatedAt: new Date().toISOString(),
      },
      blueprint: planned.blueprint,
    }
  } catch (error) {
    console.warn(`[worker] structured planning skipped:`, error instanceof Error ? error.message : String(error))
    const fallbackDetail = alignDetailScenes(detail, detail.script)
    const fallbackPlan = buildPlanningFallback(fallbackDetail)
    return {
      detail: fallbackDetail,
      blueprint: fallbackPlan.blueprint,
    }
  }
}

export async function prepareTaskBlueprint(detail: TaskDetail): Promise<{
  detail: TaskDetail
  blueprintRecord: TaskBlueprintRecord
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
  }
}

export async function writeTaskSourceFiles(detail: TaskDetail) {
  const dir = ensureTaskDir(detail.taskId)
  writeFileSync(path.join(dir, "script.txt"), detail.script, "utf8")
  writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(detail, null, 2), "utf8")
  return dir
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
  const srtPath = path.join(dir, "subtitles.srt")
  await bestResult.toFile(audioPath)
  writeFileSync(srtPath, bestResult.getCaptionSrtString(), "utf8")
  return {
    audioPath,
    srtPath,
    durationSec: bestDuration,
  }
}

export async function createVideoFromPrompt(input: {
  taskId: string
  scene: StoryboardScene
  model: string
  keyframePath?: string | null
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
        },
      )
      break
    } catch (error) {
      lastCreateError = error
      const status = axios.isAxiosError(error) ? error.response?.status : null
      if (isRetryableGatewayStatus(status) && attempt < 3) {
        await sleep(2000 * attempt)
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
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const pollResponse = await axios.get(`${gatewayBaseUrl}/v1/video/generations/${taskId}`, {
      headers: {
        Authorization: `Bearer ${gatewayApiKey}`,
      },
      timeout: 120000,
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
      })
      await fs.writeFile(targetPath, Buffer.from(download.data))
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
  blueprintRecord?: TaskBlueprintRecord | null
  onSceneStart?: (scene: StoryboardScene, totalScenes: number) => Promise<void> | void
}) {
  const sceneInputs = await buildSceneVideoGenerationInputs({
    detail: input.detail,
    blueprintRecord: input.blueprintRecord ?? null,
  })
  const videos = []
  for (const sceneInput of sceneInputs) {
    await input.onSceneStart?.(sceneInput.scene, input.detail.scenes.length)

    const video = await Promise.race([
      createVideoFromPrompt({
        taskId: input.taskId,
        scene: sceneInput.scene,
        model: input.model,
        keyframePath: sceneInput.keyframePath,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Scene ${sceneInput.scene.index + 1} video generation timeout`)),
          8 * 60 * 1000,
        ),
      ),
    ])
    videos.push({
      ...video,
      sceneId: sceneInput.scene.id,
      sceneIndex: sceneInput.scene.index,
      durationSec: sceneInput.scene.durationSec,
      inputStrategy: sceneInput.inputStrategy,
      keyframePath: sceneInput.keyframePath,
    })
  }
  return videos
}

export async function createKeyframeBundle(input: {
  taskId: string
  detail: TaskDetail
  model: string
}) {
  const dir = ensureTaskDir(input.taskId)
  const keyframeDir = path.join(dir, "keyframes")
  mkdirSync(keyframeDir, { recursive: true })

  const createdAt = new Date().toISOString()
  const aspectRatio = input.detail.taskRunConfig.aspectRatio
  const frames: Array<{
    sceneId: string
    sceneIndex: number
    title: string
    prompt: string
    fileName: string
    filePath: string
    model: string
    remoteTaskId: string | null
  }> = []
  const imageRuntime = await resolveImageGenerationRuntime(input.detail, input.model)
  for (const scene of input.detail.scenes) {
    const prompt = buildKeyframePrompt(scene, aspectRatio)
    const generated =
      imageRuntime.kind === "gemini-native"
        ? await createGeminiNativeImageArtifact({
            baseUrl: imageRuntime.baseUrl,
            apiKey: imageRuntime.apiKey,
            model: imageRuntime.providerModelId,
            prompt,
          })
        : await createGatewayImageArtifact({
            model: imageRuntime.model,
            prompt,
            size: "1024x1024",
          })

    const fileName = `scene-${String(scene.index + 1).padStart(2, "0")}.${generated.extension}`
    const filePath = path.join(keyframeDir, fileName)
    await fs.writeFile(filePath, generated.bytes)
    frames.push({
      sceneId: scene.id,
      sceneIndex: scene.index,
      title: scene.title,
      prompt,
      fileName,
      filePath,
      model: input.model,
      remoteTaskId: generated.generationId,
    })
  }

  const manifestPath = path.join(keyframeDir, "manifest.json")
  const manifest = {
    taskId: input.taskId,
    createdAt,
    model: imageRuntime.kind === "gemini-native" ? imageRuntime.providerModelId : imageRuntime.model,
    aspectRatio,
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
  targetDurationSec: number
}) {
  const dir = ensureTaskDir(input.taskId)
  const stitchedVideoPath = path.join(dir, "video", "stitched-scenes.mp4")
  const trimmedVideoPath = path.join(dir, "video", "trimmed-scenes.mp4")
  const outputPath = path.join(dir, "video", "final-with-audio.mp4")
  try {
    await concatVideos({
      videoPaths: input.sourceVideoPaths,
      outputPath: stitchedVideoPath,
      workingDirectory: path.join(dir, "video"),
    })
    await trimVideoDuration({
      videoPath: stitchedVideoPath,
      outputPath: trimmedVideoPath,
      durationSec: input.targetDurationSec,
    })
    await muxNarrationIntoVideo({
      videoPath: trimmedVideoPath,
      audioPath: input.narrationPath,
      outputPath,
    })
  } catch (error) {
    console.warn("[worker] ffmpeg concat/mux failed, falling back to stitched source video:", error instanceof Error ? error.message : String(error))
    await fs.copyFile(input.sourceVideoPaths[0], outputPath)
  }
  return {
    outputPath,
    actualDurationSec: await getMediaDurationSeconds({ mediaPath: outputPath }),
  }
}
