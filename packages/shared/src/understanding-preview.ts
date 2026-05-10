import { z } from "zod"

export const bilingualTextSchema = z.object({
  zh: z.string().trim().min(1),
  en: z.string().trim().min(1),
})
export type BilingualText = z.infer<typeof bilingualTextSchema>

export const bilingualUnderstandingPreviewSchema = z.object({
  version: z.literal("understanding-preview-v1"),
  generatedAt: z.string().trim().min(1),
  sourceBriefHash: z.string().trim().min(1),
  topic: bilingualTextSchema,
  targetAudience: bilingualTextSchema,
  corePainPoint: bilingualTextSchema,
  mainPromise: bilingualTextSchema,
  conversionGoal: bilingualTextSchema,
  emotionalArc: bilingualTextSchema,
  recommendedStructure: bilingualTextSchema,
  visualBrief: z.object({
    subject: bilingualTextSchema,
    setting: bilingualTextSchema,
    style: bilingualTextSchema,
    mood: bilingualTextSchema,
    negativeRules: z.array(bilingualTextSchema).default([]),
    consistencyRules: z.array(bilingualTextSchema).default([]),
  }),
  riskWarnings: z.array(z.object({
    severity: z.enum(["info", "warning", "blocking"]),
    message: bilingualTextSchema,
    suggestedFix: bilingualTextSchema.optional(),
  })).default([]),
  status: z.enum(["draft", "confirmed", "edited"]).default("draft"),
})
export type BilingualUnderstandingPreview = z.infer<typeof bilingualUnderstandingPreviewSchema>

export const englishExecutionBriefSchema = z.object({
  version: z.literal("execution-brief-v1"),
  sourceBrief: z.string().trim().min(1),
  topic: z.string().trim().min(1),
  targetAudience: z.string().trim().min(1),
  corePainPoint: z.string().trim().min(1),
  mainPromise: z.string().trim().min(1),
  conversionGoal: z.string().trim().min(1),
  emotionalArc: z.string().trim().min(1),
  visualBrief: z.object({
    subject: z.string().trim().min(1),
    setting: z.string().trim().min(1),
    style: z.string().trim().min(1),
    mood: z.string().trim().min(1),
    negativeRules: z.array(z.string().trim().min(1)).default([]),
    consistencyRules: z.array(z.string().trim().min(1)).default([]),
  }),
  narrativeStructure: z.array(z.string().trim().min(1)).min(1),
  keyframePlan: z.array(z.object({
    index: z.number().int().positive(),
    timestampRange: z.string().trim().min(1),
    narrativeRole: z.string().trim().min(1),
    visualGoal: z.string().trim().min(1),
    imagePrompt: z.string().trim().min(1),
    videoPrompt: z.string().trim().min(1),
  })).min(1),
  finalPromptLanguage: z.literal("en"),
})
export type EnglishExecutionBrief = z.infer<typeof englishExecutionBriefSchema>
