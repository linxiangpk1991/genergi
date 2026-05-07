import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  api,
  buildAssetCenterUrl,
  buildTaskReviewUrl,
  getAudioStrategyLabel,
  type RuntimeStatusResponse,
  type TaskSummary,
} from "../api"

type ProductionLaneId = "queued" | "running" | "waiting_review" | "blocked" | "failed" | "completed"

type TaskAction = {
  label: string
  to: string
  tone: "primary" | "ghost"
}

const productionLanes: Array<{ id: ProductionLaneId; label: string; description: string }> = [
  { id: "queued", label: "queued", description: "已入队，等待 worker 接单" },
  { id: "running", label: "running", description: "正在生成，重点看阶段和心跳" },
  { id: "waiting_review", label: "waiting_review", description: "蓝图待审、已通过待继续或已驳回待处理" },
  { id: "blocked", label: "blocked", description: "心跳过期、取消中或需要人工保守恢复" },
  { id: "failed", label: "failed", description: "生成链失败，先分类再处理" },
  { id: "completed", label: "completed", description: "已完成，进入交付验收" },
]

function formatDurationDelta(task: TaskSummary) {
  if (task.actualDurationSec == null) {
    return "待产出"
  }

  const delta = task.actualDurationSec - task.targetDurationSec
  const prefix = delta > 0 ? "+" : ""
  return `${prefix}${delta.toFixed(1)}s`
}

