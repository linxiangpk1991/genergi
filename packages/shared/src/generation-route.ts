import { z } from "zod"

export const generationModeSchema = z.enum(["user_locked", "system_enhanced"])
export type GenerationMode = z.infer<typeof generationModeSchema>

export const enhancementModeSchema = generationModeSchema
export type EnhancementMode = z.infer<typeof enhancementModeSchema>

export const generationRouteSchema = z.enum(["single_shot", "multi_scene"])
export type GenerationRoute = z.infer<typeof generationRouteSchema>

export const planningVersionSchema = z.literal("v1")
export type PlanningVersion = z.infer<typeof planningVersionSchema>

export const videoModelCapabilitySchema = z.object({
  modelId: z.string(),
  provider: z.string(),
  label: z.string(),
  maxSingleShotSec: z.number().int().positive(),
  supportedSingleShotDurations: z.array(z.number().int().positive()),
})
export type VideoModelCapability = z.infer<typeof videoModelCapabilitySchema>

export const generationRouteDecisionSchema = z.object({
  generationRoute: generationRouteSchema,
  routeReason: z.string(),
  maxSingleShotSec: z.number().int().positive(),
})
export type GenerationRouteDecision = z.infer<typeof generationRouteDecisionSchema>

export function resolveGenerationRoute(input: {
  targetDurationSec: number
  maxSingleShotSec: number
}): GenerationRouteDecision {
  if (input.targetDurationSec <= input.maxSingleShotSec) {
    return {
      generationRoute: "single_shot",
      routeReason: `target duration ${input.targetDurationSec}s fits within the current model single-shot limit of ${input.maxSingleShotSec}s`,
      maxSingleShotSec: input.maxSingleShotSec,
    }
  }

  return {
    generationRoute: "multi_scene",
    routeReason: `target duration ${input.targetDurationSec}s exceeds the current model single-shot limit of ${input.maxSingleShotSec}s`,
    maxSingleShotSec: input.maxSingleShotSec,
  }
}
