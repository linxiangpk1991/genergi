import { useEffect, useMemo, useState } from "react"
import {
  api,
  type BootstrapResponse,
  type GenerationPreferenceId,
  type TaskSummary,
} from "../api"

function formatCurrency(value: number) {
  return `¥${value.toFixed(2)}`
}

function getSceneCountHint(durationSec: number) {
  if (durationSec <= 15) {
    return 3
  }

  if (durationSec <= 30) {
    return 5
  }

  if (durationSec <= 45) {
    return 7
  }

  return 8
}

function getPreferenceLabel(preference: GenerationPreferenceId) {
  return preference === "system_enhanced" ? "启用系统增强" : "忠于原脚本"
}

function getPreferenceSummary(preference: GenerationPreferenceId) {
  return preference === "system_enhanced"
    ? "系统会在不偏离主题的前提下，自动补充更适合平台传播的导演式提示词。"
    : "系统会尽量保留你的原始内容表达，只做最小必要的结构整理。"
}

function getPreferenceKeywords(preference: GenerationPreferenceId) {
  return preference === "system_enhanced"
    ? ["更强开头钩子", "更自然口播", "更适合平台传播", "更直接 CTA"]
    : ["忠于原脚本", "保留内容母本", "最小必要结构化整理"]
}

export function HomePage() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [title, setTitle] = useState("")
  const [script, setScript] = useState("")
  const [modeId, setModeId] = useState("mass_production")
  const [channelId, setChannelId] = useState("tiktok")
  const [targetDurationSec, setTargetDurationSec] = useState(30)
  const [generationPreference, setGenerationPreference] = useState<GenerationPreferenceId>("user_locked")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    async function load() {
      try {
        const [bootstrapRes, taskRes] = await Promise.all([api.bootstrap(), api.listTasks()])
        setBootstrap(bootstrapRes)
        setTasks(taskRes.tasks)
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
      void api.listTasks().then((taskRes) => setTasks(taskRes.tasks)).catch(() => {})
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])

  const selectedMode = useMemo(
    () => bootstrap?.modes.find((mode) => mode.id === modeId) ?? null,
    [bootstrap, modeId],
  )

  const selectedDuration = useMemo(() => targetDurationSec, [targetDurationSec])
  const sceneCountHint = getSceneCountHint(selectedDuration)
  const planningKeywords = getPreferenceKeywords(generationPreference)
  const planningSummary = getPreferenceSummary(generationPreference)
  const currentModeCapability = selectedMode?.maxSingleShotSec ?? 8
  const routePreview = selectedDuration <= currentModeCapability ? "单段直出" : "多分镜编排"
  const routePreviewDetail =
    selectedDuration <= currentModeCapability
      ? `当前模型支持 ${currentModeCapability}s 单段输出，可优先尝试一条过。`
      : `当前模型单段最长约 ${currentModeCapability}s，系统将自动按多分镜规划。`

  async function handleCreateTask() {
    if (!title.trim() || !script.trim()) {
      setError("请先填写任务名称和内容母本")
      return
    }

    setSubmitting(true)
    setError("")
    try {
      const result = await api.createTask({
        title,
        script,
        modeId,
        channelId,
        aspectRatio: "9:16",
        targetDurationSec,
        generationMode: generationPreference,
      })
      setTasks((current) => [result.task, ...current])
      setTitle("")
      setScript("")
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
          <p>先写内容母本，再由系统按总时长与生成方式自动补全分镜和提示词。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">内容优先</span>
          <span className="pill pill--accent">English Output</span>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

      <div className="workspace-grid">
        <section className="card card--main">
          <h2>内容母本配置</h2>
          <p className="section-note">用户只需要描述视频想表达什么，系统会负责把它翻译成可生成的脚本、分镜与提示词。</p>

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
            placeholder="把你想表达的核心信息、产品素材、情绪节奏和转化意图直接写在这里，系统会自动补全导演式提示词。"
          />

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
                <div className="mode-description">系统会据此预判分镜数量与提示词长度</div>
              </button>
            ))}
          </div>

          <div className="planning-strip">
            <div className="planning-chip">
              <span className="planning-chip__label">系统预判</span>
              <strong>{routePreview}</strong>
              <span>{routePreviewDetail}</span>
            </div>
            <div className="planning-chip">
              <span className="planning-chip__label">内容策略</span>
              <strong>{getPreferenceLabel(generationPreference)}</strong>
              <span>{planningSummary}</span>
            </div>
          </div>
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>执行摘要预估</h3>
            <div className="metric-row"><span>目标正片长度</span><strong>{selectedDuration}s</strong></div>
            <div className="metric-row"><span>预判分镜数</span><strong>{sceneCountHint} scenes</strong></div>
            <div className="metric-row"><span>提示词策略</span><strong>{getPreferenceLabel(generationPreference)}</strong></div>
            <div className="metric-row metric-row--stacked">
              <span>关键词包</span>
              <div className="keyword-list">
                {planningKeywords.map((keyword) => (
                  <span key={keyword} className="keyword-pill">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${selectedMode?.budgetLimitCny ? 85 : 55}%` }} /></div>
            <div className="muted">今日预算消耗警告 85%</div>
          </section>

          <section className="card card--compact">
            <h3>目标分发渠道</h3>
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
          </section>

          <section className="card card--compact">
            <h3>最近活动</h3>
            <div className="task-list compact-list">
              {tasks.slice(0, 3).map((task) => (
                <div key={task.id} className="task-item">
                  <strong>{task.title}</strong>
                  <span>
                    {task.planning?.generationRouteLabel ?? "待预判"} · {task.targetDurationSec}s ·{" "}
                    {task.planning?.generationPreferenceLabel ?? "待接入"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="card card--advanced">
        <div className="section-header">
          <h2>提示词说明</h2>
          <button className="ghost-button" type="button">
            重置默认
          </button>
        </div>
        <div className="planning-notes">
          <div className="planning-note-card">
            <strong>内容优先</strong>
            <span>用户脚本是整条视频的内容母本，后续分镜、关键帧和视频提示词都从这里展开。</span>
          </div>
          <div className="planning-note-card">
            <strong>系统自动补全</strong>
            <span>系统会把时长、生成方式和内容策略一起转成文本模型可用的规划约束。</span>
          </div>
          <div className="planning-note-card">
            <strong>主线程待接入</strong>
            <span>当前页面先做兼容展示，真实模型能力表与完整生成路由后续由主线程接入。</span>
          </div>
        </div>
        <div className="action-row">
          <button className="ghost-button" type="button">
            保存草稿
          </button>
          <button className="primary-button" disabled={submitting} onClick={handleCreateTask} type="button">
            {submitting ? "创建中..." : "启动渲染队列"}
          </button>
        </div>
      </section>
    </>
  )
}
