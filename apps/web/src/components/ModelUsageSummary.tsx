import type { TaskDetail, TaskModelRef, TaskModelUsage } from "../api"

type ModelUsageSource =
  | TaskModelUsage
  | Pick<TaskDetail["taskRunConfig"], "textModel" | "imageModel" | "videoModel" | "ttsProvider">
  | null
  | undefined

type ModelUsageSummaryProps = {
  source: ModelUsageSource
  compact?: boolean
}

function getModelLabel(model: TaskModelRef | null | undefined) {
  return model?.label?.trim() || model?.id?.trim() || "未记录"
}

function getModelMeta(model: TaskModelRef | null | undefined) {
  return [model?.provider, model?.id].filter((value): value is string => Boolean(value?.trim())).join(" / ")
}

function hasModelUsage(source: ModelUsageSource) {
  return Boolean(source?.textModel || source?.imageModel || source?.videoModel || source?.ttsProvider)
}

export function ModelUsageSummary({ source, compact = false }: ModelUsageSummaryProps) {
  if (!hasModelUsage(source)) {
    return (
      <div className={compact ? "model-usage model-usage--compact" : "model-usage"}>
        {!compact ? (
          <div className="model-usage__header">
            <strong>本次使用的模型</strong>
            <span>旧任务未记录模型快照，建议用新任务复测后再判断模型质量。</span>
          </div>
        ) : null}
        <div className="model-usage__empty">旧任务未记录模型快照</div>
      </div>
    )
  }

  const items = [
    { label: "文案模型", value: getModelLabel(source?.textModel), meta: getModelMeta(source?.textModel) },
    { label: "图片模型", value: getModelLabel(source?.imageModel), meta: getModelMeta(source?.imageModel) },
    { label: "视频模型", value: getModelLabel(source?.videoModel), meta: getModelMeta(source?.videoModel) },
    { label: "配音接入", value: source?.ttsProvider || "未记录", meta: "TTS provider" },
  ]

  return (
    <div className={compact ? "model-usage model-usage--compact" : "model-usage"}>
      {!compact ? (
        <div className="model-usage__header">
          <strong>本次使用的模型</strong>
          <span>创建任务时冻结的模型快照，用来定位提示词质量、图片质量、视频质量或配音问题。</span>
        </div>
      ) : null}
      <div className="model-usage__items">
        {items.map((item) => (
          <div className="model-usage__item" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {!compact && item.meta ? <small>{item.meta}</small> : null}
          </div>
        ))}
      </div>
    </div>
  )
}
