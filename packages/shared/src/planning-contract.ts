import { z } from "zod"
import {
  enhancementModeSchema,
  generationModeSchema,
  generationRouteDecisionSchema,
  generationRouteSchema,
} from "./generation-route.js"
import {
  blueprintSceneContractSchema,
  executionModeSchema,
  plannedExecutionBlueprintSchema,
  renderSpecSchema,
  terminalPresetIdSchema,
} from "./video-blueprint.js"

const planningChannelProfileSchema = z.enum(["tiktok", "reels", "shorts"])
const planningVideoDurationSecSchema = z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)])

export const textPlanningInputSchema = z.object({
  originalScript: z.string().min(1),
  projectId: z.string().min(1),
  targetDurationSec: planningVideoDurationSecSchema,
  platform: planningChannelProfileSchema,
  executionMode: executionModeSchema,
  terminalPresetId: terminalPresetIdSchema,
  renderSpec: renderSpecSchema,
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
  voiceoverScript: z.string().min(1),
  startFrameDescription: z.string().min(1),
  imagePrompt: z.string().min(1),
  videoPrompt: z.string().min(1),
  startFrameIntent: z.string().min(1),
  endFrameIntent: z.string().min(1),
  transitionHint: z.string().min(1),
  continuityConstraints: z.array(z.string().min(1)).default([]),
})
export type PlanningScene = z.infer<typeof planningSceneSchema>

export const planningBlueprintSchema = plannedExecutionBlueprintSchema.extend({
  sceneContracts: z.array(blueprintSceneContractSchema).min(1),
})
export type PlanningBlueprint = z.infer<typeof planningBlueprintSchema>

export const textPlanningOutputSchema = z.object({
  generationRoute: generationRouteSchema,
  targetDurationSec: planningVideoDurationSecSchema,
  finalVoiceoverScript: z.string().min(1),
  visualStyleGuide: z.string().min(1),
  ctaLine: z.string().min(1),
  scenePlan: z.array(planningSceneSchema).min(1),
  blueprint: planningBlueprintSchema,
})
export type TextPlanningOutput = z.infer<typeof textPlanningOutputSchema>
