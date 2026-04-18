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

function getPreferenceLabel(preference: GenerationPreferenceId) {
  return preference === "system_enhanced" ? "启用系统增强" : "忠于原脚本"
}

function getPreferenceSummary(preference: GenerationPreferenceId) {
  return preference === "system_enhanced"
    ? "系统会保留主题方向，但主动把表达整理成更适合短视频传播的版本。"
    : "系统会尽量保留你原始内容的表达方式，只做最小必要的整理。"
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
          <p>先把想表达的内容写清楚，系统会负责把它整理成可执行的脚本、画面和成片链路。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">内容优先</span>
          <span className="pill pill--accent">
            {channelId === "tiktok" ? "TikTok" : channelId === "instagram_reels" ? "Instagram Reels" : "YouTube Shorts"}
          </span>
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
            <div className="metric-row"><span>目标正片长度</span><strong>{targetDurationSec}s</strong></div>
            <div className="metric-row"><span>生成方式</span><strong>{getPreferenceLabel(generationPreference)}</strong></div>
            <div className="metric-row"><span>目标渠道</span><strong>{bootstrap?.channels.find((channel) => channel.id === channelId)?.label ?? channelId}</strong></div>
            <div className="metric-row"><span>成片组织</span><strong>{routePreview}</strong></div>
            <div className="metric-row"><span>模式预算上限</span><strong>{formatCurrency(selectedMode?.budgetLimitCny ?? 0)}</strong></div>
            <div className="muted">{planningSummary}</div>
          </section>

          <section className="card card--compact">
            <h3>系统会自动完成</h3>
            <div className="task-list compact-list">
              <div className="task-item"><strong>脚本整理</strong><span>把内容母本整理成可直接配音的英文脚本</span></div>
              <div className="task-item"><strong>画面规划</strong><span>生成分镜、关键帧方向和视频提示</span></div>
              <div className="task-item"><strong>交付对齐</strong><span>尽量把字幕、语音、视频和最终成片对齐</span></div>
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
          <h2>生成前提醒</h2>
        </div>
        <div className="planning-notes">
          <div className="planning-note-card">
            <strong>先把内容写清楚</strong>
            <span>不要写技术提示词，直接写视频想表达的内容、情绪和转化目标就够了。</span>
          </div>
          <div className="planning-note-card">
            <strong>系统会负责生产规划</strong>
            <span>系统会在后台决定怎么组织脚本、画面和最终成片，不需要你手动拆分镜。</span>
          </div>
          <div className="planning-note-card">
            <strong>结果仍要回看</strong>
            <span>创建后可以在分镜、关键帧和资产页继续确认内容是否连贯、时长是否达标。</span>
          </div>
        </div>
        <div className="action-row">
          <button
            className="ghost-button"
            onClick={() => {
              setTitle("")
              setScript("")
            }}
            type="button"
          >
            清空输入
          </button>
          <button className="primary-button" disabled={submitting} onClick={handleCreateTask} type="button">
            {submitting ? "创建中..." : "启动渲染队列"}
          </button>
        </div>
      </section>
    </>
  )
}
