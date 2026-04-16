import type { ChannelProfileId, CostEstimate, ModelRef, ProductionModeId, TaskRunConfig } from "@genergi/shared"

export const BRAND = {
  productName: "GENERGI 自动化视频平台",
  companyName: "Genergius",
  domain: "ai.genergius.com",
} as const

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

export function buildDefaultTaskRunConfig(modeId: ProductionModeId, channelId: ChannelProfileId): TaskRunConfig {
  const mode = MODE_MODELS[modeId]
  return {
    modeId,
    channelId,
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
