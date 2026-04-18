import { useEffect, useMemo, useState } from "react"
import { api, type RuntimeStatusResponse, type TaskSummary } from "../api"

function formatDurationDelta(task: TaskSummary) {
  if (task.actualDurationSec == null) {
    return "待产出"
  }

  const delta = task.actualDurationSec - task.targetDurationSec
  const prefix = delta > 0 ? "+" : ""
  return `${prefix}${delta.toFixed(1)}s`
}

export function BatchDashboardPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [runtime, setRuntime] = useState<RuntimeStatusResponse["runtime"] | null>(null)
  const [lastRefreshAt, setLastRefreshAt] = useState<string>("")
  const [isStale, setIsStale] = useState(false)

  useEffect(() => {
    async function load() {
      const [taskResult, runtimeResult] = await Promise.all([api.listTasks(), api.runtimeStatus()])
      setTasks(taskResult.tasks)
      setRuntime(runtimeResult.runtime)
      setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
      setIsStale(false)
    }

    void load().catch(() => {})

    const timer = window.setInterval(() => {
      void Promise.all([api.listTasks(), api.runtimeStatus()])
        .then(([taskResult, runtimeResult]) => {
          setTasks(taskResult.tasks)
          setRuntime(runtimeResult.runtime)
          setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
          setIsStale(false)
        })
        .catch(() => setIsStale(true))
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])
  const sortedTasks = useMemo(
    () => [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [tasks],
  )

  const metrics = useMemo(() => {
    const runningCount = tasks.filter((task) => task.status === "running").length
    const completedCount = tasks.filter((task) => task.status === "completed").length
    const failedCount = tasks.filter((task) => task.status === "failed").length
    const enhancedCount = tasks.filter((task) => task.generationMode === "system_enhanced").length
    const durationReadyCount = tasks.filter((task) => task.actualDurationSec != null).length
    const storyboardReviewCount = tasks.filter((task) => task.reviewStage === "storyboard_review").length
    const keyframeReviewCount = tasks.filter((task) => task.reviewStage === "keyframe_review").length
    const inToleranceCount = tasks.filter((task) => {
      if (task.actualDurationSec == null) {
        return false
      }
      return Math.abs(task.actualDurationSec - task.targetDurationSec) <= 2
    }).length

    return {
      runningCount,
      completedCount,
      failedCount,
      enhancedCount,
      durationReadyCount,
      storyboardReviewCount,
      keyframeReviewCount,
      inToleranceCount,
    }
  }, [tasks])

  const reviewQueue = useMemo(
    () =>
      sortedTasks
        .filter(
          (task) =>
            task.reviewStage === "storyboard_review" ||
            task.reviewStage === "keyframe_review" ||
            task.status === "failed" ||
            (task.actualDurationSec != null && Math.abs(task.actualDurationSec - task.targetDurationSec) > 2),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [sortedTasks],
  )

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Batch Command Center</div>
          <h1>批量任务看板</h1>
          <p>这里只展示真实任务、真实运行状态和需要人工处理的异常，不再把单条任务伪装成整个批次结论。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">任务总数 {tasks.length}</span>
          <span className="pill pill--accent">运行中 {metrics.runningCount}</span>
        </div>
      </header>

      <div className="review-grid">
        <section className="card">
          <h3>生产概览</h3>
          <div className="metric-grid">
            <div className="metric-card"><span>运行中</span><strong>{metrics.runningCount}</strong></div>
            <div className="metric-card"><span>已完成</span><strong>{metrics.completedCount}</strong></div>
            <div className="metric-card"><span>异常任务</span><strong>{metrics.failedCount}</strong></div>
            <div className="metric-card"><span>增强模式</span><strong>{metrics.enhancedCount}</strong></div>
            <div className="metric-card"><span>已有成片</span><strong>{metrics.durationReadyCount}</strong></div>
            <div className="metric-card"><span>时长达标</span><strong>{metrics.inToleranceCount}</strong></div>
            <div className="metric-card"><span>待审分镜</span><strong>{metrics.storyboardReviewCount}</strong></div>
            <div className="metric-card"><span>待审关键帧</span><strong>{metrics.keyframeReviewCount}</strong></div>
          </div>
        </section>

        <section className="card">
          <div className="section-header">
            <h3>任务队列</h3>
            <span className="muted">
              最近刷新：{lastRefreshAt || "刚刚进入页面"}{isStale ? " · 数据可能已过期" : ""}
            </span>
          </div>
          <div className="task-list">
            {sortedTasks.map((task) => (
              <div key={task.id} className="task-item task-item--wide">
                <div>
                  <strong>{task.title}</strong>
                  <span>
                    {task.targetDurationSec}s · {task.planning?.generationRouteLabel ?? "待预判"} · {task.planning?.generationPreferenceLabel ?? "待接入"}
                    {task.reviewStage === "storyboard_review"
                      ? ` · 待审分镜(${task.pendingReviewCount ?? 0})`
                      : task.reviewStage === "keyframe_review"
                        ? ` · 待审关键帧(${task.pendingReviewCount ?? 0})`
                        : task.reviewStage === "auto_qa"
                          ? " · 自动 QA"
                          : ""}
                  </span>
                </div>
                <div>
                  <strong>{task.progressPct}%</strong>
                  <span>重试 {task.retryCount} · {task.actualDurationSec ? `偏差 ${formatDurationDelta(task)}` : "等待成片"}</span>
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
            <h3>系统健康</h3>
            <div className="task-list compact-list">
              <div className="task-item"><strong>{runtime?.worker.name ?? "worker"}</strong><span>{runtime?.worker.status ?? "unknown"} · {runtime?.worker.message ?? "N/A"}</span></div>
              <div className="task-item"><strong>{runtime?.api.name ?? "api"}</strong><span>{runtime?.api.status ?? "unknown"} · {runtime?.api.message ?? "N/A"}</span></div>
              <div className="task-item"><strong>{runtime?.redis.name ?? "redis"}</strong><span>{runtime?.redis.status ?? "unknown"} · {runtime?.redis.message ?? "N/A"}</span></div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>内容结构分布</h3>
            <div className="task-list compact-list">
              <div className="task-item"><strong>多段成片</strong><span>{tasks.filter((task) => task.generationRoute === "multi_scene").length} 条任务</span></div>
              <div className="task-item"><strong>忠于原脚本</strong><span>{tasks.filter((task) => task.generationMode === "user_locked").length} 条任务</span></div>
              <div className="task-item"><strong>启用系统增强</strong><span>{metrics.enhancedCount} 条任务</span></div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>需要复核</h3>
            <div className="muted" style={{ marginBottom: 10 }}>
              共 {reviewQueue.length} 条任务正在等待人工确认或重试。
            </div>
            <div className="task-list compact-list">
              {reviewQueue.length ? (
                reviewQueue.map((task) => (
                  <div key={task.id} className="task-item">
                    <strong>{task.title}</strong>
                    <span>
                      {task.reviewStage === "storyboard_review"
                        ? `分镜待审 ${task.pendingReviewCount ?? 0} 项`
                        : task.reviewStage === "keyframe_review"
                          ? `关键帧待审 ${task.pendingReviewCount ?? 0} 项`
                          : task.status === "failed"
                        ? "任务失败，需人工重试"
                        : `时长偏差 ${formatDurationDelta(task)}`}
                    </span>
                  </div>
                ))
              ) : (
                <div className="task-item">
                  <strong>暂无重点异常</strong>
                  <span>当前任务都在正常推进或已基本达标。</span>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
