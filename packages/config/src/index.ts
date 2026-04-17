import type {
  ChannelProfileId,
  CostEstimate,
  GenerationMode,
  ModelRef,
  ProductionModeId,
  TaskRunConfig,
  VideoDurationSec,
  VideoModelCapability,
} from "@genergi/shared"
import { resolveGenerationRoute } from "@genergi/shared"

export const BRAND = {
  productName: "GENERGI 自动化视频平台",
  companyName: "Genergius",
  domain: "ai.genergius.com",
} as const

export const VIDEO_DURATION_PRESETS = [15, 30, 45, 60] as const

export const GENERATION_PREFERENCES: Array<{
  id: GenerationMode
  label: string
  description: string
  keywords: string[]
}> = [
  {
    id: "user_locked",
    label: "忠于原脚本",
    description: "尽量保留你原本的内容表达，只做最小必要的结构整理。",
    keywords: ["preserve original tone", "minimal structural cleanup"],
  },
  {
    id: "system_enhanced",
    label: "启用系统增强",
    description: "在不偏离主题的前提下，自动补充更适合平台传播的提示词。",
    keywords: ["stronger hook", "native pacing", "clear CTA", "platform-native framing"],
  },
]

export const VIDEO_MODEL_CAPABILITIES: Record<string, VideoModelCapability> = {
  "video.draft": {
    modelId: "video.draft",
    provider: "openai-compatible",
    label: "Veo 3.1 Fast",
    maxSingleShotSec: 8,
    supportedSingleShotDurations: [4, 6, 8],
  },
  "video.final": {
    modelId: "video.final",
    provider: "openai-compatible",
    label: "Veo 3.1 Portrait",
    maxSingleShotSec: 8,
    supportedSingleShotDurations: [4, 6, 8],
  },
  "video.hd": {
    modelId: "video.hd",
    provider: "openai-compatible",
    label: "Veo 3.1 Portrait HD",
    maxSingleShotSec: 8,
    supportedSingleShotDurations: [4, 6, 8],
  },
}

export const CHANNELS: Record<ChannelProfileId, { label: string; description: string }> = {
  tiktok: { label: "TikTok", description: "短节奏、强钩子、英语优先" },
  reels: { label: "Instagram Reels", description: "视觉感更强，适合品牌与生活方式内容" },
  shorts: { label: "YouTube Shorts", description: "更适合系列化、知识向、持久流量内容" },
}

export const MODE_MODELS: Record<ProductionModeId, {
  textModel: ModelRef
  imageDraftModel: ModelRef
  imageFinalModel: ModelRef
  videoDraftModel: ModelRef
  videoFinalModel: ModelRef
  ttsProvider: string
  budgetLimitCny: number
  requireStoryboardReview: boolean
  requireKeyframeReview: boolean
}> = {
  mass_production: {
    textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
    imageDraftModel: { id: "image.draft", label: "Gemini 3.1 Flash Image Preview", provider: "openai-compatible" },
    imageFinalModel: { id: "image.final", label: "Gemini 3 Pro Image Preview", provider: "openai-compatible" },
    videoDraftModel: { id: "video.draft", label: "Veo 3.1 Fast", provider: "openai-compatible" },
    videoFinalModel: { id: "video.final", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
    ttsProvider: "edge-tts",
    budgetLimitCny: 3,
    requireStoryboardReview: false,
    requireKeyframeReview: true,
  },
  high_quality: {
    textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
    imageDraftModel: { id: "image.final", label: "Gemini 3 Pro Image Preview", provider: "openai-compatible" },
    imageFinalModel: { id: "image.premium", label: "Gemini 3 Pro Image Preview 2k", provider: "openai-compatible" },
    videoDraftModel: { id: "video.final", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
    videoFinalModel: { id: "video.hd", label: "Veo 3.1 Portrait HD", provider: "openai-compatible" },
    ttsProvider: "edge-tts",
    budgetLimitCny: 5,
    requireStoryboardReview: true,
    requireKeyframeReview: true,
  },
}

export function resolveVideoModelCapability(modelId: string): VideoModelCapability {
  return VIDEO_MODEL_CAPABILITIES[modelId] ?? {
    modelId,
    provider: "unknown",
    label: modelId,
    maxSingleShotSec: 8,
    supportedSingleShotDurations: [4, 6, 8],
  }
}

export function buildDefaultTaskRunConfig(
  modeId: ProductionModeId,
  channelId: ChannelProfileId,
  targetDurationSec: VideoDurationSec = 30,
  generationMode: GenerationMode = "user_locked",
): TaskRunConfig {
  const mode = MODE_MODELS[modeId]
  const enhancementMode = generationMode === "system_enhanced" ? "system_enhanced" : "user_locked"
  const routeDecision = resolveGenerationRoute({
    targetDurationSec,
    maxSingleShotSec: resolveVideoModelCapability(mode.videoDraftModel.id).maxSingleShotSec,
  })
  return {
    modeId,
    channelId,
    targetDurationSec,
    generationMode,
    enhancementMode,
    generationRoute: routeDecision.generationRoute,
    routeReason: routeDecision.routeReason,
    planningVersion: "v1",
    textModel: mode.textModel,
    imageDraftModel: mode.imageDraftModel,
    imageFinalModel: mode.imageFinalModel,
    videoDraftModel: mode.videoDraftModel,
    videoFinalModel: mode.videoFinalModel,
    ttsProvider: mode.ttsProvider,
    contentLocale: "en",
    operatorLocale: "zh-CN",
    requireStoryboardReview: mode.requireStoryboardReview,
    requireKeyframeReview: mode.requireKeyframeReview,
    budgetLimitCny: mode.budgetLimitCny,
    aspectRatio: "9:16",
  }
}

export function estimateCost(modeId: ProductionModeId): CostEstimate {
  if (modeId === "high_quality") {
    return {
      estimatedMinutes: 45,
      estimatedScenes: 12,
      estimatedVideoScenes: 12,
      estimatedCredits: 1.2,
      budgetUsagePct: 85,
    }
  }

  return {
    estimatedMinutes: 20,
    estimatedScenes: 8,
    estimatedVideoScenes: 8,
    estimatedCredits: 0.8,
    budgetUsagePct: 55,
  }
}
