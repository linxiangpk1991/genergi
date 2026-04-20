import { describe, expect, it } from "vitest"

describe("worker ffmpeg helpers", () => {
  it("builds styled ASS subtitles from SRT cues with render-spec aware sizing", async () => {
    const ffmpeg = await import("../../../apps/worker/src/lib/ffmpeg")

    const ass = ffmpeg.buildAssSubtitleContent({
      srtContent: `1
00:00:00,000 --> 00:00:01,500
Hello world

2
00:00:02,000 --> 00:00:04,000
Line one
Line two
`,
      renderSpec: {
        terminalPresetId: "phone_portrait",
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
        compositionGuideline: "主体保持在竖屏中心安全区",
        motionGuideline: "优先轻推拉",
      },
    })

    expect(ass).toContain("[Script Info]")
    expect(ass).toContain("PlayResX: 1080")
    expect(ass).toContain("PlayResY: 1920")
    expect(ass).toContain("[V4+ Styles]")
    expect(ass).toContain("Style: Default")
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.50,Default,,0,0,0,,Hello world")
    expect(ass).toContain("Line one\\NLine two")
  })

  it("builds subtitle burn-in ffmpeg args when a subtitle path is provided", async () => {
    const ffmpeg = await import("../../../apps/worker/src/lib/ffmpeg")

    const args = ffmpeg.buildMuxNarrationCommandArgs({
      videoPath: "/tmp/video.mp4",
      audioPath: "/tmp/audio.mp3",
      subtitlePath: "/tmp/subtitles.ass",
      outputPath: "/tmp/output.mp4",
    })

    expect(args).toContain("-vf")
    expect(args[args.indexOf("-vf") + 1]).toContain("ass=")
    expect(args).toContain("libx264")
    expect(args).toContain("aac")
  })

  it("keeps the fast copy path args when no subtitle path is provided", async () => {
    const ffmpeg = await import("../../../apps/worker/src/lib/ffmpeg")

    const args = ffmpeg.buildMuxNarrationCommandArgs({
      videoPath: "/tmp/video.mp4",
      audioPath: "/tmp/audio.mp3",
      outputPath: "/tmp/output.mp4",
    })

    expect(args).toContain("-c:v")
    expect(args[args.indexOf("-c:v") + 1]).toBe("copy")
    expect(args).not.toContain("-vf")
  })
})
