import { mkdirSync, writeFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import axios from "axios"

import { buildStoryboardScenes, type StoryboardScene, type TaskDetail } from "@genergi/shared"
import { EdgeTTS } from "./edge-tts.js"
import { concatVideos, extractKeyframeFromVideo, muxNarrationIntoVideo } from "./ffmpeg.js"

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

function buildKeyframePrompt(scene: StoryboardScene, aspectRatio: string) {
  const basePrompt = scene.imagePrompt.trim() || scene.videoPrompt.trim() || scene.title.trim()
  const orientation = aspectRatio.includes(":") ? aspectRatio : "9:16"
  return [
    basePrompt,
    `Vertical keyframe for a ${orientation} short-form social video.`,
    "Cinematic composition, premium product readability, crisp subject separation, no watermark, no UI chrome, no caption text.",
  ].join(" ")
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

function alignDetailScenes(detail: TaskDetail, script: string): TaskDetail {
  return {
    ...detail,
    script,
    scenes: buildStoryboardScenes({
      script,
      targetDurationSec: detail.taskRunConfig.targetDurationSec ?? 30,
      aspectRatio: detail.taskRunConfig.aspectRatio,
    }),
    updatedAt: new Date().toISOString(),
  }
}

export async function rewriteTaskWithTextProvider(detail: TaskDetail): Promise<TaskDetail> {
  const provider = process.env.GENERGI_TEXT_PROVIDER ?? ""
  const apiKey = process.env.GENERGI_TEXT_API_KEY ?? ""
  const baseUrl = (process.env.GENERGI_TEXT_BASE_URL ?? "").replace(/\/+$/, "")
  const model = process.env.GENERGI_TEXT_MODEL ?? "claude-opus-4.6"

  if (!provider || !apiKey || !baseUrl) {
    return alignDetailScenes(detail, detail.script)
  }

  try {
    let rewritten = ""

    if (provider === "anthropic-native") {
      const response = await axios.post(
        `${baseUrl}/v1/messages`,
        {
          model,
          max_tokens: 800,
          system:
            "You are a short-form social video strategist. Return concise English social-video writing that feels native to English-speaking markets.",
          messages: [
            {
              role: "user",
              content: `Rewrite this script to feel more native-English and more platform-ready for TikTok/Reels/Shorts. Keep it concise.\n\nSCRIPT:\n${detail.script}`,
            },
          ],
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
      rewritten = extractAnthropicText(response.data)
    } else if (provider === "openai-compatible") {
      const response = await axios.post(
        `${baseUrl}/v1/chat/completions`,
        {
          model,
          temperature: 0.7,
          messages: [
            {
              role: "system",
              content:
                "You are a short-form social video strategist. Return concise English social-video writing that feels native to English-speaking markets.",
            },
            {
              role: "user",
              content: `Rewrite this script to feel more native-English and more platform-ready for TikTok/Reels/Shorts. Keep it concise.\n\nSCRIPT:\n${detail.script}`,
            },
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
      rewritten = extractOpenAIText(response.data)
    }

    if (!rewritten) {
      return alignDetailScenes(detail, detail.script)
    }

    return alignDetailScenes(detail, rewritten)
  } catch (error) {
    console.warn(`[worker] ${provider} rewrite skipped:`, error instanceof Error ? error.message : String(error))
    return alignDetailScenes(detail, detail.script)
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
  const edge = new EdgeTTS()
  const result = await edge.synthesize(
    detail.script,
    process.env.GENERGI_TTS_VOICE ?? "en-US-AvaMultilingualNeural",
    { rate: 0, pitch: 0, volume: 0 },
  )
  const audioPath = path.join(dir, "narration.mp3")
  const srtPath = path.join(dir, "subtitles.srt")
  await result.toFile(audioPath)
  writeFileSync(srtPath, result.getCaptionSrtString(), "utf8")
  return {
    audioPath,
    srtPath,
    durationSec: await result.getDurationSeconds(),
  }
}

export async function createVideoFromPrompt(input: { taskId: string; scene: StoryboardScene; model: string }) {
  if (!gatewayApiKey) {
    throw new Error("GENERGI_MEDIA_GATEWAY_API_KEY is missing")
  }

  let createResponse
  let lastCreateError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      createResponse = await axios.post(
        `${gatewayBaseUrl}/v1/video/generations`,
        {
          model: input.model,
          prompt: input.scene.videoPrompt || input.scene.script || input.scene.title,
          duration: Math.max(Math.round(input.scene.durationSec), 4),
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
}) {
  const videos = []
  for (const scene of input.detail.scenes) {
    const video = await createVideoFromPrompt({
      taskId: input.taskId,
      scene,
      model: input.model,
    })
    videos.push({
      ...video,
      sceneId: scene.id,
      sceneIndex: scene.index,
      durationSec: scene.durationSec,
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
  for (const scene of input.detail.scenes) {
    const prompt = buildKeyframePrompt(scene, aspectRatio)
    const generated = await createGatewayImageArtifact({
      model: normalizeImageModel(input.model),
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
    model: normalizeImageModel(input.model),
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

export async function buildFinalVideoWithNarration(input: {
  taskId: string
  sourceVideoPaths: string[]
  narrationPath: string
}) {
  const dir = ensureTaskDir(input.taskId)
  const stitchedVideoPath = path.join(dir, "video", "stitched-scenes.mp4")
  const outputPath = path.join(dir, "video", "final-with-audio.mp4")
  try {
    await concatVideos({
      videoPaths: input.sourceVideoPaths,
      outputPath: stitchedVideoPath,
      workingDirectory: path.join(dir, "video"),
    })
    await muxNarrationIntoVideo({
      videoPath: stitchedVideoPath,
      audioPath: input.narrationPath,
      outputPath,
    })
  } catch (error) {
    console.warn("[worker] ffmpeg concat/mux failed, falling back to stitched source video:", error instanceof Error ? error.message : String(error))
    await fs.copyFile(input.sourceVideoPaths[0], outputPath)
  }
  return outputPath
}
