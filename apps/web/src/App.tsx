import { useEffect, useMemo, useState } from "react"
import { api, type BootstrapResponse, type TaskSummary } from "./api"

function formatCurrency(value: number) {
  return `¥${value.toFixed(2)}`
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [title, setTitle] = useState("")
  const [script, setScript] = useState("")
  const [modeId, setModeId] = useState("mass_production")
  const [channelId, setChannelId] = useState("tiktok")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    async function load() {
      try {
        const [bootstrapRes, taskRes] = await Promise.all([api.bootstrap(), api.listTasks()])
        setBootstrap(bootstrapRes)
        setTasks(taskRes.tasks)
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败")
      } finally {
        setLoading(false)
      }
    }
    void load()
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
    return <div className="page-shell"><div className="empty-state">GENERGI 正在加载工作台...</div></div>
  }

  return (
    <div className="page-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-mark">G</div>
          <div className="brand-name">GENERGI</div>
          <div className="brand-subtitle">自动化视频平台</div>
        </div>
        <nav className="nav-list">
          <button className="nav-item nav-item--active">任务启动</button>
          <button className="nav-item">脚本管理</button>
          <button className="nav-item">批量任务</button>
          <button className="nav-item">素材资产</button>
          <button className="nav-item">系统设置</button>
        </nav>
        <button className="primary-button primary-button--sidebar">+ New Task</button>
      </aside>

      <main className="workspace">
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
          </section>

          <aside className="side-panel">
            <section className="card card--compact">
              <h3>执行摘要预估</h3>
              <div className="metric-row"><span>预计总耗时</span><strong>45m</strong></div>
              <div className="metric-row"><span>单次渲染量</span><strong>12 / 20</strong></div>
              <div className="metric-row"><span>总生成本</span><strong>1.2 CR</strong></div>
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
                    <span>{task.status} · {new Date(task.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
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
              <button
                key={mode.id}
                className={mode.id === modeId ? "mode-card mode-card--active" : "mode-card"}
                onClick={() => setModeId(mode.id)}
              >
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

        <section className="card card--batch">
          <div className="section-header">
            <h2>批量任务摘要</h2>
            <button className="ghost-button">查看全部批次</button>
          </div>
          <div className="task-list">
            {tasks.length ? tasks.map((task) => (
              <div key={task.id} className="task-item task-item--wide">
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.modeId} · {task.channelId}</span>
                </div>
                <div>
                  <strong>{task.progressPct}%</strong>
                  <span>重试 {task.retryCount}</span>
                </div>
                <div>
                  <strong>{formatCurrency(task.estimatedCostCny)}</strong>
                  <span>{task.status}</span>
                </div>
              </div>
            )) : <div className="empty-inline">还没有任务，先从上方创建一个任务。</div>}
          </div>
        </section>
      </main>
    </div>
  )
}
