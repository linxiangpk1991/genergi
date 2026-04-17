import { useEffect, useMemo, useState } from "react"
import { api, type BootstrapResponse, type TaskSummary } from "../api"

function formatCurrency(value: number) {
  return `¥${value.toFixed(2)}`
}

export function HomePage() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [title, setTitle] = useState("")
  const [script, setScript] = useState("")
  const [modeId, setModeId] = useState("mass_production")
  const [channelId, setChannelId] = useState("tiktok")
  const [targetDurationSec, setTargetDurationSec] = useState(30)
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

  async function handleCreateTask() {
    if (!title.trim() || !script.trim()) {
      setError("请先填写任务名称和核心脚本")
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
          <p>配置你的英语短视频生产任务，并以批处理通道进入自动执行流程。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">中文后台</span>
          <span className="pill pill--accent">English Output</span>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

      <div className="workspace-grid">
        <section className="card card--main">
          <h2>核心脚本配置</h2>
          <label className="field-label">任务名称</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：Summer Promo - Product Hook Series" />
          <label className="field-label">核心脚本</label>
          <textarea className="textarea" value={script} onChange={(e) => setScript(e.target.value)} placeholder="输入你的核心脚本或英文脚本大纲，用于自动化视频生产..." />
          <div className="inline-actions">
            <span className="muted">AI 智能增强</span>
            <button className="ghost-button">导入文件</button>
            <button className="ghost-button">加载草稿</button>
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
                <div className="mode-description">系统将自动规划 scene 数、每段时长与最终拼接长度</div>
              </button>
            ))}
          </div>
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>执行摘要预估</h3>
            <div className="metric-row"><span>目标正片长度</span><strong>{targetDurationSec}s</strong></div>
            <div className="metric-row"><span>单次渲染量</span><strong>{targetDurationSec <= 15 ? "3 scenes" : targetDurationSec <= 30 ? "5 scenes" : targetDurationSec <= 45 ? "7 scenes" : "8 scenes"}</strong></div>
            <div className="metric-row"><span>总生成本</span><strong>1.2 CR</strong></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${selectedMode?.budgetLimitCny ? 85 : 55}%` }} /></div>
            <div className="muted">今日预算消耗警告 85%</div>
          </section>

          <section className="card card--compact">
            <h3>目标分发渠道</h3>
            <div className="channel-list">
              {bootstrap?.channels.map((channel) => (
                <button key={channel.id} className={channelId === channel.id ? "channel-card channel-card--active" : "channel-card"} onClick={() => setChannelId(channel.id)}>
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
                  <span>{task.status} · {task.targetDurationSec}s · {new Date(task.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="card card--modes">
        <h2>创作模式</h2>
        <div className="mode-grid">
          {bootstrap?.modes.map((mode) => (
            <button key={mode.id} className={mode.id === modeId ? "mode-card mode-card--active" : "mode-card"} onClick={() => setModeId(mode.id)}>
              <div className="mode-title">{mode.label}</div>
              <div className="mode-description">{mode.description}</div>
              <div className="mode-budget">预算上限 {formatCurrency(mode.budgetLimitCny)}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="card card--advanced">
        <div className="section-header">
          <h2>高级参数设置</h2>
          <button className="ghost-button">重置默认</button>
        </div>
        <div className="advanced-grid">
          <div>
            <label className="field-label">输出分辨率</label>
            <select className="input"><option>1080p (1920×1080)</option><option>720p (1280×720)</option></select>
          </div>
          <div>
            <label className="field-label">目标帧率 (FPS)</label>
            <select className="input"><option>60 FPS</option><option>30 FPS</option></select>
          </div>
          <div>
            <label className="field-label">配音语言</label>
            <select className="input"><option>English (US)</option><option>English (UK)</option><option>English (AU)</option></select>
          </div>
          <div>
            <label className="field-label">配音风格</label>
            <select className="input"><option>Energetic & Fast</option><option>Clean & Professional</option><option>Warm & Friendly</option></select>
          </div>
        </div>
        <div className="action-row">
          <button className="ghost-button">保存草稿</button>
          <button className="primary-button" disabled={submitting} onClick={handleCreateTask}>{submitting ? '创建中...' : '启动渲染队列'}</button>
        </div>
      </section>
    </>
  )
}
