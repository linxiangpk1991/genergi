import type { SubtitleStrategy } from "@genergi/shared"

import { transcribeWithWhisperCpp, type WhisperCppRunner } from "./whisper-cpp.js"

export type SubtitleProviderInput = {
  taskId: string
  audioPath: string
  alignedSrtPath: string
  outputDir: string
  language?: string
}

export type SubtitleProviderResult = {
  strategy: SubtitleStrategy
  srtPath: string
}

export type SubtitleProvider = {
  generate(input: SubtitleProviderInput): Promise<SubtitleProviderResult>
}

export type SubtitleProviderDependencies = {
  transcribe?: (input: {
    audioPath: string
    outputDir: string
    language?: string
    runner?: WhisperCppRunner
  }) => Promise<string>
  runner?: WhisperCppRunner
}

export function createSubtitleProvider(
  strategy: SubtitleStrategy,
  dependencies: SubtitleProviderDependencies = {},
): SubtitleProvider {
  if (strategy === "whisper_cpp") {
    return {
      async generate(input) {
        const transcribe = dependencies.transcribe ?? transcribeWithWhisperCpp
        const srtPath = await transcribe({
          audioPath: input.audioPath,
          outputDir: input.outputDir,
          language: input.language,
          runner: dependencies.runner,
        })
        return { strategy, srtPath }
      },
    }
  }

  return {
    async generate(input) {
      return {
        strategy: "tts_aligned",
        srtPath: input.alignedSrtPath,
      }
    },
  }
}
