import { useEffect, useState } from "react"
import { api, type RuntimeStatusResponse, type TaskSummary } from "../api"

export function BatchDashboardPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [runtime, setRuntime] = useState<RuntimeStatusResponse["runtime"] | null>(null)

  useEffect(() => {
    async function load() {
      const [taskResult, runtimeResult] = await Promise.all([api.listTasks(), api.runtimeStatus()])
      setTasks(taskResult.tasks)
      setRuntime(runtimeResult.runtime)
    }

    void load().catch(() => {})

    const timer = window.setInterval(() => {
      void Promise.all([api.listTasks(), api.runtimeStatus()])
        .then(([taskResult, runtimeResult]) => {
          setTasks(taskResult.tasks)
          setRuntime(runtimeResult.runtime)
        })
        .catch(() => {})
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Batch Command Center</div>
          <h1>批量任务看板</h1>
          <p>监控队列、预算池、worker 运行状态和失败恢复情况。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">今日预算池</span>
          <span className="pill pill--accent">高风险任务 1</span>
        </div>
      </header>

      <div className="review-grid">
        <section className="card">
          <h3>批次筛选</h3>
          <div className="scene-list">
            <button className="scene-chip scene-chip--active"><strong>Today</strong><span>8 批次</span></button>
            <button className="scene-chip"><strong>Pending Review</strong><span>3 批次</span></button>
            <button className="scene-chip"><strong>Critical</strong><span>1 批次</span></button>
          </div>
        </section>

        <section className="card">
          <div className="section-header">
            <h3>任务队列</h3>
            <button className="ghost-button">批量导入</button>
          </div>
          <div className="task-list">
            {tasks.map((task) => (
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
                  <strong>¥{task.estimatedCostCny.toFixed(2)}</strong>
                  <span>{task.status}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>今日预算池</h3>
            <div className="metric-row"><span>预算上限</span><strong>¥300</strong></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: '58%' }} /></div>
            <div className="muted">今日已用 58%</div>
          </section>
          <section className="card card--compact">
            <h3>Worker 状态</h3>
            <div className="task-list compact-list">
              <div className="task-item"><strong>{runtime?.worker.name ?? "worker"}</strong><span>{runtime?.worker.status ?? "unknown"} · {runtime?.worker.message ?? "N/A"}</span></div>
              <div className="task-item"><strong>{runtime?.api.name ?? "api"}</strong><span>{runtime?.api.status ?? "unknown"} · {runtime?.api.message ?? "N/A"}</span></div>
              <div className="task-item"><strong>{runtime?.redis.name ?? "redis"}</strong><span>{runtime?.redis.status ?? "unknown"} · {runtime?.redis.message ?? "N/A"}</span></div>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
