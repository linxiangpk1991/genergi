import { describe, expect, it, vi } from "vitest"

import { createSubtitleProvider } from "../../../apps/worker/src/lib/subtitle-provider"

describe("worker subtitle provider", () => {
  it("keeps production default subtitles aligned to the TTS-generated SRT", async () => {
    const provider = createSubtitleProvider("tts_aligned")

    const result = await provider.generate({
      taskId: "task_subtitles",
      audioPath: "/tmp/narration.mp3",
      alignedSrtPath: "/tmp/subtitles.srt",
      outputDir: "/tmp",
    })

    expect(result).toEqual({
      strategy: "tts_aligned",
      srtPath: "/tmp/subtitles.srt",
    })
  })

  it("delegates whisper_cpp subtitle generation to the injected whisper adapter", async () => {
    const transcribe = vi.fn().mockResolvedValue("/tmp/whisper.srt")
    const provider = createSubtitleProvider("whisper_cpp", { transcribe })

    const result = await provider.generate({
      taskId: "task_subtitles",
      audioPath: "/tmp/narration.mp3",
      alignedSrtPath: "/tmp/aligned.srt",
      outputDir: "/tmp",
      language: "en",
    })

    expect(transcribe).toHaveBeenCalledWith({
      audioPath: "/tmp/narration.mp3",
      outputDir: "/tmp",
      language: "en",
    })
    expect(result).toEqual({
      strategy: "whisper_cpp",
      srtPath: "/tmp/whisper.srt",
    })
  })
})
