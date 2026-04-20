import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  api,
  buildAssetCenterUrl,
  buildTaskReviewUrl,
  type RuntimeStatusResponse,
  type TaskSummary,
} from "../api"

function formatDurationDelta(task: TaskSummary) {
  if (task.actualDurationSec == null) {
    return "待产出"
  }

  const delta = task.actualDurationSec - task.targetDurationSec
  const prefix = delta > 0 ? "+" : ""
  return `${prefix}${delta.toFixed(1)}s`
}

function getTaskExceptionLabel(task: TaskSummary) {
  if (task.executionMode === "review_required" && task.blueprintStatus === "ready_for_review") {
    return `蓝图待审 v${task.blueprintVersion}`
  }

  if (task.executionMode === "review_required" && task.blueprintStatus === "approved") {
    return `蓝图已通过，待继续执行 v${task.blueprintVersion}`
  }

  if (task.executionMode === "review_required" && task.blueprintStatus === "rejected") {
    return `蓝图已驳回，待重建 v${task.blueprintVersion}`
  }

  if (task.status === "failed") {
    return "任务失败，需人工排查"
  }

  if (task.actualDurationSec != null && Math.abs(task.actualDurationSec - task.targetDurationSec) > 2) {
    return `时长偏差 ${formatDurationDelta(task)}`
  }

  return "查看当前任务上下文"
}

function getTaskActions(task: TaskSummary) {
  const actions: Array<{ label: string; to: string; tone: "primary" | "ghost" }> = []

  if (task.executionMode === "review_required" && task.blueprintStatus === "ready_for_review") {
    actions.push({
      label: `进入任务审核 · v${task.blueprintVersion}`,
      to: buildTaskReviewUrl(task),
      tone: "primary",
    })
  }

  if (task.executionMode === "review_required" && task.blueprintStatus === "approved") {
    actions.push({
      label: `继续完整生成 · v${task.blueprintVersion}`,
      to: buildTaskReviewUrl(task),
      tone: "primary",
    })
  }

  if (task.executionMode === "review_required" && task.blueprintStatus === "rejected") {
    actions.push({
      label: `查看驳回蓝图 · v${task.blueprintVersion}`,
      to: buildTaskReviewUrl(task),
      tone: "primary",
    })
  }

  if (
    task.status === "failed" ||
    (task.actualDurationSec != null && Math.abs(task.actualDurationSec - task.targetDurationSec) > 2) ||
    actions.length === 0
  ) {
    actions.push({
      label: task.status === "failed" ? "查看失败任务资产" : "打开任务资产",
      to: buildAssetCenterUrl(task.id),
      tone: actions.length === 0 ? "primary" : "ghost",
    })
  }

  return actions.slice(0, 2)
}

