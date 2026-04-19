import { useEffect, useMemo, useState } from "react"
import {
  api,
  MODEL_CONTROL_MODE_LABELS,
  MODEL_CONTROL_SLOT_LABELS,
  MODEL_CONTROL_SLOT_ORDER,
  type BootstrapResponse,
  type GenerationPreferenceId,
  type ModelControlModeId,
  type ModelControlSlotType,
  type SelectableModelOption,
  type SelectableModelPoolsResponse,
  type TaskSummary,
} from "../api"

function formatCurrency(value: number) {
  return `¥${value.toFixed(2)}`
}

function getPreferenceLabel(preference: GenerationPreferenceId) {
  return preference === "system_enhanced" ? "启用系统增强" : "忠于原脚本"
}

function getPreferenceSummary(preference: GenerationPreferenceId) {
  return preference === "system_enhanced"
    ? "系统会保留主题方向，但主动把表达整理成更适合短视频传播的版本。"
    : "系统会尽量保留你原始内容的表达方式，只做最小必要的整理。"
}

function getChannelLabel(channelId: string) {
  if (channelId === "tiktok") {
    return "TikTok"
  }

  if (channelId === "reels") {
    return "Instagram Reels"
  }

  if (channelId === "shorts") {
    return "YouTube Shorts"
  }

  return channelId
}

function pruneOverrides(
  current: Partial<Record<ModelControlSlotType, string>>,
  selectable: SelectableModelPoolsResponse | null,
) {
  if (!selectable) {
    return {}
  }

  return MODEL_CONTROL_SLOT_ORDER.reduce<Partial<Record<ModelControlSlotType, string>>>((accumulator, slot) => {
    const selectedId = current[slot]
    if (!selectedId) {
      return accumulator
    }

    const exists = selectable.pools[slot]?.options.some((option) => option.recordId === selectedId)
    if (exists) {
      accumulator[slot] = selectedId
    }

    return accumulator
  }, {})
}

function findOption(
  selectable: SelectableModelPoolsResponse | null,
  slot: ModelControlSlotType,
  recordId?: string | null,
) {
  if (!selectable || !recordId) {
    return null
  }

  return selectable.pools[slot]?.options.find((option) => option.recordId === recordId) ?? null
}

function describeOption(option: SelectableModelOption | null) {
  if (!option) {
    return "未设置"
  }

  return option.providerDisplayName ? `${option.displayName} / ${option.providerDisplayName}` : option.displayName
}

