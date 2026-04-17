import { copyFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"

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
        "-an",
        "-c:v",
        "libx264",
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
}) {
  const ffmpegPath = process.env.GENERGI_FFMPEG_PATH || "ffmpeg"

  await new Promise<void>((resolve, reject) => {
    const process = spawn(
      ffmpegPath,
      [
        "-y",
        "-i",
        input.videoPath,
        "-i",
        input.audioPath,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
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
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`))
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
