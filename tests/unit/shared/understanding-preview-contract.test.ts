import { describe, expect, it } from "vitest"
import {
  createTaskInputSchema,
  englishExecutionBriefSchema,
  taskRunConfigSchema,
  bilingualUnderstandingPreviewSchema,
} from "../../../packages/shared/src/index"

const preview = {
  version: "understanding-preview-v1",
  generatedAt: "2026-05-10T00:00:00.000Z",
  sourceBriefHash: "abc123",
  topic: { zh: "职业周期短视频", en: "Career cycle short video" },
  targetAudience: { zh: "努力多年仍感到停滞的人", en: "People who have worked hard for years but still feel stuck" },
  corePainPoint: { zh: "努力没有得到回应", en: "Hard work does not seem to produce progress" },
  mainPromise: { zh: "解释八字大运如何影响事业节奏", en: "Explain how BaZi luck cycles affect career momentum" },
  conversionGoal: { zh: "引导查看完整八字报告", en: "Drive viewers to request the full BaZi report" },
  emotionalArc: { zh: "疲惫到释然再到希望", en: "From exhaustion to relief and renewed hope" },
  recommendedStructure: { zh: "痛点开场、解释原理、案例共鸣、行动号召", en: "Pain hook, principle, relatable pattern, call to action" },
  visualBrief: {
    subject: { zh: "28 岁亚洲女性", en: "28-year-old Asian woman" },
    setting: { zh: "深夜办公室", en: "late-night office" },
    style: { zh: "柔和电影感动画插画", en: "soft cinematic anime-inspired illustration" },
    mood: { zh: "疲惫、反思、逐渐看到希望", en: "tired, reflective, gradually hopeful" },
    negativeRules: [{ zh: "不要文字水印", en: "no text overlays or watermarks" }],
    consistencyRules: [{ zh: "全片保持同一主角", en: "keep the same primary character across all frames" }],
  },
  riskWarnings: [],
  status: "confirmed",
}

const executionBrief = {
  version: "execution-brief-v1",
  sourceBrief: "Explain the BaZi luck cycle and close with the full report CTA.",
  topic: "Career cycle short video",
  targetAudience: "People who have worked hard for years but still feel stuck",
  corePainPoint: "Hard work does not seem to produce progress",
  mainPromise: "Explain how BaZi luck cycles affect career momentum",
  conversionGoal: "Drive viewers to request the full BaZi report",
  emotionalArc: "From exhaustion to relief and renewed hope",
  visualBrief: {
    subject: "28-year-old Asian woman",
    setting: "late-night office",
    style: "soft cinematic anime-inspired illustration",
    mood: "tired, reflective, gradually hopeful",
    negativeRules: ["no text overlays or watermarks"],
    consistencyRules: ["keep the same primary character across all frames"],
  },
  narrativeStructure: ["Pain hook", "Principle", "Relatable pattern", "Call to action"],
  keyframePlan: [
    {
      index: 1,
      timestampRange: "0-15s",
      narrativeRole: "Pain hook",
      visualGoal: "Show the lead character exhausted at a desk.",
      imagePrompt: "A 28-year-old Asian woman sits tired at a late-night office desk, soft cinematic anime-inspired illustration, vertical 9:16, no text.",
      videoPrompt: "Slow cinematic push-in on the tired woman at her desk, reflective mood, no text overlays.",
    },
  ],
  finalPromptLanguage: "en",
}

describe("understanding preview contracts", () => {
  it("accepts bilingual operator preview and English-only execution brief", () => {
    expect(bilingualUnderstandingPreviewSchema.parse(preview).visualBrief.subject.zh).toBe("28 岁亚洲女性")
    expect(englishExecutionBriefSchema.parse(executionBrief).finalPromptLanguage).toBe("en")
  })

  it("allows task creation to carry the confirmed preview and execution brief", () => {
    const parsed = createTaskInputSchema.parse({
      projectId: "project_default",
      title: "BaZi cycle",
      script: "Explain the BaZi luck cycle and close with the full report CTA.",
      targetDurationSec: 60,
      understandingPreview: preview,
      executionBrief,
      keepCharacterConsistent: true,
    })

    expect(parsed.understandingPreview?.topic.en).toBe("Career cycle short video")
    expect(parsed.executionBrief?.keyframePlan).toHaveLength(1)
    expect(parsed.keepCharacterConsistent).toBe(true)
  })

  it("keeps old task run configs readable with null preview and execution brief defaults", () => {
    const parsed = taskRunConfigSchema.parse({
      projectId: "project_default",
      modeId: "high_quality",
      executionMode: "review_required",
      channelId: "reels",
      terminalPresetId: "phone_portrait",
      renderSpecJson: {
        terminalPresetId: "phone_portrait",
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
        compositionGuideline: "主体保持在竖屏中心安全区",
        motionGuideline: "优先轻推拉",
      },
      targetDurationSec: 30,
      generationMode: "system_enhanced",
      enhancementMode: "system_enhanced",
      generationRoute: "multi_scene",
      routeReason: "legacy",
      planningVersion: "v1",
      textModel: { id: "text", label: "Text", provider: "OpenAI" },
      imageModel: { id: "image", label: "Image", provider: "OpenAI" },
      videoModel: { id: "video", label: "Video", provider: "Veo" },
      ttsProvider: "edge-tts",
      contentLocale: "en",
      operatorLocale: "zh-CN",
      requireStoryboardReview: true,
      requireKeyframeReview: true,
      budgetLimitCny: 10,
      aspectRatio: "9:16",
    })

    expect(parsed.understandingPreview).toBeNull()
    expect(parsed.executionBrief).toBeNull()
    expect(parsed.executionBriefVersion).toBe("execution-brief-v1")
    expect(parsed.keepCharacterConsistent).toBe(true)
  })
})