export function HomePage() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [title, setTitle] = useState("")
  const [script, setScript] = useState("")
  const [modeId, setModeId] = useState<ModelControlModeId>("mass_production")
  const [channelId, setChannelId] = useState("tiktok")
  const [targetDurationSec, setTargetDurationSec] = useState(30)
  const [generationPreference, setGenerationPreference] = useState<GenerationPreferenceId>("user_locked")
  const [selectablePools, setSelectablePools] = useState<SelectableModelPoolsResponse | null>(null)
  const [modelOverrides, setModelOverrides] = useState<Partial<Record<ModelControlSlotType, string>>>({})
  const [overridesOpen, setOverridesOpen] = useState(false)
  const [overrideLoading, setOverrideLoading] = useState(false)
  const [overrideError, setOverrideError] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [tasksUpdatedAt, setTasksUpdatedAt] = useState<string>("")

  useEffect(() => {
    async function load() {
      try {
        const [bootstrapRes, taskRes] = await Promise.all([api.bootstrap(), api.listTasks()])
        setBootstrap(bootstrapRes)
        setTasks(taskRes.tasks)
        setTasksUpdatedAt(new Date().toLocaleTimeString("zh-CN"))
        setTargetDurationSec(bootstrapRes.durationOptions[1] ?? bootstrapRes.durationOptions[0] ?? 30)
        setGenerationPreference(bootstrapRes.generationPreferences[0]?.id ?? "user_locked")
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败")
      } finally {
        setLoading(false)
      }
    }

    void load()

    const timer = window.setInterval(() => {
      void api.listTasks()
        .then((taskRes) => {
          setTasks(taskRes.tasks)
          setTasksUpdatedAt(new Date().toLocaleTimeString("zh-CN"))
        })
        .catch(() => {})
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!bootstrap) {
      return
    }

    let cancelled = false

    async function loadSelectablePools() {
      setOverrideLoading(true)
      setOverrideError("")

      try {
        const response = await api.getSelectableModelPools(modeId)
        if (cancelled) {
          return
        }

        setSelectablePools(response)
        setModelOverrides((current) => pruneOverrides(current, response))
      } catch (err) {
        if (cancelled) {
          return
        }

        setSelectablePools(null)
        setModelOverrides({})
        setOverrideError(err instanceof Error ? err.message : "高级覆盖池加载失败")
      } finally {
        if (!cancelled) {
          setOverrideLoading(false)
        }
      }
    }

    void loadSelectablePools()

    return () => {
      cancelled = true
    }
  }, [bootstrap, modeId])

  const selectedMode = useMemo(
    () => bootstrap?.modes.find((mode) => mode.id === modeId) ?? null,
    [bootstrap, modeId],
  )

  const routePreview = targetDurationSec <= (selectedMode?.maxSingleShotSec ?? 8) ? "单条成片" : "多段成片"
  const routePreviewDetail =
    routePreview === "单条成片"
      ? "这次内容会优先保持一条完整表达，减少切换感。"
      : "这次内容会按多段组织后再合成为完整成片，优先保证表达稳定。"
  const planningSummary = getPreferenceSummary(generationPreference)
  const overrideCount = Object.values(modelOverrides).filter(Boolean).length
  const taskStatusSummary = useMemo(() => {
    const runningCount = tasks.filter((task) => task.status === "running").length
    const completedCount = tasks.filter((task) => task.status === "completed").length
    const failedCount = tasks.filter((task) => task.status === "failed").length
    return { runningCount, completedCount, failedCount }
  }, [tasks])
  const recentTasks = useMemo(
    () => [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 3),
    [tasks],
  )

  const effectiveSlotSummary = useMemo(
    () =>
      MODEL_CONTROL_SLOT_ORDER.map((slot) => {
        const pool = selectablePools?.pools?.[slot]
        const overrideId = modelOverrides[slot]
        const overrideOption = findOption(selectablePools, slot, overrideId)
        const modeDefaultOption = findOption(selectablePools, slot, pool?.modeDefaultId ?? null)
        const globalDefaultOption = findOption(selectablePools, slot, pool?.globalDefaultId ?? null)
        const effectiveOption =
          overrideOption ??
          findOption(selectablePools, slot, pool?.effectiveId ?? pool?.modeDefaultId ?? pool?.globalDefaultId ?? null)

        return {
          slot,
          overrideOption,
          modeDefaultOption,
          globalDefaultOption,
          effectiveOption,
        }
      }),
    [modelOverrides, selectablePools],
  )

  async function handleCreateTask() {
    if (!title.trim() || !script.trim()) {
      setError("请先填写任务名称和内容母本")
      return
    }

    if (overrideLoading) {
      setError("高级覆盖池还在刷新，请稍等加载完成后再提交。")
      return
    }

    setSubmitting(true)
    setError("")
    try {
      const overridePayload = Object.fromEntries(
        Object.entries(modelOverrides)
          .filter((entry): entry is [ModelControlSlotType, string] => Boolean(entry[1]))
          .map(([slot, modelId]) => [slot, slot === "ttsProvider" ? { providerId: modelId } : { modelId }]),
      )

      const result = await api.createTask({
        title,
        script,
        modeId,
        channelId,
        aspectRatio: "9:16",
        targetDurationSec,
        generationMode: generationPreference,
        modelOverrides: Object.keys(overridePayload).length ? overridePayload : undefined,
      })
      setTasks((current) => [result.task, ...current])
      setTitle("")
      setScript("")
      setModelOverrides({})
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建任务失败")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="empty-state">GENERGI 正在加载工作台...</div>
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">GENERGI Command Center</div>
          <h1>新建生产任务</h1>
          <p>先把想表达的内容写清楚，系统会负责把它整理成可执行的脚本、画面和成片链路。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">{MODEL_CONTROL_MODE_LABELS[modeId]}</span>
          <span className="pill pill--accent">{getChannelLabel(channelId)}</span>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

      <div className="workspace-grid">
        <section className="card card--main">
          <h2>内容母本配置</h2>
          <p className="section-note">你只需要描述这条视频想讲什么、想给人什么感觉、最后希望用户做什么，系统会完成后续生产规划。</p>

          <label className="field-label">任务名称</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：夏季新品种草短视频"
          />

          <label className="field-label">内容母本</label>
          <textarea
            className="textarea"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="直接写你要表达的内容、卖点、情绪和转化目标，不需要手动写技术提示词。"
          />

          <label className="field-label">生产模式</label>
          <div className="mode-grid">
            {bootstrap?.modes.map((mode) => (
              <button
                key={mode.id}
                className={mode.id === modeId ? "mode-card mode-card--active" : "mode-card"}
                onClick={() => setModeId(mode.id as ModelControlModeId)}
                type="button"
              >
                <div className="mode-title">{mode.label}</div>
                <div className="mode-description">{mode.description}</div>
                <div className="mode-budget">
                  预算上限 {formatCurrency(mode.budgetLimitCny)} · 单段上限 {mode.maxSingleShotSec}s
                </div>
              </button>
            ))}
          </div>

          <label className="field-label">生成方式</label>
          <div className="generation-grid">
            {(bootstrap?.generationPreferences ?? []).map((option) => (
              <button
                key={option.id}
                className={generationPreference === option.id ? "generation-card generation-card--active" : "generation-card"}
                onClick={() => setGenerationPreference(option.id)}
                type="button"
              >
                <div className="generation-card__title">{option.label}</div>
                <div className="generation-card__desc">{option.description}</div>
              </button>
            ))}
          </div>

          <label className="field-label">正片总时长</label>
          <div className="mode-grid">
            {bootstrap?.durationOptions.map((duration) => (
              <button
                key={duration}
                className={duration === targetDurationSec ? "mode-card mode-card--active" : "mode-card"}
                onClick={() => setTargetDurationSec(duration)}
                type="button"
              >
                <div className="mode-title">{duration}s</div>
                <div className="mode-description">用于控制最终成片节奏与信息密度</div>
              </button>
            ))}
          </div>

          <label className="field-label">目标渠道</label>
          <div className="channel-list">
            {bootstrap?.channels.map((channel) => (
              <button
                key={channel.id}
                className={channelId === channel.id ? "channel-card channel-card--active" : "channel-card"}
                onClick={() => setChannelId(channel.id)}
                type="button"
              >
                <strong>{channel.label}</strong>
                <span>{channel.description}</span>
              </button>
            ))}
          </div>

          <div className="planning-strip">
            <div className="planning-chip">
              <span className="planning-chip__label">成片组织方式</span>
              <strong>{routePreview}</strong>
              <span>{routePreviewDetail}</span>
            </div>
            <div className="planning-chip">
              <span className="planning-chip__label">内容处理方式</span>
              <strong>{getPreferenceLabel(generationPreference)}</strong>
              <span>{planningSummary}</span>
            </div>
          </div>
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>本次任务摘要</h3>
            <div className="metric-row"><span>生产模式</span><strong>{selectedMode?.label ?? MODEL_CONTROL_MODE_LABELS[modeId]}</strong></div>
            <div className="metric-row"><span>目标正片长度</span><strong>{targetDurationSec}s</strong></div>
            <div className="metric-row"><span>生成方式</span><strong>{getPreferenceLabel(generationPreference)}</strong></div>
            <div className="metric-row"><span>目标渠道</span><strong>{bootstrap?.channels.find((channel) => channel.id === channelId)?.label ?? channelId}</strong></div>
            <div className="metric-row"><span>成片组织</span><strong>{routePreview}</strong></div>
            <div className="metric-row"><span>模式预算上限</span><strong>{formatCurrency(selectedMode?.budgetLimitCny ?? 0)}</strong></div>
            <div className="metric-row"><span>任务级覆盖</span><strong>{overrideCount ? `${overrideCount} 项` : "未启用"}</strong></div>
            <div className="muted">{planningSummary}</div>
          </section>

          <section className="card card--compact">
            <h3>默认链路提醒</h3>
            <div className="task-list compact-list">
              <div className="task-item"><strong>优先级固定</strong><span>任务覆盖 &gt; 模式默认 &gt; 全局默认。没有临时覆盖时，系统会按模式默认解析。</span></div>
              <div className="task-item"><strong>可选池受校验状态约束</strong><span>高级覆盖只展示 `available` 记录。无论是模型还是 TTS，都不会把草稿或失效项放进下拉框。</span></div>
              <div className="task-item"><strong>创建后会冻结</strong><span>任务一旦创建，最终解析结果会冻结进任务快照，后续默认值变化不会回写历史任务。</span></div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>最近活动</h3>
            <div className="planning-summary-tags" style={{ marginBottom: 10 }}>
              <span className="pill pill--sm">运行中 {taskStatusSummary.runningCount}</span>
              <span className="pill pill--sm">已完成 {taskStatusSummary.completedCount}</span>
              {taskStatusSummary.failedCount ? <span className="pill pill--sm">异常 {taskStatusSummary.failedCount}</span> : null}
            </div>
            <div className="muted" style={{ marginBottom: 10 }}>
              最近刷新：{tasksUpdatedAt || "刚刚进入页面"}
            </div>
            <div className="task-list compact-list">
              {recentTasks.map((task) => (
                <div key={task.id} className="task-item">
                  <strong>{task.title}</strong>
                  <span>
                    {task.targetDurationSec}s · {task.status} · {task.actualDurationSec ? `实际 ${task.actualDurationSec.toFixed(1)}s` : "生成中"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="card card--advanced">
        <div className="section-header">
          <h2>任务级高级覆盖</h2>
          <button
            className="ghost-button"
            onClick={() => setOverridesOpen((current) => !current)}
            type="button"
          >
            {overridesOpen ? "收起高级覆盖" : "展开高级覆盖"}
          </button>
        </div>

        <div className="precedence-strip">
          <div className="planning-note-card">
            <strong>模式默认先确定基线</strong>
            <span>{MODEL_CONTROL_MODE_LABELS[modeId]} 会先决定每个槽位的默认解。</span>
          </div>
          <div className="planning-note-card">
            <strong>只允许真实可选池</strong>
            <span>高级覆盖下拉框只读取 `available` 记录，不支持手输临时 ID。</span>
          </div>
          <div className="planning-note-card">
            <strong>只提交改动项</strong>
            <span>提交任务时只带有值的覆盖项，留空槽位继续走模式默认 / 全局默认。</span>
          </div>
        </div>

        {overridesOpen ? (
          <div className="override-panel">
            {overrideError ? (
              <div className="alert">
                模型控制面接口当前不可用，无法提供高级覆盖池：{overrideError}
              </div>
            ) : null}

            {overrideLoading ? <div className="empty-inline">正在加载 {MODEL_CONTROL_MODE_LABELS[modeId]} 的真实可选池...</div> : null}

            {!overrideLoading && selectablePools ? (
              <div className="override-grid">
                {MODEL_CONTROL_SLOT_ORDER.map((slot) => {
                  const pool = selectablePools.pools[slot]
                  const overrideId = modelOverrides[slot] ?? ""
                  const overrideOption = findOption(selectablePools, slot, overrideId)
                  const effectiveOption =
                    overrideOption ??
                    findOption(selectablePools, slot, pool?.effectiveId ?? pool?.modeDefaultId ?? pool?.globalDefaultId ?? null)

                  return (
                    <div
                      key={slot}
                      className={overrideOption ? "slot-override-card slot-override-card--overridden" : "slot-override-card"}
                    >
                      <div className="slot-override-card__header">
                        <div>
                          <strong>{MODEL_CONTROL_SLOT_LABELS[slot]}</strong>
                          <div className="muted">当前可选 {pool?.options.length ?? 0} 项</div>
                        </div>
                        <span className={overrideOption ? "pill pill--sm pill--accent" : "pill pill--sm"}>
                          {overrideOption ? "已覆盖" : "默认链路"}
                        </span>
                      </div>

                      <select
                        className="input"
                        value={overrideId}
                        onChange={(event) =>
                          setModelOverrides((current) => ({
                            ...current,
                            [slot]: event.target.value,
                          }))
                        }
                      >
                        <option value="">不覆盖，使用默认解析</option>
                        {(pool?.options ?? []).map((option) => (
                          <option key={option.recordId} value={option.recordId}>
                            {describeOption(option)}
                          </option>
                        ))}
                      </select>

                      <div className="slot-override-card__summary">
                        <span>全局默认：{describeOption(findOption(selectablePools, slot, pool?.globalDefaultId ?? null))}</span>
                        <span>模式默认：{describeOption(findOption(selectablePools, slot, pool?.modeDefaultId ?? null))}</span>
                        <span>最终生效：{describeOption(effectiveOption)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            <div className="planning-summary-card">
              <strong>当前有效摘要</strong>
              <span>下面展示每个槽位的来源和最终会提交给后端解析的结果。</span>
              <div className="summary-list">
                {effectiveSlotSummary.map((item) => (
                  <div key={item.slot} className="summary-row">
                    <strong>{MODEL_CONTROL_SLOT_LABELS[item.slot]}</strong>
                    <div className="summary-row__detail">
                      <span>全局默认：{describeOption(item.globalDefaultOption)}</span>
                      <span>模式默认：{describeOption(item.modeDefaultOption)}</span>
                      <span>任务覆盖：{describeOption(item.overrideOption)}</span>
                      <span>最终生效：{describeOption(item.effectiveOption)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="action-row">
              <button className="ghost-button" onClick={() => setModelOverrides({})} type="button">
                清空任务级覆盖
              </button>
              <span className="muted">当前仅会提交 {overrideCount} 个显式覆盖槽位。</span>
            </div>
          </div>
        ) : (
          <div className="planning-notes">
            <div className="planning-note-card">
              <strong>默认路径更适合大多数任务</strong>
              <span>不展开高级覆盖时，系统会直接使用当前模式的默认槽位配置。</span>
            </div>
            <div className="planning-note-card">
              <strong>只有在你明确知道要替换哪一段时再覆盖</strong>
              <span>例如只想切换文案模型或视频终稿模型，就只改对应槽位，其他保持默认。</span>
            </div>
            <div className="planning-note-card">
              <strong>高级覆盖不等于永久改默认</strong>
              <span>它只影响当前任务；要改全局或模式默认，请去模型控制中心。</span>
            </div>
          </div>
        )}

        <div className="action-row">
          <button
            className="ghost-button"
            onClick={() => {
              setTitle("")
              setScript("")
              setModelOverrides({})
            }}
            type="button"
          >
            清空输入
          </button>
          <button className="primary-button" disabled={submitting || overrideLoading} onClick={handleCreateTask} type="button">
            {submitting ? "创建中..." : overrideLoading ? "等待覆盖池刷新..." : "启动渲染队列"}
          </button>
        </div>
      </section>
    </>
  )
}
