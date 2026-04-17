import { z } from "zod"
import {
  enhancementModeSchema,
  generationModeSchema,
  generationRouteDecisionSchema,
  generationRouteSchema,
} from "./generation-route.js"

const planningChannelProfileSchema = z.enum(["tiktok", "reels", "shorts"])
const planningVideoDurationSecSchema = z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)])

export const textPlanningInputSchema = z.object({
  originalScript: z.string().min(1),
  targetDurationSec: planningVideoDurationSecSchema,
  platform: planningChannelProfileSchema,
  generationMode: generationModeSchema,
  enhancementMode: enhancementModeSchema,
  routeDecision: generationRouteDecisionSchema,
  modelCapability: z.object({
    modelId: z.string(),
    label: z.string(),
    maxSingleShotSec: z.number().int().positive(),
  }),
  enhancementKeywords: z.array(z.string()).default([]),
})
export type TextPlanningInput = z.infer<typeof textPlanningInputSchema>

export const planningSceneSchema = z.object({
  sceneIndex: z.number().int().nonnegative(),
  scenePurpose: z.string().min(1),
  durationSec: z.number().int().positive(),
  script: z.string().min(1),
  imagePrompt: z.string().min(1),
  videoPrompt: z.string().min(1),
  transitionHint: z.string().min(1),
})
export type PlanningScene = z.infer<typeof planningSceneSchema>

export const textPlanningOutputSchema = z.object({
  generationRoute: generationRouteSchema,
  targetDurationSec: planningVideoDurationSecSchema,
  finalVoiceoverScript: z.string().min(1),
  visualStyleGuide: z.string().min(1),
  ctaLine: z.string().min(1),
  scenePlan: z.array(planningSceneSchema).min(1),
})
export type TextPlanningOutput = z.infer<typeof textPlanningOutputSchema>
