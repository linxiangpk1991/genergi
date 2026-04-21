import { copyFile, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { parseSync } from "subtitle"
import type { RenderSpec } from "@genergi/shared"

type MuxNarrationInput = {
  videoPath: string
  audioPath: string
  outputPath: string
  subtitlePath?: string | null
}

type MixNarrationWithVideoAudioInput = {
  videoPath: string
  audioPath: string
  outputPath: string
  subtitlePath?: string | null
  nativeAudioVolume?: number
  narrationVolume?: number
}

function toAssTimestamp(milliseconds: number) {
  const totalCentiseconds = Math.max(0, Math.round(milliseconds / 10))
  const hours = Math.floor(totalCentiseconds / 360000)
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000)
  const seconds = Math.floor((totalCentiseconds % 6000) / 100)
  const centiseconds = totalCentiseconds % 100
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`
}

function escapeAssText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\\N")
}

function resolveAssStyle(renderSpec: RenderSpec) {
  const fontSize = Math.max(42, Math.round(renderSpec.height * 0.046))
  const outline = Math.max(3, Math.round(fontSize * 0.08))
  const marginL = Math.max(48, Math.round(renderSpec.width * (renderSpec.safeArea.leftPct / 100)))
  const marginR = Math.max(48, Math.round(renderSpec.width * (renderSpec.safeArea.rightPct / 100)))
  const marginV = Math.max(96, Math.round(renderSpec.height * (renderSpec.safeArea.bottomPct / 100)))

  return {
    fontSize,
    outline,
    marginL,
    marginR,
    marginV,
  }
}

function escapeFfmpegFilterPath(filePath: string) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
}

export function buildAssSubtitleContent(input: {
  srtContent: string
  renderSpec: RenderSpec
}) {
  const { fontSize, outline, marginL, marginR, marginV } = resolveAssStyle(input.renderSpec)
  const cues = parseSync(input.srtContent)
    .filter((node) => node.type === "cue")
    .map((node) => node.data)

  const dialogueLines = cues.map((cue) => (
    `Dialogue: 0,${toAssTimestamp(cue.start)},${toAssTimestamp(cue.end)},Default,,0,0,0,,${escapeAssText(cue.text)}`
  ))

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${input.renderSpec.width}`,
    `PlayResY: ${input.renderSpec.height}`,
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${outline},0,2,${marginL},${marginR},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ...dialogueLines,
    "",
  ].join("\n")
}

export async function writeStyledAssSubtitleFile(input: {
  srtPath: string
  assPath: string
  renderSpec: RenderSpec
}) {
  const srtContent = await readFile(input.srtPath, "utf8")
  const assContent = buildAssSubtitleContent({
    srtContent,
    renderSpec: input.renderSpec,
  })
  await writeFile(input.assPath, assContent, "utf8")
  return input.assPath
}

export function buildMuxNarrationCommandArgs(input: MuxNarrationInput) {
  const baseArgs = [
    "-y",
    "-i",
    input.videoPath,
    "-i",
    input.audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
  ]

  if (input.subtitlePath) {
    return [
      ...baseArgs,
      "-vf",
      `ass=${escapeFfmpegFilterPath(input.subtitlePath)}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-shortest",
      input.outputPath,
    ]
  }

  return [
    ...baseArgs,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-shortest",
    input.outputPath,
  ]
}

export function buildMixNarrationWithVideoAudioCommandArgs(input: MixNarrationWithVideoAudioInput) {
  const nativeAudioVolume = input.nativeAudioVolume ?? 0.35
  const narrationVolume = input.narrationVolume ?? 1
  const baseArgs = [
    "-y",
    "-i",
    input.videoPath,
    "-i",
    input.audioPath,
    "-filter_complex",
    `[0:a]volume=${nativeAudioVolume}[native];[1:a]volume=${narrationVolume}[tts];[native][tts]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
  ]

  if (input.subtitlePath) {
    return [
      ...baseArgs,
      "-vf",
      `ass=${escapeFfmpegFilterPath(input.subtitlePath)}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-shortest",
      input.outputPath,
    ]
  }

  return [
    ...baseArgs,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-shortest",
    input.outputPath,
  ]
}

export async function getMediaDurationSeconds(input: {
  mediaPath: string
}) {
  const ffprobePath = process.env.GENERGI_FFPROBE_PATH || "ffprobe"

  return new Promise<number>((resolve, reject) => {
    const process = spawn(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        input.mediaPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    )

    let stdout = ""
    let stderr = ""
    process.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    process.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    process.on("error", reject)
    process.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`))
        return
      }

      const duration = Number.parseFloat(stdout.trim())
      if (!Number.isFinite(duration)) {
        reject(new Error(`ffprobe returned invalid duration: ${stdout}`))
        return
      }

      resolve(duration)
    })
  })
}

