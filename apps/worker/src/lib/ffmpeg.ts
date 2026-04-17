import { spawn } from "node:child_process"

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
