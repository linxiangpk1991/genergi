import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildWhisperCppArgs, transcribeWithWhisperCpp } from "../../../apps/worker/src/lib/whisper-cpp"

describe("whisper.cpp subtitle adapter", () => {
  let tempDir = ""

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = ""
    }
    delete process.env.GENERGI_WHISPER_CPP_BIN
    delete process.env.GENERGI_WHISPER_CPP_MODEL
  })

  it("builds stable whisper.cpp SRT arguments without requiring a local install", () => {
    const built = buildWhisperCppArgs({
      binaryPath: "whisper-cli",
      modelPath: "/models/ggml-base.en.bin",
      audioPath: "/work/narration.mp3",
      outputDir: "/work/out",
      language: "en",
    })

    expect(built.command).toBe("whisper-cli")
    expect(built.args).toEqual([
      "-m",
      "/models/ggml-base.en.bin",
      "-f",
      "/work/narration.mp3",
      "-l",
      "en",
      "-osrt",
      "-of",
      path.join("/work/out", "whisper"),
    ])
    expect(built.srtPath).toBe(path.join("/work/out", "whisper.srt"))
  })

  it("runs whisper.cpp through an injectable runner and returns the generated SRT path", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "genergi-whisper-cpp-"))
    await mkdir(tempDir, { recursive: true })
    process.env.GENERGI_WHISPER_CPP_BIN = "whisper-cli"
    process.env.GENERGI_WHISPER_CPP_MODEL = path.join(tempDir, "ggml-base.en.bin")

    const runner = vi.fn(async (_command: string, args: string[]) => {
      const outputStem = args[args.indexOf("-of") + 1]
      await writeFile(`${outputStem}.srt`, "1\n00:00:00,000 --> 00:00:01,000\nHello\n", "utf8")
    })

    const srtPath = await transcribeWithWhisperCpp({
      audioPath: path.join(tempDir, "narration.mp3"),
      outputDir: tempDir,
      language: "en",
      runner,
    })

    expect(runner).toHaveBeenCalledWith("whisper-cli", expect.arrayContaining(["-osrt"]))
    expect(srtPath).toBe(path.join(tempDir, "whisper.srt"))
    expect(await readFile(srtPath, "utf8")).toContain("Hello")
  })

  it("fails fast with setup guidance when whisper.cpp paths are not configured", async () => {
    await expect(
      transcribeWithWhisperCpp({
        audioPath: "/tmp/narration.mp3",
        outputDir: "/tmp",
        runner: vi.fn(),
      }),
    ).rejects.toThrow("GENERGI_WHISPER_CPP_BIN and GENERGI_WHISPER_CPP_MODEL must be configured")
  })
})
