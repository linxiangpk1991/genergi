export function normalizeImageProviderModelId(modelId: string) {
  const normalized = modelId.trim()
  const lower = normalized.toLowerCase()

  switch (lower) {
    case "image.draft":
      return "gemini-3.1-flash-image-preview"
    case "image.final":
      return "gemini-3-pro-image-preview"
    case "image.premium":
      return "gemini-3-pro-image-preview-2k"
    default:
      return normalized
  }
}

export function normalizeVideoProviderModelId(modelId: string) {
  const normalized = modelId.trim()
  const lower = normalized.toLowerCase()

  switch (lower) {
    case "video.draft":
    case "veo-3.1-fast-generate-001":
    case "veo-3.1-fast":
    case "veo-3.1-fast-preview":
      return "veo3.1-fast"
    case "video.final":
    case "video.hd":
    case "veo-3.1-generate-001":
    case "veo-3.1":
    case "veo-3.1-preview":
      return "veo3.1"
    default:
      return normalized
  }
}