function getTaskExceptionLabel(task: TaskSummary) {
  if (task.statusDetail?.trim()) {
    return task.statusDetail.trim()
  }

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

function canCancelTask(task: TaskSummary) {
  return task.status === "queued" || task.status === "running"
}

function canResumeFailedTask(task: TaskSummary) {
  return task.status === "failed"
}

function isStaleRunningTask(task: TaskSummary) {
  if (task.status !== "running") {
    return false
  }

  const updatedAtMs = Date.parse(task.lastHeartbeatAt ?? task.updatedAt)
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs >= 10 * 60 * 1000
}

function formatRelativeAge(dateValue?: string | null) {
  if (!dateValue) {
    return "未知"
  }

  const dateMs = Date.parse(dateValue)
  if (!Number.isFinite(dateMs)) {
    return "未知"
  }

  const ageMs = Math.max(0, Date.now() - dateMs)
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 1) {
    return "刚刚"
  }

  if (minutes < 60) {
    return `${minutes} 分钟前`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} 小时前`
  }

  return `${Math.floor(hours / 24)} 天前`
}

function formatDurationFromMs(durationMs: number) {
  const minutes = Math.max(1, Math.round(durationMs / 60_000))
  if (minutes < 60) {
    return `约 ${minutes} 分钟`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `约 ${hours} 小时 ${remainingMinutes} 分钟` : `约 ${hours} 小时`
}

function getTaskLane(task: TaskSummary): ProductionLaneId {
  if (task.status === "completed") {
    return "completed"
  }

  if (task.status === "failed") {
    return "failed"
  }

  if (isStaleRunningTask(task) || task.cancelRequestedAt) {
    return "blocked"
  }

  if (task.status === "waiting_review") {
    return "waiting_review"
  }

  if (
    task.executionMode === "review_required" &&
    (task.blueprintStatus === "ready_for_review" ||
      task.blueprintStatus === "approved" ||
      task.blueprintStatus === "rejected")
  ) {
    return "waiting_review"
  }

  if (task.status === "queued") {
    return "queued"
  }

  if (task.status === "running") {
    return "running"
  }

  return "blocked"
}

function getTaskEta(task: TaskSummary) {
  const lane = getTaskLane(task)

  if (lane === "completed") {
    return "已完成"
  }

  if (lane === "failed") {
    return "已停止"
  }

  if (lane === "queued") {
    return "等待调度"
  }

  if (lane === "blocked") {
    return isStaleRunningTask(task) ? "已卡住" : "等待人工动作"
  }

  if (lane === "waiting_review") {
    return "等待人工动作"
  }

  if (task.progressPct <= 0 || task.progressPct >= 100) {
    return "计算中"
  }

  const startedAtMs = Date.parse(task.stageStartedAt ?? task.createdAt)
  if (!Number.isFinite(startedAtMs)) {
    return "计算中"
  }

  const elapsedMs = Math.max(60_000, Date.now() - startedAtMs)
  const remainingMs = (elapsedMs / task.progressPct) * (100 - task.progressPct)
  return formatDurationFromMs(remainingMs)
}

function getTaskHeartbeat(task: TaskSummary) {
  const heartbeat = formatRelativeAge(task.lastHeartbeatAt ?? task.updatedAt)
  const worker = task.workerId ? ` · ${task.workerId}` : ""
  const job = task.activeJobId ? ` · ${task.activeJobId}` : ""
  return `心跳 ${heartbeat}${worker}${job}`
}

function getFailureCategory(task: TaskSummary) {
  if (task.status !== "failed") {
    return "normal"
  }

  const reason = `${task.failureReason ?? ""} ${task.statusDetail ?? ""}`.toLowerCase()

  if (reason.includes("timeout") || reason.includes("超时")) {
    return "provider_timeout"
  }

  if (reason.includes("quota") || reason.includes("rate limit") || reason.includes("限流") || reason.includes("额度")) {
    return "provider_quota"
  }

  if (reason.includes("asset") || reason.includes("file") || reason.includes("missing") || reason.includes("缺失")) {
    return "asset_missing"
  }

  if (reason.includes("blueprint") || reason.includes("prompt") || reason.includes("蓝图") || reason.includes("提示词")) {
    return "blueprint_contract"
  }

  return "execution_error"
}

function getRecommendedAction(task: TaskSummary) {
  const lane = getTaskLane(task)
  const failureCategory = getFailureCategory(task)

  if (lane === "blocked") {
    return "保守继续：先打开资产排查，再恢复卡住任务"
  }

  if (lane === "waiting_review") {
    if (task.blueprintStatus === "approved") {
      return "进入任务审核，确认版本后继续完整生成"
    }

    if (task.blueprintStatus === "rejected") {
      return "进入任务审核，查看驳回原因后重建蓝图"
    }

    return "进入任务审核，先通过或驳回蓝图"
  }

  if (lane === "failed") {
    if (failureCategory === "provider_timeout" || failureCategory === "provider_quota") {
      return "先打开资产排查，确认已产出，再恢复运行"
    }

    if (failureCategory === "asset_missing") {
      return "先打开资产中心，确认缺失文件后再决定是否恢复"
    }

    return "先看失败详情和资产缺口，再恢复运行"
  }

  if (lane === "queued") {
    return "观察 worker 容量，避免重复提交"
  }

  if (lane === "running") {
    return "观察心跳和阶段进度，超过 10 分钟无心跳再处理"
  }

  return "进入资产中心做交付验收"
}

function canResumeTask(task: TaskSummary) {
  return canResumeFailedTask(task) || isStaleRunningTask(task)
}

function getTaskActions(task: TaskSummary) {
  const actions: TaskAction[] = []

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
  const [actionError, setActionError] = useState("")
  const [cancelingTaskId, setCancelingTaskId] = useState("")
  const [resumingTaskId, setResumingTaskId] = useState("")

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

  async function handleCancelTask(taskId: string) {
    setActionError("")
    setCancelingTaskId(taskId)
    try {
      const response = await api.cancelTask(taskId)
      setTasks((current) => current.map((task) => (task.id === taskId ? response.task : task)))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "终止任务失败")
    } finally {
      setCancelingTaskId("")
    }
  }

  async function handleResumeFailedTask(taskId: string) {
    setActionError("")
    setResumingTaskId(taskId)
    try {
      const response = await api.resumeFailedTask(taskId)
      setTasks((current) => current.map((task) => (task.id === taskId ? response.task : task)))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "恢复运行失败")
    } finally {
      setResumingTaskId("")
    }
  }

  const sortedTasks = useMemo(
    () => [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [tasks],
  )

  const metrics = useMemo(() => {
    const runningCount = tasks.filter((task) => task.status === "running").length
    const completedCount = tasks.filter((task) => task.status === "completed").length
    const failedCount = tasks.filter((task) => task.status === "failed").length
    const blockedCount = tasks.filter((task) => getTaskLane(task) === "blocked").length
    const queuedCount = tasks.filter((task) => getTaskLane(task) === "queued").length
    const sourceLockedCount = tasks.filter((task) => task.generationMode === "user_locked").length
    const legacyEnhancedCount = tasks.filter((task) => task.generationMode === "system_enhanced").length
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
      blockedCount,
      queuedCount,
      sourceLockedCount,
      legacyEnhancedCount,
      durationReadyCount,
      blueprintReviewCount,
      blueprintResumeCount,
      inToleranceCount,
    }
  }, [tasks])

  const laneStats = useMemo(
    () =>
      productionLanes.map((lane) => ({
        ...lane,
        count: tasks.filter((task) => getTaskLane(task) === lane.id).length,
      })),
    [tasks],
  )

  const stuckTasks = useMemo(
    () =>
      sortedTasks.filter((task) => getTaskLane(task) === "blocked" || isStaleRunningTask(task)),
    [sortedTasks],
  )

  const capacityState = useMemo(() => {
    const workerStatus = runtime?.worker.status ?? "degraded"
    const redisStatus = runtime?.redis.status ?? "degraded"
    const isDegraded = workerStatus !== "healthy" || redisStatus !== "healthy" || metrics.blockedCount > 0
    const recommendation = isDegraded
      ? "先处理 blocked / failed，再追加新任务；不要重复提交同一母本。"
      : metrics.queuedCount > metrics.runningCount + 2
        ? "排队数偏高，暂停追加大批量任务，等 worker 消化。"
        : "容量可接受，可以继续观察 queued 到 running 的流转。"

    return {
      status: isDegraded ? "需关注" : "可用",
      recommendation,
    }
  }, [metrics.blockedCount, metrics.queuedCount, metrics.runningCount, runtime?.redis.status, runtime?.worker.status])

  const reviewQueue = useMemo(
    () =>
      sortedTasks
        .filter(
          (task) =>
            getTaskLane(task) === "blocked" ||
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
          <h1>生产调度台</h1>
          <p>按生产 lane 观察真实任务、卡住信号、ETA、心跳和容量风险；动作入口只做安全调度，不改 BullMQ 内核。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">任务总数 {tasks.length}</span>
          <span className="pill pill--accent">运行中 {metrics.runningCount}</span>
          <span className="pill">阻塞 {metrics.blockedCount}</span>
        </div>
      </header>

      <section className="production-lane-strip" aria-label="生产 lane">
        {laneStats.map((lane) => (
          <article key={lane.id} className={lane.id === "blocked" && lane.count > 0 ? "production-lane production-lane--blocked" : "production-lane"}>
            <div className="production-lane__header">
              <strong>{lane.label}</strong>
              <span>{lane.count}</span>
            </div>
            <p>{lane.description}</p>
          </article>
        ))}
      </section>

      <div className="production-grid">
        <section className="card">
          <h3>生产概览</h3>
          {loadError ? (
            <div className="review-inline-note review-inline-note--danger" role="alert">
              {loadError}
            </div>
          ) : null}
          {actionError ? (
            <div className="review-inline-note review-inline-note--danger" role="alert">
              {actionError}
            </div>
          ) : null}
          <div className="metric-grid">
            <div className="metric-card"><span>排队中</span><strong>{metrics.queuedCount}</strong></div>
            <div className="metric-card"><span>运行中</span><strong>{metrics.runningCount}</strong></div>
            <div className="metric-card"><span>卡住任务</span><strong>{metrics.blockedCount}</strong></div>
            <div className="metric-card"><span>已完成</span><strong>{metrics.completedCount}</strong></div>
            <div className="metric-card"><span>异常任务</span><strong>{metrics.failedCount}</strong></div>
            <div className="metric-card"><span>保真优先</span><strong>{metrics.sourceLockedCount}</strong></div>
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
              const lane = getTaskLane(task)
              const failureCategory = getFailureCategory(task)
              const recommendedAction = getRecommendedAction(task)

              return (
                <div
                  key={task.id}
                  className={[
                    "task-item",
                    "task-item--wide",
                    lane === "blocked" ? "task-item--blocked" : "",
                    lane === "running" ? "task-item--running" : "",
                    isFocused ? "task-item--focused" : "",
                  ].filter(Boolean).join(" ")}
                >
                  <div>
                    <div className="task-item__title-row">
                      <strong>{task.title}</strong>
                      <span className={lane === "blocked" || lane === "failed" ? "pill pill--sm pill--danger" : "pill pill--sm"}>
                        {lane}
                      </span>
                      {isFocused ? <span className="pill pill--sm pill--accent">当前定位</span> : null}
                    </div>
                    <span>
                      {task.targetDurationSec}s · {task.planning?.generationRouteLabel ?? "待预判"} · {task.planning?.generationPreferenceLabel ?? "待接入"} · {getAudioStrategyLabel(task.audioStrategy)}
                      {task.executionMode === "review_required" && task.blueprintStatus === "ready_for_review"
                        ? ` · 待审蓝图(v${task.blueprintVersion})`
                        : task.executionMode === "review_required" && task.blueprintStatus === "approved"
                          ? ` · 已通过待继续(v${task.blueprintVersion})`
                          : task.executionMode === "review_required" && task.blueprintStatus === "rejected"
                            ? ` · 已驳回(v${task.blueprintVersion})`
                            : ""}
                    </span>
                    <span className="task-item__subline">{recommendedAction}</span>
                  </div>
                  <div>
                    <strong>{task.progressPct}%</strong>
                    <span>{task.statusDetail ?? `重试 ${task.retryCount} · ${task.actualDurationSec ? `偏差 ${formatDurationDelta(task)}` : "等待成片"}`}</span>
                    <span className="task-item__subline">预计剩余 {getTaskEta(task)}</span>
                  </div>
                  <div>
                    <strong>¥{task.estimatedCostCny.toFixed(2)}</strong>
                    <span>{task.status} · {task.channelId} · {getTaskExceptionLabel(task)}</span>
                    <span className="task-item__subline">
                      {getTaskHeartbeat(task)} · 失败分类 {failureCategory}
                    </span>
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
                    {canCancelTask(task) ? (
                      <button
                        className="ghost-button"
                        disabled={cancelingTaskId === task.id}
                        onClick={() => void handleCancelTask(task.id)}
                        type="button"
                      >
                        {cancelingTaskId === task.id ? "终止中..." : "终止任务"}
                      </button>
                    ) : null}
                    {canResumeTask(task) ? (
                      <button
                        className="ghost-button"
                        disabled={resumingTaskId === task.id}
                        onClick={() => void handleResumeFailedTask(task.id)}
                        type="button"
                      >
                        {resumingTaskId === task.id
                          ? "恢复中..."
                          : isStaleRunningTask(task)
                            ? "恢复卡住任务"
                            : "恢复运行"}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>Worker / Redis 容量</h3>
            <div className="capacity-summary">
              <strong>{capacityState.status}</strong>
              <span>运行 {metrics.runningCount} / 排队 {metrics.queuedCount} / 阻塞 {metrics.blockedCount}</span>
              <p>{capacityState.recommendation}</p>
            </div>
            <div className="task-list compact-list">
              <div className="task-item"><strong>{runtime?.worker.name ?? "worker"}</strong><span>{runtime?.worker.status ?? "unknown"} · {runtime?.worker.message ?? "N/A"}</span></div>
              <div className="task-item"><strong>{runtime?.redis.name ?? "redis"}</strong><span>{runtime?.redis.status ?? "unknown"} · {runtime?.redis.message ?? "N/A"}</span></div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>卡住任务</h3>
            <div className="task-list compact-list">
              {stuckTasks.length ? (
                stuckTasks.map((task) => (
                  <div key={task.id} className="task-item task-item--blocked">
                    <div className="task-item__title-row">
                      <strong>{task.title}</strong>
                      <span className="pill pill--sm pill--danger">blocked</span>
                    </div>
                    <span>{getTaskHeartbeat(task)} · 预计剩余 {getTaskEta(task)}</span>
                    <span className="task-item__subline">{getRecommendedAction(task)}</span>
                    <div className="task-item__actions">
                      <Link className="ghost-button" to={buildAssetCenterUrl(task.id)}>
                        打开资产排查
                      </Link>
                      {canResumeTask(task) ? (
                        <button
                          className="ghost-button"
                          disabled={resumingTaskId === task.id}
                          onClick={() => void handleResumeFailedTask(task.id)}
                          type="button"
                        >
                          {resumingTaskId === task.id ? "恢复中..." : "恢复卡住任务"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="task-item">
                  <strong>暂无卡住任务</strong>
                  <span>当前没有心跳超过 10 分钟的运行任务。</span>
                </div>
              )}
            </div>
          </section>

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
              <div className="task-item"><strong>历史增强任务</strong><span>{metrics.legacyEnhancedCount} 条任务</span></div>
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
