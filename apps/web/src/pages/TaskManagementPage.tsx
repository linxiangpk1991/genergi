import { useEffect, useMemo, useState } from "react"
import { MoreActionsMenu } from "../components/MoreActionsMenu"
import {
  api,
  buildAssetCenterUrl,
  buildTaskReviewUrl,
  normalizeOperatorCopy,
  type RuntimeStatusResponse,
  type TaskBulkOperation,
  type TaskBulkPreviewResponse,
  type TaskBulkResultResponse,
  type TaskSummary,
} from "../api"

type TaskView = "attention" | "running" | "failed" | "delivery" | "archived" | "all"

const viewOptions: Array<{ id: TaskView; label: string }> = [
  { id: "attention", label: "待处理" },
  { id: "running", label: "运行中" },
  { id: "failed", label: "失败" },
  { id: "delivery", label: "待交付" },
  { id: "archived", label: "已归档" },
  { id: "all", label: "全部任务" },
]

function getStatusLabel(status: string) {
  switch (status) {
    case "queued":
      return "排队中"
    case "running":
      return "生产中"
    case "waiting_review":
      return "待审阅"
    case "failed":
      return "失败"
    case "completed":
      return "已完成"
    case "canceled":
      return "已取消"
    case "paused":
      return "已暂停"
    default:
      return status || "未知"
  }
}

function getReviewLabel(task: TaskSummary) {
  if (task.blueprintStatus === "ready_for_review") {
    return "方案待审"
  }
  if (task.blueprintStatus === "approved") {
    return "已通过待继续"
  }
  if (task.blueprintStatus === "rejected") {
    return "审阅退回"
  }
  if (task.reviewStage === "storyboard_review") {
    return "待分镜审阅"
  }
  if (task.reviewStage === "keyframe_review") {
    return "待关键帧审阅"
  }
  return task.executionMode === "review_required" ? "需人工审阅" : "无需审阅"
}

function getTaskStageLabel(task: TaskSummary) {
  return normalizeOperatorCopy(task.currentStageLabel || task.statusDetail) || getStatusLabel(task.status)
}

function isAttentionTask(task: TaskSummary) {
  return (
    task.status === "failed" ||
    task.status === "waiting_review" ||
    task.blueprintStatus === "ready_for_review" ||
    task.blueprintStatus === "approved" ||
    task.blueprintStatus === "rejected" ||
    (task.actualDurationSec != null && Math.abs(task.actualDurationSec - task.targetDurationSec) > 2)
  )
}

function getTaskPriority(task: TaskSummary) {
  if (task.archivedAt) return 90
  if (task.status === "failed") return 0
  if (task.blueprintStatus === "approved") return 1
  if (task.status === "waiting_review" || task.blueprintStatus === "ready_for_review") return 2
  if (task.status === "completed") return 3
  if (task.status === "queued") return 4
  if (task.status === "running") return 5
  return 10
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "时间未知"
  }
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function getConfirmationText(operation: TaskBulkOperation, count: number) {
  if (operation === "delete_task_with_assets") {
    return `删除 ${count} 个任务`
  }
  if (operation === "delete_assets_only") {
    return `清空 ${count} 个任务素材`
  }
  return ""
}

function getTaskStatusPillClass(task: TaskSummary) {
  if (task.archivedAt) {
    return "status-pill status-pill--disabled"
  }
  if (task.status === "failed") {
    return "status-pill status-pill--danger"
  }
  return "status-pill status-pill--active"
}

function getTaskNextStep(task: TaskSummary) {
  if (task.archivedAt) {
    return {
      label: "已归档，按需恢复",
      description: "不会出现在日常生产队列里。",
    }
  }
  if (task.status === "failed") {
    return {
      label: "查看失败原因",
      description: "先看素材与排查记录，再决定恢复或删除。",
      href: buildAssetCenterUrl(task.id),
    }
  }
  if (
    task.executionMode === "review_required" &&
    (task.status === "waiting_review" ||
      task.blueprintStatus === "ready_for_review" ||
      task.blueprintStatus === "approved" ||
      task.blueprintStatus === "rejected")
  ) {
    return {
      label: task.blueprintStatus === "approved" ? "继续审核流程" : "进入任务审核",
      description: getReviewLabel(task),
      href: buildTaskReviewUrl(task),
    }
  }
  if (task.status === "completed") {
    return {
      label: "检查发布文件",
      description: "确认成片、字幕、脚本和素材清单。",
      href: buildAssetCenterUrl(task.id),
    }
  }
  if (task.status === "queued" || task.status === "running") {
    return {
      label: "观察生产进度",
      description: getTaskStageLabel(task),
      href: buildAssetCenterUrl(task.id),
    }
  }
  return {
    label: "查看任务详情",
    description: getTaskStageLabel(task),
    href: buildAssetCenterUrl(task.id),
  }
}

