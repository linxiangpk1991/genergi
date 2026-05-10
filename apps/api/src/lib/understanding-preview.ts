import { createHash } from "node:crypto"
import { z } from "zod"
import { videoDurationSecSchema } from "@genergi/shared"

export const understandingPreviewInputSchema = z.object({
  sourceBrief: z.string().trim().min(1).max(12000),
  visualSeedInput: z.string().trim().max(4000).nullable().optional(),
  targetDurationSec: videoDurationSecSchema.default(30),
  keyframeCount: z.number().int().positive().max(9).optional(),
  keepCharacterConsistent: z.boolean().default(true),
})

function extractVisualSeedValue(visualSeedInput: string | null | undefined, labels: string[]) {
  const source = visualSeedInput?.trim()
  if (!source) {
    return ""
  }
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[:：]\\s*([^\\n。；;]+)`, "i")
    const match = source.match(pattern)
    if (match?.[1]?.trim()) {
      return match[1].trim()
    }
  }
  return ""
}

function summarizeSourceBriefEn(sourceBrief: string) {
  const normalized = sourceBrief.replace(/\s+/g, " ").trim()
  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized
  return firstSentence.slice(0, 220)
}

function resolveExecutionVisualBrief(input: {
  sourceBrief: string
  visualSeedInput?: string | null
  keepCharacterConsistent: boolean
}) {
  const subjectZh = extractVisualSeedValue(input.visualSeedInput, ["主角", "角色", "subject"]) || "系统会根据内容推断主角"
  const settingZh = extractVisualSeedValue(input.visualSeedInput, ["场景", "环境", "setting"]) || "系统会根据内容推断场景"
  const styleZh = extractVisualSeedValue(input.visualSeedInput, ["风格", "style"]) || "适合短视频的电影感视觉风格"
  const moodZh = extractVisualSeedValue(input.visualSeedInput, ["情绪", "mood"]) || "从痛点到理解再到行动"
  const negativeZh = extractVisualSeedValue(input.visualSeedInput, ["禁止项", "negative", "avoid"]) || "不要文字、水印、界面元素或乱码"

  const subjectEn = /Asian|woman|女性|亚洲/i.test(subjectZh) ? "28-year-old Asian woman" : "the primary subject described by the content brief"
  const settingEn = /office|办公室/i.test(settingZh) ? "late-night office" : "the setting inferred from the content brief"
  const styleEn = /cinematic|电影|插画|illustration|anime/i.test(styleZh) ? "soft cinematic illustration" : "platform-native cinematic short-video style"
  const moodEn = /tired|疲惫|reflect|反思|hope|希望/i.test(moodZh) ? "tired, reflective, gradually hopeful" : "clear emotional progression from pain to insight to action"
  const consistencyEn = input.keepCharacterConsistent
    ? "keep the same primary character, outfit, visual language, and lighting logic across all keyframes"
    : "keep the visual language consistent while allowing subject changes only when the brief requires them"

  return {
    zh: {
      subject: subjectZh,
      setting: settingZh,
      style: styleZh,
      mood: moodZh,
      negativeRules: [negativeZh],
      consistencyRules: [input.keepCharacterConsistent ? "全片保持同一主角、服装、风格和光线逻辑" : "保持整体视觉语言一致"],
    },
    en: {
      subject: subjectEn,
      setting: settingEn,
      style: styleEn,
      mood: moodEn,
      negativeRules: ["no text overlays, no watermarks, no UI elements, no garbled characters"],
      consistencyRules: [consistencyEn],
    },
  }
}

export function buildUnderstandingPreviewPayload(input: z.infer<typeof understandingPreviewInputSchema>) {
  const keyframeCount = input.keyframeCount ?? Math.max(1, Math.ceil(input.targetDurationSec / 15))
  const briefSummaryEn = summarizeSourceBriefEn(input.sourceBrief)
  const visual = resolveExecutionVisualBrief(input)
  const generatedAt = new Date().toISOString()
  const sourceBriefHash = createHash("sha256")
    .update(`${input.sourceBrief}\n${input.visualSeedInput ?? ""}\n${input.targetDurationSec}`)
    .digest("hex")
    .slice(0, 16)
  const segmentSec = Math.max(1, Math.round(input.targetDurationSec / keyframeCount))
  const roles = ["Pain hook", "Context setup", "Insight explanation", "Proof or pattern", "Call to action"]
  const keyframePlan = Array.from({ length: keyframeCount }, (_, index) => {
    const start = index * segmentSec
    const end = index === keyframeCount - 1 ? input.targetDurationSec : Math.min(input.targetDurationSec, (index + 1) * segmentSec)
    const role = roles[Math.min(index, roles.length - 1)] ?? `Key beat ${index + 1}`
    const visualGoal = `${role}: show ${visual.en.subject} in ${visual.en.setting}, ${visual.en.mood}.`
    const sharedPrompt = [
      visualGoal,
      `Style: ${visual.en.style}.`,
      `Consistency: ${visual.en.consistencyRules.join("; ")}.`,
      `Negative rules: ${visual.en.negativeRules.join("; ")}.`,
      "Vertical 9:16 composition, cinematic lighting, no text overlays.",
    ].join(" ")
    return {
      index: index + 1,
      timestampRange: `${start}-${end}s`,
      narrativeRole: role,
      visualGoal,
      imagePrompt: sharedPrompt,
      videoPrompt: `${sharedPrompt} Add subtle camera motion that matches this narrative beat.`,
    }
  })

  return {
    understandingPreview: {
      version: "understanding-preview-v1" as const,
      generatedAt,
      sourceBriefHash,
      topic: { zh: "内容主题：系统已理解这条视频要讲什么", en: `Short video topic: ${briefSummaryEn}` },
      targetAudience: { zh: "目标人群：根据内容里的痛点和行动目标判断", en: "Audience inferred from the pain point and call to action in the content brief" },
      corePainPoint: { zh: "核心痛点：观众正在遇到的阻力、停滞或未被满足的需求", en: "Core pain point inferred from the brief" },
      mainPromise: { zh: "主要承诺：解释问题原因，并给出下一步行动", en: "Main promise: clarify the problem and guide the next action" },
      conversionGoal: { zh: "行动目标：引导观众完成内容里的下一步", en: "Conversion goal: drive the call to action described in the brief" },
      emotionalArc: { zh: visual.zh.mood, en: visual.en.mood },
      recommendedStructure: { zh: "痛点开场 -> 背景铺垫 -> 核心解释 -> 共鸣或证明 -> 行动号召", en: "Pain hook -> context -> core insight -> relatable proof -> call to action" },
      visualBrief: {
        subject: { zh: visual.zh.subject, en: visual.en.subject },
        setting: { zh: visual.zh.setting, en: visual.en.setting },
        style: { zh: visual.zh.style, en: visual.en.style },
        mood: { zh: visual.zh.mood, en: visual.en.mood },
        negativeRules: visual.zh.negativeRules.map((rule, index) => ({
          zh: rule,
          en: visual.en.negativeRules[index] ?? "avoid visual artifacts",
        })),
        consistencyRules: visual.zh.consistencyRules.map((rule, index) => ({
          zh: rule,
          en: visual.en.consistencyRules[index] ?? "keep visual continuity",
        })),
      },
      riskWarnings: [],
      status: "draft" as const,
    },
    executionBrief: {
      version: "execution-brief-v1" as const,
      sourceBrief: input.sourceBrief,
      topic: briefSummaryEn,
      targetAudience: "Audience inferred from the content brief",
      corePainPoint: "The viewer has a concrete pain point or unresolved need described in the brief",
      mainPromise: "Clarify the cause of the pain point and make the next action feel relevant",
      conversionGoal: "Drive the call to action described in the content brief",
      emotionalArc: visual.en.mood,
      visualBrief: visual.en,
      narrativeStructure: ["Pain hook", "Context setup", "Core insight", "Relatable proof", "Call to action"].slice(0, Math.max(1, keyframeCount)),
      keyframePlan,
      finalPromptLanguage: "en" as const,
    },
  }
}
