import type {
  ChannelProfileId,
  CostEstimate,
  ExecutionMode,
  GenerationMode,
  ModelRef,
  ProductionModeId,
  RenderSpec,
  TaskRunConfig,
  TerminalPresetId,
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
  "veo3.1-fast": {
    modelId: "veo3.1-fast",
    provider: "openai-compatible",
    label: "Veo 3.1 Fast",
    maxSingleShotSec: 8,
    supportedSingleShotDurations: [4, 6, 8],
  },
  "veo3.1": {
    modelId: "veo3.1",
    provider: "openai-compatible",
    label: "Veo 3.1 Portrait",
    maxSingleShotSec: 8,
    supportedSingleShotDurations: [4, 6, 8],
  },
}

export const CHANNELS: Record<ChannelProfileId, { label: string; description: string }> = {
  tiktok: { label: "TikTok", description: "短节奏、强钩子、英语优先" },
  reels: { label: "Instagram Reels", description: "视觉感更强，适合品牌与生活方式内容" },
  shorts: { label: "YouTube Shorts", description: "更适合系列化、知识向、持久流量内容" },
}

export const TERMINAL_PRESETS: Record<TerminalPresetId, RenderSpec> = {
  phone_portrait: {
    terminalPresetId: "phone_portrait",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
    compositionGuideline: "主体保持在竖屏中心安全区，优先纵向层次和中上部视觉焦点。",
    motionGuideline: "优先轻推拉、竖向层次变化与居中主体运动，避免大幅横向扫动。",
  },
  phone_landscape: {
    terminalPresetId: "phone_landscape",
    width: 1920,
    height: 1080,
    aspectRatio: "16:9",
    safeArea: { topPct: 8, rightPct: 6, bottomPct: 8, leftPct: 6 },
    compositionGuideline: "主体不宜过小，适合横向叙事与左右信息分布。",
    motionGuideline: "可用横向推进和平移，但保持主体和产品停留在主要观看区域。",
  },
  tablet_portrait: {
    terminalPresetId: "tablet_portrait",
    width: 1536,
    height: 2048,
    aspectRatio: "3:4",
    safeArea: { topPct: 7, rightPct: 6, bottomPct: 9, leftPct: 6 },
    compositionGuideline: "保留更多环境空间，竖向构图下仍需保证主体清晰集中。",
    motionGuideline: "可使用更缓的推进与轻微层次变化，避免主体漂到边缘。",
  },
  tablet_landscape: {
    terminalPresetId: "tablet_landscape",
    width: 2048,
    height: 1536,
    aspectRatio: "4:3",
    safeArea: { topPct: 7, rightPct: 6, bottomPct: 7, leftPct: 6 },
    compositionGuideline: "适合横向场景展开、双主体或产品与环境并置展示。",
    motionGuideline: "允许横向环境展开和更慢节奏镜头，但主体和产品要维持可读性。",
  },
}

export const CHANNEL_DEFAULT_TERMINAL_PRESETS: Record<ChannelProfileId, TerminalPresetId> = {
  tiktok: "phone_portrait",
  reels: "phone_portrait",
  shorts: "phone_portrait",
}

export const MODE_MODELS: Record<ProductionModeId, {
  executionMode: ExecutionMode
  textModel: ModelRef
  imageModel: ModelRef
  videoModel: ModelRef
  ttsProvider: string
  budgetLimitCny: number
  requireStoryboardReview: boolean
  requireKeyframeReview: boolean
}> = {
  mass_production: {
    executionMode: "automated",
    textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
    imageModel: { id: "image.final", label: "Gemini 3 Pro Image Preview", provider: "openai-compatible" },
    videoModel: { id: "video.final", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
    ttsProvider: "edge-tts",
    budgetLimitCny: 3,
    requireStoryboardReview: false,
    requireKeyframeReview: true,
  },
  high_quality: {
    executionMode: "review_required",
    textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
    imageModel: { id: "image.premium", label: "Gemini 3 Pro Image Preview 2k", provider: "openai-compatible" },
    videoModel: { id: "video.hd", label: "Veo 3.1 Portrait HD", provider: "openai-compatible" },
    ttsProvider: "edge-tts",
    budgetLimitCny: 5,
    requireStoryboardReview: true,
    requireKeyframeReview: true,
  },
}

export function buildRenderSpec(terminalPresetId: TerminalPresetId): RenderSpec {
  return TERMINAL_PRESETS[terminalPresetId]
}

export const resolveRenderSpec = buildRenderSpec

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
  options: {
    projectId?: string
    terminalPresetId?: TerminalPresetId
    audioStrategy?: "tts_only" | "native_plus_tts_ducked"
  } = {},
): TaskRunConfig {
  const mode = MODE_MODELS[modeId]
  const terminalPresetId = options.terminalPresetId ?? CHANNEL_DEFAULT_TERMINAL_PRESETS[channelId]
  const renderSpec = buildRenderSpec(terminalPresetId)
  const enhancementMode = generationMode === "system_enhanced" ? "system_enhanced" : "user_locked"
  const routeDecision = resolveGenerationRoute({
    targetDurationSec,
    maxSingleShotSec: resolveVideoModelCapability(mode.videoModel.id).maxSingleShotSec,
  })
  return {
    projectId: options.projectId ?? "project_unassigned",
    modeId,
    executionMode: mode.executionMode,
    channelId,
    terminalPresetId,
    renderSpecJson: renderSpec,
    targetDurationSec,
    generationMode,
    enhancementMode,
    generationRoute: routeDecision.generationRoute,
    routeReason: routeDecision.routeReason,
    planningVersion: "v1",
    blueprintVersion: 0,
    blueprintStatus: "pending_generation",
    textModel: mode.textModel,
    imageModel: mode.imageModel,
    videoModel: mode.videoModel,
    ttsProvider: mode.ttsProvider,
    audioStrategy: options.audioStrategy ?? "tts_only",
    contentLocale: "en",
    operatorLocale: "zh-CN",
    requireStoryboardReview: mode.requireStoryboardReview,
    requireKeyframeReview: mode.requireKeyframeReview,
    budgetLimitCny: mode.budgetLimitCny,
    aspectRatio: renderSpec.aspectRatio,
    slotSnapshots: [],
    modelOverrides: undefined,
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