function getSelectedBulkHint(selectedTasks: TaskSummary[]) {
  const lockedCount = selectedTasks.filter(
    (task) => task.status === "queued" || task.status === "running" || task.status === "waiting_review",
  ).length

  if (lockedCount) {
    return `已选任务里有 ${lockedCount} 条仍在生产或审核，危险操作会在预检中跳过。`
  }

  return "只处理当前已选任务；删除和清空素材会要求二次确认。"
}

export function TaskManagementPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [runtime, setRuntime] = useState<RuntimeStatusResponse["runtime"] | null>(null)
  const [view, setView] = useState<TaskView>("attention")
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [preview, setPreview] = useState<TaskBulkPreviewResponse | null>(null)
  const [result, setResult] = useState<TaskBulkResultResponse | null>(null)
  const [confirmationText, setConfirmationText] = useState("")
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState("")

  async function load() {
    const [taskResult, runtimeResult] = await Promise.all([
      api.listTasks({ includeArchived: true }),
      api.runtimeStatus(),
    ])
    setTasks(taskResult.tasks)
    setRuntime(runtimeResult.runtime)
  }

  useEffect(() => {
    void load()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "任务管理台加载失败")
      })
      .finally(() => setLoading(false))
  }, [])

  const counts = useMemo(() => ({
    attention: tasks.filter((task) => !task.archivedAt && isAttentionTask(task)).length,
    running: tasks.filter((task) => !task.archivedAt && (task.status === "running" || task.status === "queued")).length,
    failed: tasks.filter((task) => !task.archivedAt && task.status === "failed").length,
    delivery: tasks.filter((task) => !task.archivedAt && task.status === "completed").length,
    archived: tasks.filter((task) => task.archivedAt).length,
    all: tasks.filter((task) => !task.archivedAt).length,
  }), [tasks])

  const filteredTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return tasks
      .filter((task) => {
        if (view !== "archived" && task.archivedAt) return false
        if (view === "archived" && !task.archivedAt) return false
        if (view === "attention" && !isAttentionTask(task)) return false
        if (view === "running" && task.status !== "running" && task.status !== "queued") return false
        if (view === "failed" && task.status !== "failed") return false
        if (view === "delivery" && task.status !== "completed") return false
        if (statusFilter !== "all" && task.status !== statusFilter) return false
        if (!normalizedQuery) return true
        const searchable = `${task.id} ${task.title} ${task.channelId} ${task.projectId}`.toLowerCase()
        return searchable.includes(normalizedQuery)
      })
      .sort((left, right) => {
        const priorityDiff = getTaskPriority(left) - getTaskPriority(right)
        return priorityDiff === 0 ? right.updatedAt.localeCompare(left.updatedAt) : priorityDiff
      })
  }, [searchQuery, statusFilter, tasks, view])

  const selectedTasks = useMemo(
    () => tasks.filter((task) => selectedTaskIds.includes(task.id)),
    [selectedTaskIds, tasks],
  )

  const allVisibleSelected = filteredTasks.length > 0 && filteredTasks.every((task) => selectedTaskIds.includes(task.id))

  function toggleTask(taskId: string) {
    setSelectedTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    )
    setPreview(null)
    setResult(null)
  }

  function toggleVisibleTasks() {
    if (allVisibleSelected) {
      setSelectedTaskIds((current) => current.filter((id) => !filteredTasks.some((task) => task.id === id)))
    } else {
      setSelectedTaskIds((current) => [...new Set([...current, ...filteredTasks.map((task) => task.id)])])
    }
    setPreview(null)
    setResult(null)
  }

  async function openBulkPreview(operation: TaskBulkOperation) {
    if (!selectedTaskIds.length) {
      return
    }
    setError("")
    setActionLoading(true)
    setResult(null)
    setConfirmationText("")
    try {
      setPreview(await api.previewTaskBulkOperation({ taskIds: selectedTaskIds, operation }))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "批量预检失败")
    } finally {
      setActionLoading(false)
    }
  }

  async function executeBulkOperation() {
    if (!preview) {
      return
    }
    setError("")
    setActionLoading(true)
    try {
      const operation = preview.operation
      const allowedIds = preview.items.filter((item) => item.allowed).map((item) => item.taskId)
      const confirmation = getConfirmationText(operation, allowedIds.length)
      let response: TaskBulkResultResponse
      if (operation === "cancel") {
        response = await api.cancelTaskBulk({ taskIds: selectedTaskIds, reason: "运营批量取消" })
      } else if (operation === "resume") {
        response = await api.resumeTaskBulk({ taskIds: selectedTaskIds, reason: "运营批量恢复" })
      } else {
        response = await api.deleteTaskBulk({
          taskIds: selectedTaskIds,
          operation: operation as "archive" | "restore" | "delete_task_with_assets" | "delete_assets_only",
          reason: "运营任务管理台批量操作",
          confirmationText: confirmation || undefined,
        })
      }
      setResult(response)
      setPreview(null)
      setSelectedTaskIds([])
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "批量操作失败")
    } finally {
      setActionLoading(false)
    }
  }

  const requiredConfirmation = preview
    ? getConfirmationText(preview.operation, preview.items.filter((item) => item.allowed).length)
    : ""
  const canSubmitPreview = preview && preview.summary.allowed > 0 && (!requiredConfirmation || confirmationText === requiredConfirmation)

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">任务管理</div>
          <h1>综合任务管理台</h1>
          <p>集中查看任务进度、审阅阻塞、成本风险和交付状态，批量处理前先预检影响范围。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">任务 {counts.all}</span>
          <span className="pill pill--accent">待处理 {counts.attention}</span>
          <span className="pill">已归档 {counts.archived}</span>
        </div>
      </header>

      <section className="task-control-status">
        <span>后台接口：{runtime?.api.status ?? "unknown"}</span>
        <span>生成服务：{runtime?.worker.status ?? "unknown"}</span>
        <span>排队服务：{runtime?.redis.status ?? "unknown"}</span>
        <span>当前筛选：{filteredTasks.length}</span>
      </section>

      <section className="task-control-tabs" aria-label="任务分组">
        {viewOptions.map((option) => (
          <button
            className={view === option.id ? "task-control-tab task-control-tab--active" : "task-control-tab"}
            key={option.id}
            onClick={() => {
              setView(option.id)
              setSelectedTaskIds([])
              setPreview(null)
              setResult(null)
            }}
            type="button"
          >
            <strong>{option.label}</strong>
            <span>{counts[option.id]}</span>
          </button>
        ))}
      </section>

      <section className="card">
        {error ? <div className="review-inline-note review-inline-note--danger">{error}</div> : null}
        <div className="task-control-toolbar">
          <input
            className="input"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索任务名 / ID / 负责人"
            value={searchQuery}
          />
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">全部状态</option>
            <option value="queued">排队中</option>
            <option value="running">生产中</option>
            <option value="waiting_review">待审阅</option>
            <option value="failed">失败</option>
            <option value="completed">已完成</option>
            <option value="canceled">已取消</option>
          </select>
          <button className="ghost-button" onClick={() => {
            setSearchQuery("")
            setStatusFilter("all")
          }} type="button">
            清空筛选
          </button>
        </div>

        {selectedTaskIds.length ? (
          <div className="bulk-action-bar bulk-action-bar--active">
            <div className="bulk-action-bar__meta">
              <strong>已选择 {selectedTasks.length} 条</strong>
              <span>{getSelectedBulkHint(selectedTasks)}</span>
            </div>
            <div className="bulk-action-bar__actions">
              <button className="ghost-button" disabled={actionLoading} onClick={() => void openBulkPreview("archive")} type="button">归档</button>
              <button className="ghost-button" disabled={actionLoading} onClick={() => void openBulkPreview("resume")} type="button">恢复失败</button>
              <MoreActionsMenu
                ariaLabel="更多批量操作"
                label="更多批量操作"
                items={[
                  {
                    label: "恢复归档",
                    description: "把已归档任务放回日常列表。",
                    disabled: actionLoading,
                    onSelect: () => void openBulkPreview("restore"),
                  },
                  {
                    label: "取消任务",
                    description: "只会取消可停止的排队或生产中任务。",
                    disabled: actionLoading,
                    onSelect: () => void openBulkPreview("cancel"),
                  },
                  {
                    label: "清空素材",
                    description: "删除已选任务自己的素材文件和记录。",
                    tone: "danger",
                    disabled: actionLoading,
                    onSelect: () => void openBulkPreview("delete_assets_only"),
                  },
                  {
                    label: "删除任务",
                    description: "同时删除任务、素材、排查记录和时间线。",
                    tone: "danger",
                    disabled: actionLoading,
                    onSelect: () => void openBulkPreview("delete_task_with_assets"),
                  },
                ]}
              />
              <button
                className="ghost-button"
                disabled={actionLoading}
                onClick={() => {
                  setSelectedTaskIds([])
                  setPreview(null)
                  setResult(null)
                  setConfirmationText("")
                }}
                type="button"
              >
                取消选择
              </button>
            </div>
          </div>
        ) : (
          <div className="selection-hint">
            勾选任务后显示批量操作；删除和清空素材都会先预检影响范围。
          </div>
        )}

        {preview ? (
          <div className="bulk-preview-panel">
            <div className="section-header">
              <div>
                <strong>批量操作预检</strong>
                <div className="muted">
                  可执行 {preview.summary.allowed} 条，需跳过 {preview.summary.blocked} 条。
                </div>
              </div>
              <button className="ghost-button" onClick={() => setPreview(null)} type="button">关闭</button>
            </div>
            {requiredConfirmation ? (
              <label>
                <span className="field-label">输入确认文本：{requiredConfirmation}</span>
                <input
                  className="input"
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  onInput={(event) => setConfirmationText(event.currentTarget.value)}
                />
              </label>
            ) : null}
            <div className="bulk-preview-list">
              {preview.items.map((item) => (
                <div className={item.allowed ? "bulk-preview-item" : "bulk-preview-item bulk-preview-item--blocked"} key={item.taskId}>
                  <strong>{item.title}</strong>
                  <span>{item.reason} · 素材 {item.assetSummary.assetCount} 个</span>
                </div>
              ))}
            </div>
            <button className="primary-button" disabled={!canSubmitPreview || actionLoading} onClick={() => void executeBulkOperation()} type="button">
              {actionLoading ? "执行中..." : "确认执行"}
            </button>
          </div>
        ) : null}

        {result ? (
          <div className="bulk-preview-panel">
            <strong>操作完成：成功 {result.summary.success}，跳过 {result.summary.skipped}，失败 {result.summary.failed}</strong>
            <div className="bulk-preview-list">
              {result.items.map((item) => (
                <div className={item.result === "success" ? "bulk-preview-item" : "bulk-preview-item bulk-preview-item--blocked"} key={`${result.operationId}-${item.taskId}`}>
                  <strong>{item.title}</strong>
                  <span>{item.message}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="empty-state">正在加载任务列表...</div>
        ) : filteredTasks.length ? (
          <div className="table-wrap">
            <table className="user-table task-management-table">
              <thead>
                <tr>
                  <th><input checked={allVisibleSelected} onChange={toggleVisibleTasks} type="checkbox" /></th>
                  <th>任务</th>
                  <th>状态</th>
                  <th>下一步</th>
                  <th>交付</th>
                  <th>进度</th>
                  <th>成本</th>
                  <th>最后更新</th>
                  <th>更多</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((task) => {
                  const nextStep = getTaskNextStep(task)

                  return (
                    <tr key={task.id}>
                      <td><input checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTask(task.id)} type="checkbox" /></td>
                      <td>
                        <strong>{task.title}</strong>
                        <div className="mono">{task.id}</div>
                        {task.archivedAt ? <span className="status-pill status-pill--disabled">已归档</span> : null}
                      </td>
                      <td><span className={getTaskStatusPillClass(task)}>{getStatusLabel(task.status)}</span></td>
                      <td>
                        {nextStep.href ? (
                          <a className="task-next-step" href={nextStep.href}>
                            <strong>{nextStep.label}</strong>
                            <span>{nextStep.description}</span>
                          </a>
                        ) : (
                          <div className="task-next-step">
                            <strong>{nextStep.label}</strong>
                            <span>{nextStep.description}</span>
                          </div>
                        )}
                      </td>
                      <td>
                        <strong>{task.channelId}</strong>
                        <div className="muted">{getReviewLabel(task)}</div>
                      </td>
                      <td>{task.progressPct}%</td>
                      <td>¥{task.estimatedCostCny.toFixed(2)}</td>
                      <td>{formatUpdatedAt(task.updatedAt)}</td>
                      <td>
                        <MoreActionsMenu
                          ariaLabel={`${task.title} 更多操作`}
                          items={[
                            {
                              label: "去任务审核",
                              description: "查看生成方案、关键画面和审核状态。",
                              href: buildTaskReviewUrl(task),
                            },
                            {
                              label: "查看素材与交付",
                              description: "检查发布文件、排查文件和局部重试。",
                              href: buildAssetCenterUrl(task.id),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">没有符合条件的任务，可以清空筛选或调整状态、渠道、时间范围。</div>
        )}
      </section>
    </>
  )
}
