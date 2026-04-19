import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  api,
  buildAssetCenterUrl,
  buildBatchDashboardUrl,
  type TaskBlueprintRecord,
  type TaskBlueprintReviewRecord,
  type TaskDetail,
  type TaskSummary,
} from "../api"

function formatRenderSpec(detail: TaskDetail | null, blueprint: TaskBlueprintRecord | null) {
  const renderSpec = blueprint?.blueprint.renderSpec ?? detail?.taskRunConfig.renderSpecJson ?? null
  if (!renderSpec) {
    return "--"
  }

  return `${renderSpec.width} × ${renderSpec.height}`
}

export function TaskReviewPage() {
  const [searchParams] = useSearchParams()
  const routeTaskId = searchParams.get("taskId") ?? ""

  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [blueprint, setBlueprint] = useState<TaskBlueprintRecord | null>(null)
  const [review, setReview] = useState<TaskBlueprintReviewRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const taskResult = await api.listTasks()
        if (!active) {
          return
        }
        setTasks(taskResult.tasks)

        const selectedTaskId =
          routeTaskId || taskResult.tasks.find((task) => task.blueprintStatus === "ready_for_review")?.id || taskResult.tasks[0]?.id
        if (!selectedTaskId) {
          setDetail(null)
          setBlueprint(null)
          setReview(null)
          setLoading(false)
          return
        }

        const [detailResult, blueprintResult] = await Promise.all([
          api.getTaskDetail(selectedTaskId),
          api.getTaskCurrentBlueprint(selectedTaskId),
        ])
        if (!active) {
          return
        }

        setDetail(detailResult.detail)
        setBlueprint(blueprintResult.blueprint)
        setReview(blueprintResult.review)
        setError("")
      } catch (loadError) {
        if (!active) {
          return
        }
        setError(loadError instanceof Error ? loadError.message : "审核蓝图加载失败")
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [routeTaskId])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === (detail?.taskId ?? routeTaskId)) ?? null,
    [detail?.taskId, routeTaskId, tasks],
  )

  async function submitReview(decision: "approved" | "rejected") {
    if (!detail || !blueprint) {
      return
    }

    setSubmitting(true)
    setError("")
    try {
      const result = await api.reviewTaskBlueprint(detail.taskId, blueprint.version, {
        decision,
      })
      setBlueprint(result.blueprint)
      setReview(result.review)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "审核提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function resumeExecution() {
    if (!detail) {
      return
    }

    setSubmitting(true)
    setError("")
    try {
      const result = await api.resumeCurrentBlueprint(detail.taskId)
      setBlueprint(result.blueprint)
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "继续执行失败")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="empty-state">正在加载审核蓝图...</div>
  }

  return (
    <div className="workspace-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">Blueprint Review</div>
          <h1>整任务审核工作台</h1>
          <p>先审整套蓝图、关键画面和提示词，再决定是否继续完整分镜视频生成。</p>
        </div>
        <div className="topbar-actions">
          {blueprint ? <span className="pill">{`Blueprint v${blueprint.version}`}</span> : null}
          {detail?.blueprintStatus ? <span className="pill pill--accent">{detail.blueprintStatus}</span> : null}
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

      <div className="workspace-grid">
        <section className="card card--main">
          <div className="section-header">
            <h2>蓝图总览</h2>
            <div className="section-actions">
              <button
                className="primary-button"
                disabled={!blueprint || submitting}
                onClick={() => void submitReview("approved")}
                type="button"
              >
                审核通过
              </button>
              <button
                className="secondary-button"
                disabled={!blueprint || submitting}
                onClick={() => void submitReview("rejected")}
                type="button"
              >
                驳回当前蓝图
              </button>
              <button
                className="ghost-button"
                disabled={blueprint?.status !== "approved" || submitting}
                onClick={() => void resumeExecution()}
                type="button"
              >
                继续完整视频生成
              </button>
            </div>
          </div>

          <div className="planning-strip">
            <div className="planning-chip">
              <span className="planning-chip__label">所属任务</span>
              <strong>{detail?.title ?? selectedTask?.title ?? "--"}</strong>
              <span>{selectedTask?.projectId ?? detail?.projectId ?? "--"}</span>
            </div>
            <div className="planning-chip">
              <span className="planning-chip__label">终端规格</span>
              <strong>{formatRenderSpec(detail, blueprint)}</strong>
              <span>{blueprint?.blueprint.renderSpec.aspectRatio ?? detail?.taskRunConfig.renderSpecJson.aspectRatio ?? "--"}</span>
            </div>
            <div className="planning-chip">
              <span className="planning-chip__label">执行方式</span>
              <strong>{blueprint?.blueprint.executionMode ?? detail?.taskRunConfig.executionMode ?? "--"}</strong>
              <span>{review ? `最近审核：${review.decision}` : "当前还没有审核记录"}</span>
            </div>
          </div>

          <section className="planning-summary-card">
            <strong>总旁白稿</strong>
            <span>{blueprint?.blueprint.totalVoiceoverScript ?? detail?.script ?? "暂无旁白稿"}</span>
          </section>

          <section className="planning-summary-card">
            <strong>全局风格</strong>
            <span>{blueprint?.blueprint.visualStyleGuide ?? detail?.visualStyleGuide ?? "暂无风格指引"}</span>
          </section>

          <div className="task-list">
            {blueprint?.blueprint.sceneContracts.map((scene) => (
              <section key={scene.id} className="form-section">
                <div className="section-header section-header--stack">
                  <div>
                    <h3>{`Scene #${scene.index + 1}`}</h3>
                    <span className="muted">{scene.sceneGoal}</span>
                  </div>
                  <span className="pill pill--sm">{`${scene.durationSec}s`}</span>
                </div>
                <div className="review-block">
                  <label className="field-label">旁白</label>
                  <div className="review-content">{scene.voiceoverScript}</div>
                </div>
                <div className="review-block">
                  <label className="field-label">起始关键画面描述</label>
                  <div className="review-content">{scene.startFrameDescription}</div>
                </div>
                <div className="review-block">
                  <label className="field-label">图片提示词</label>
                  <div className="review-content">{scene.imagePrompt}</div>
                </div>
                <div className="review-block">
                  <label className="field-label">视频提示词</label>
                  <div className="review-content">{scene.videoPrompt}</div>
                </div>
              </section>
            )) ?? <div className="empty-inline">当前蓝图还没有分镜契约。</div>}
          </div>
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>当前状态</h3>
            <div className="task-list compact-list">
              <div className="task-item">
                <strong>蓝图版本</strong>
                <span>{blueprint ? `Blueprint v${blueprint.version}` : "未生成"}</span>
              </div>
              <div className="task-item">
                <strong>蓝图状态</strong>
                <span>{blueprint?.status ?? detail?.blueprintStatus ?? "未知"}</span>
              </div>
              <div className="task-item">
                <strong>最新审核</strong>
                <span>{review ? `${review.decision} · ${review.decidedAt}` : "暂无"}</span>
              </div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>跳转入口</h3>
            <div className="task-list compact-list">
              <Link className="ghost-button" to={buildBatchDashboardUrl(detail?.taskId ?? undefined)}>
                返回生产看板
              </Link>
              <Link className="ghost-button" to={buildAssetCenterUrl(detail?.taskId ?? undefined)}>
                打开任务资产
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
