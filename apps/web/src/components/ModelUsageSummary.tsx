import type { TaskDetail, TaskModelRef, TaskModelTrace, TaskModelUsage } from "../api"

type ModelUsageSource =
  | TaskModelUsage
  | Pick<TaskDetail["taskRunConfig"], "textModel" | "imageModel" | "videoModel" | "ttsProvider">
  | null
  | undefined

type ModelUsageSummaryProps = {
  source: ModelUsageSource
  compact?: boolean
  trace?: TaskModelTrace | null
}

function getModelLabel(model: TaskModelRef | null | undefined) {
  return model?.label?.trim() || model?.id?.trim() || "未记录"
}

function getModelMeta(model: TaskModelRef | null | undefined) {
  return [model?.provider, model?.id].filter((value): value is string => Boolean(value?.trim())).join(" / ")
}

function getModelShortLine(label: string, value: string) {
  return value === "未记录" ? `${label}还没有记录` : `${label}：${value}`
}

function getFallbackTriggerLabel(value: string) {
  switch (value) {
    case "timeout":
      return "超时"
    case "rate_limit":
      return "限流"
    case "provider_error":
      return "接入方错误"
    case "empty_result":
      return "空结果"
    case "invalid_response":
      return "返回不完整"
    default:
      return value
  }
}

function hasModelUsage(source: ModelUsageSource) {
  return Boolean(source?.textModel || source?.imageModel || source?.videoModel || source?.ttsProvider)
}

export function ModelUsageSummary({ source, compact = false, trace }: ModelUsageSummaryProps) {
  if (!hasModelUsage(source)) {
    return (
      <div className={compact ? "model-usage model-usage--compact" : "model-usage"}>
        {!compact ? (
          <div className="model-usage__header">
            <strong>本次用了哪些模型</strong>
            <span>这条旧任务没有留下模型记录。如果要判断效果，建议用同样内容重新跑一条新任务。</span>
          </div>
        ) : null}
        <div className="model-usage__empty">这条任务没有留下模型记录</div>
      </div>
    )
  }

  const items = [
    { label: compact ? "文案模型" : "文案", value: getModelLabel(source?.textModel), meta: getModelMeta(source?.textModel) },
    { label: compact ? "图片模型" : "图片", value: getModelLabel(source?.imageModel), meta: getModelMeta(source?.imageModel) },
    { label: compact ? "视频模型" : "视频", value: getModelLabel(source?.videoModel), meta: getModelMeta(source?.videoModel) },
    { label: "配音", value: source?.ttsProvider || "未记录", meta: "TTS provider" },
  ]

  return (
    <div className={compact ? "model-usage model-usage--compact" : "model-usage"}>
      {!compact ? (
        <div className="model-usage__header">
          <strong>本次用了哪些模型</strong>
          <span>先看名字就够了。需要排查接口时，再打开下面的技术细节。</span>
        </div>
      ) : null}
      <div className="model-usage__items">
        {items.map((item) => (
          <div className="model-usage__item" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {!compact ? <small>{getModelShortLine(item.label, item.value)}</small> : null}
          </div>
        ))}
      </div>
      {!compact && trace ? (
        <details className="model-trace-summary">
          <summary>查看技术细节</summary>
          <strong>模型连接明细</strong>
          <div className="model-trace-summary__items">
            {(["textModel", "imageModel", "videoModel", "ttsProvider"] as const).map((slot) => {
              const entry = trace[slot]
              return entry ? (
                <div className="model-trace-summary__item" key={slot}>
                  <span>{slot === "textModel" ? "文案" : slot === "imageModel" ? "图片" : slot === "videoModel" ? "视频" : "配音"}</span>
                  <strong>{entry.label}</strong>
                  {entry.selectionReason ? <small>{entry.selectionReason}</small> : null}
                  <small>{[entry.providerType, entry.wireApi, entry.requestPath].filter(Boolean).join(" / ")}</small>
                  {entry.fallbackCandidates?.length ? (
                    <div className="model-trace-summary__fallbacks">
                      <span>备用路线</span>
                      {entry.fallbackCandidates.map((candidate) => (
                        <small key={`${slot}-${candidate.providerType}-${candidate.providerModelId}`}>
                          {candidate.displayName} · {(candidate.fallbackTriggers ?? []).map(getFallbackTriggerLabel).join("、")}
                        </small>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null
            })}
          </div>
        </details>
      ) : null}
    </div>
  )
}