export async function concatVideos(input: {
  videoPaths: string[]
  outputPath: string
  workingDirectory?: string
}) {
  if (input.videoPaths.length === 0) {
    throw new Error("At least one scene video is required for concatenation")
  }

  if (input.videoPaths.length === 1) {
    await copyFile(input.videoPaths[0], input.outputPath)
    return
  }

  const ffmpegPath = process.env.GENERGI_FFMPEG_PATH || "ffmpeg"
  const workingDirectory = input.workingDirectory ?? path.dirname(input.outputPath)
  const concatListPath = path.join(workingDirectory, "scene-concat.txt")
  const concatList = input.videoPaths.map((videoPath) => `file '${videoPath.replace(/'/g, "'\\''")}'`).join("\n")

  await writeFile(concatListPath, concatList, "utf8")

  try {
    await new Promise<void>((resolve, reject) => {
      const process = spawn(
        ffmpegPath,
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatListPath,
          "-c",
          "copy",
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
        reject(new Error(`ffmpeg concat exited with code ${code}: ${stderr}`))
      })
    })
  } finally {
    await rm(concatListPath, { force: true })
  }
}

export async function trimVideoDuration(input: {
  videoPath: string
  outputPath: string
  durationSec: number
  preserveAudio?: boolean
}) {
  const ffmpegPath = process.env.GENERGI_FFMPEG_PATH || "ffmpeg"

  await new Promise<void>((resolve, reject) => {
    const process = spawn(
      ffmpegPath,
      [
        "-y",
        "-i",
        input.videoPath,
        "-t",
        `${input.durationSec}`,
        ...(input.preserveAudio ? [] : ["-an"]),
        "-c:v",
        "libx264",
        ...(input.preserveAudio ? ["-c:a", "aac"] : []),
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
      reject(new Error(`ffmpeg trim exited with code ${code}: ${stderr}`))
    })
  })
}

export async function muxNarrationIntoVideo(input: {
  videoPath: string
  audioPath: string
  outputPath: string
  subtitlePath?: string | null
}) {
  const ffmpegPath = process.env.GENERGI_FFMPEG_PATH || "ffmpeg"

  await new Promise<void>((resolve, reject) => {
    const process = spawn(
      ffmpegPath,
      buildMuxNarrationCommandArgs(input),
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
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`))
    })
  })
}

export async function mixNarrationWithVideoAudio(input: MixNarrationWithVideoAudioInput) {
  const ffmpegPath = process.env.GENERGI_FFMPEG_PATH || "ffmpeg"

  await new Promise<void>((resolve, reject) => {
    const process = spawn(
      ffmpegPath,
      buildMixNarrationWithVideoAudioCommandArgs(input),
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
      reject(new Error(`ffmpeg audio mix exited with code ${code}: ${stderr}`))
    })
  })
}

export async function extractKeyframeFromVideo(input: {
  videoPath: string
  outputPath: string
  timeSeconds?: number
}) {
  const ffmpegPath = process.env.GENERGI_FFMPEG_PATH || "ffmpeg"
  const seek = `${input.timeSeconds ?? 0.2}`

  await new Promise<void>((resolve, reject) => {
    const process = spawn(
      ffmpegPath,
      [
        "-y",
        "-ss",
        seek,
        "-i",
        input.videoPath,
        "-frames:v",
        "1",
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
      reject(new Error(`ffmpeg frame extraction exited with code ${code}: ${stderr}`))
    })
  })
}
