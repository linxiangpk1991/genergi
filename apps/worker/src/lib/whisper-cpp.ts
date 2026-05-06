import { access } from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type WhisperCppRunner = (command: string, args: string[]) => Promise<unknown>

export type WhisperCppArgsInput = {
  binaryPath: string
  modelPath: string
  audioPath: string
  outputDir: string
  language?: string
}

export type WhisperCppTranscribeInput = {
  audioPath: string
  outputDir: string
  language?: string
  runner?: WhisperCppRunner
}

export function buildWhisperCppArgs(input: WhisperCppArgsInput) {
  const outputStem = path.join(input.outputDir, "whisper")
  const args = [
    "-m",
    input.modelPath,
    "-f",
    input.audioPath,
    "-l",
    input.language ?? "en",
    "-osrt",
    "-of",
    outputStem,
  ]

  return {
    command: input.binaryPath,
    args,
    srtPath: `${outputStem}.srt`,
  }
}

export async function transcribeWithWhisperCpp(input: WhisperCppTranscribeInput) {
  const binaryPath = process.env.GENERGI_WHISPER_CPP_BIN
  const modelPath = process.env.GENERGI_WHISPER_CPP_MODEL
  if (!binaryPath || !modelPath) {
    throw new Error("GENERGI_WHISPER_CPP_BIN and GENERGI_WHISPER_CPP_MODEL must be configured before using whisper_cpp subtitles")
  }

  const built = buildWhisperCppArgs({
    binaryPath,
    modelPath,
    audioPath: input.audioPath,
    outputDir: input.outputDir,
    language: input.language,
  })
  const runner = input.runner ?? ((command, args) => execFileAsync(command, args))
  await runner(built.command, built.args)
  await access(built.srtPath)
  return built.srtPath
}