export function BatchDashboardPage() {
  const [searchParams] = useSearchParams()
  const focusedTaskId = searchParams.get("taskId") ?? ""

  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [runtime, setRuntime] = useState<RuntimeStatusResponse["runtime"] | null>(null)
  const [lastRefreshAt, setLastRefreshAt] = useState<string>("")
  const [isStale, setIsStale] = useState(false)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    async function load() {
      const [taskResult, runtimeResult] = await Promise.all([api.listTasks(), api.runtimeStatus()])
      setTasks(taskResult.tasks)
      setRuntime(runtimeResult.runtime)
      setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
      setIsStale(false)
      setLoadError("")
    }

    void load().catch(() => {
      setLoadError("任务或系统状态加载失败，当前结果可能不完整。")
      setIsStale(true)
    })

    const timer = window.setInterval(() => {
      void Promise.all([api.listTasks(), api.runtimeStatus()])
        .then(([taskResult, runtimeResult]) => {
          setTasks(taskResult.tasks)
          setRuntime(runtimeResult.runtime)
          setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
          setIsStale(false)
          setLoadError("")
        })
        .catch(() => {
          setIsStale(true)
          setLoadError("自动刷新失败，当前看板可能显示的是旧数据。")
        })
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
    const blueprintReviewCount = tasks.filter(
      (task) => task.executionMode === "review_required" && task.blueprintStatus === "ready_for_review",
    ).length
    const blueprintResumeCount = tasks.filter(
      (task) => task.executionMode === "review_required" && task.blueprintStatus === "approved",
    ).length
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
      blueprintReviewCount,
      blueprintResumeCount,
      inToleranceCount,
    }
  }, [tasks])

  const reviewQueue = useMemo(
    () =>
      sortedTasks
        .filter(
          (task) =>
            (task.executionMode === "review_required" &&
              (task.blueprintStatus === "ready_for_review" ||
                task.blueprintStatus === "approved" ||
                task.blueprintStatus === "rejected")) ||
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
          {loadError ? (
            <div className="review-inline-note review-inline-note--danger" role="alert">
              {loadError}
            </div>
          ) : null}
          <div className="metric-grid">
            <div className="metric-card"><span>运行中</span><strong>{metrics.runningCount}</strong></div>
            <div className="metric-card"><span>已完成</span><strong>{metrics.completedCount}</strong></div>
            <div className="metric-card"><span>异常任务</span><strong>{metrics.failedCount}</strong></div>
            <div className="metric-card"><span>增强模式</span><strong>{metrics.enhancedCount}</strong></div>
            <div className="metric-card"><span>已有成片</span><strong>{metrics.durationReadyCount}</strong></div>
            <div className="metric-card"><span>时长达标</span><strong>{metrics.inToleranceCount}</strong></div>
            <div className="metric-card"><span>待审蓝图</span><strong>{metrics.blueprintReviewCount}</strong></div>
            <div className="metric-card"><span>待继续执行</span><strong>{metrics.blueprintResumeCount}</strong></div>
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
            {sortedTasks.map((task) => {
              const actions = getTaskActions(task)
              const isFocused = focusedTaskId === task.id

              return (
                <div key={task.id} className={isFocused ? "task-item task-item--wide task-item--focused" : "task-item task-item--wide"}>
                  <div>
                    <div className="task-item__title-row">
                      <strong>{task.title}</strong>
                      {isFocused ? <span className="pill pill--sm pill--accent">当前定位</span> : null}
                    </div>
                    <span>
                      {task.targetDurationSec}s · {task.planning?.generationRouteLabel ?? "待预判"} · {task.planning?.generationPreferenceLabel ?? "待接入"}
                      {task.executionMode === "review_required" && task.blueprintStatus === "ready_for_review"
                        ? ` · 待审蓝图(v${task.blueprintVersion})`
                        : task.executionMode === "review_required" && task.blueprintStatus === "approved"
                          ? ` · 已通过待继续(v${task.blueprintVersion})`
                          : task.executionMode === "review_required" && task.blueprintStatus === "rejected"
                            ? ` · 已驳回(v${task.blueprintVersion})`
                            : ""}
                    </span>
                  </div>
                  <div>
                    <strong>{task.progressPct}%</strong>
                    <span>重试 {task.retryCount} · {task.actualDurationSec ? `偏差 ${formatDurationDelta(task)}` : "等待成片"}</span>
                  </div>
                  <div>
                    <strong>¥{task.estimatedCostCny.toFixed(2)}</strong>
                    <span>{task.status} · {task.channelId} · {getTaskExceptionLabel(task)}</span>
                  </div>
                  <div className="task-item__actions">
                    {actions.map((action, index) => (
                      <Link
                        key={`${task.id}-${action.to}-${index}`}
                        className={action.tone === "primary" ? "primary-button" : "ghost-button"}
                        to={action.to}
                      >
                        {action.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
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
              共 {reviewQueue.length} 条任务正在等待人工确认、重新审阅或资产排查。
            </div>
            <div className="task-list compact-list">
              {reviewQueue.length ? (
                reviewQueue.map((task) => {
                  const actions = getTaskActions(task)
                  const isFocused = focusedTaskId === task.id

                  return (
                    <div key={task.id} className={isFocused ? "task-item task-item--focused" : "task-item"}>
                      <div className="task-item__title-row">
                        <strong>{task.title}</strong>
                        {isFocused ? <span className="pill pill--sm pill--accent">当前定位</span> : null}
                      </div>
                      <span>{getTaskExceptionLabel(task)}</span>
                      <div className="task-item__actions">
                        {actions.map((action, index) => (
                          <Link
                            key={`${task.id}-${action.to}-${index}`}
                            className={action.tone === "primary" ? "primary-button" : "ghost-button"}
                            to={action.to}
                          >
                            {action.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )
                })
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
