import { useEffect, useState } from "react"
import { api, type RuntimeStatusResponse, type TaskSummary } from "../api"

export function BatchDashboardPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [runtime, setRuntime] = useState<RuntimeStatusResponse["runtime"] | null>(null)

  const planningSignal = tasks[0]?.planning

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
          <p>监控队列、预算池、worker 运行状态和任务规划摘要，先看内容推进是否顺畅。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">{planningSignal?.generationRouteLabel ?? "待预判"}</span>
          <span className="pill pill--accent">{planningSignal?.generationPreferenceLabel ?? "待接入"}</span>
        </div>
      </header>

      <div className="review-grid">
        <section className="card">
          <h3>批次筛选</h3>
          <div className="scene-list">
            <button className="scene-chip scene-chip--active"><strong>今日任务</strong><span>{planningSignal?.targetDurationSec ?? "?"}s 预判</span></button>
            <button className="scene-chip"><strong>待审阅</strong><span>{planningSignal?.generationRouteLabel ?? "待预判"}</span></button>
            <button className="scene-chip"><strong>增强模式</strong><span>{planningSignal?.generationPreferenceLabel ?? "待接入"}</span></button>
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
                  <span>
                    {task.targetDurationSec}s · {task.planning?.generationRouteLabel ?? "待预判"} · {task.planning?.generationPreferenceLabel ?? "待接入"}
                  </span>
                </div>
                <div>
                  <strong>{task.progressPct}%</strong>
                  <span>重试 {task.retryCount} {task.actualDurationSec ? `· 实际 ${task.actualDurationSec.toFixed(1)}s` : ""}</span>
                </div>
                <div>
                  <strong>¥{task.estimatedCostCny.toFixed(2)}</strong>
                  <span>{task.status} · {task.channelId}</span>
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
            <div className="muted" style={{ marginTop: 8 }}>{planningSignal?.planningSummary ?? "当前看板将展示任务规划摘要。"}</div>
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
