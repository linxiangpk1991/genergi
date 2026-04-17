import { mkdirSync, writeFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import axios from "axios"

import type { StoryboardScene, TaskDetail } from "@genergi/shared"
import { EdgeTTS } from "./edge-tts.js"
import { muxNarrationIntoVideo } from "./ffmpeg.js"

const gatewayBaseUrl = process.env.GENERGI_MEDIA_GATEWAY_BASE_URL ?? "https://open.xiaojingai.com"
const gatewayApiKey = process.env.GENERGI_MEDIA_GATEWAY_API_KEY ?? ""

function ensureTaskDir(taskId: string) {
  const root = process.env.GENERGI_DATA_DIR ?? ".data"
  const dir = path.resolve(root, "exports", taskId)
  mkdirSync(dir, { recursive: true })
  mkdirSync(path.join(dir, "video"), { recursive: true })
  mkdirSync(path.join(dir, "keyframes"), { recursive: true })
  return dir
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

  const createResponse = await axios.post(
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

export async function buildFinalVideoWithNarration(input: {
  taskId: string
  sourceVideoPath: string
  narrationPath: string
}) {
  const dir = ensureTaskDir(input.taskId)
  const outputPath = path.join(dir, "video", "final-with-audio.mp4")
  await muxNarrationIntoVideo({
    videoPath: input.sourceVideoPath,
    audioPath: input.narrationPath,
    outputPath,
  })
  return outputPath
}
