import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  api,
  buildAssetCenterUrl,
  buildAssetPreviewUrl,
  buildKeyframePreviewUrl,
  buildBatchDashboardUrl,
  getAudioStrategyLabel,
  getBlueprintStatusLabel,
  getExecutionModeLabel,
  type AssetRecord,
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

function isActionableReviewTask(task: TaskSummary) {
  return (
    task.executionMode === "review_required" &&
    (task.blueprintStatus === "ready_for_review" ||
      task.blueprintStatus === "approved" ||
      task.blueprintStatus === "rejected")
  )
}

function getReviewDefaultTaskId(tasks: TaskSummary[]) {
  return (
    tasks.find((task) => task.executionMode === "review_required" && task.blueprintStatus === "ready_for_review")?.id ||
    tasks.find((task) => task.executionMode === "review_required" && task.blueprintStatus === "approved")?.id ||
    tasks.find((task) => task.executionMode === "review_required" && task.blueprintStatus === "rejected")?.id ||
    tasks[0]?.id ||
    ""
  )
}

type ReviewTaskFilter = "ready_for_review" | "approved" | "rejected" | "all"

function matchesReviewTaskFilter(task: TaskSummary, filter: ReviewTaskFilter) {
  if (filter === "all") {
    return true
  }

  return task.executionMode === "review_required" && task.blueprintStatus === filter
}

function findAsset(assets: AssetRecord[], assetType: AssetRecord["assetType"]) {
  return assets.find((asset) => asset.assetType === assetType) ?? null
}

export function TaskReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const routeTaskId = searchParams.get("taskId") ?? ""

  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [blueprint, setBlueprint] = useState<TaskBlueprintRecord | null>(null)
  const [review, setReview] = useState<TaskBlueprintReviewRecord | null>(null)
  const [sourceScript, setSourceScript] = useState("")
  const [taskFilter, setTaskFilter] = useState<ReviewTaskFilter>("ready_for_review")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [updatingAudioStrategy, setUpdatingAudioStrategy] = useState(false)
  const [error, setError] = useState("")

  const selectedTaskId = detail?.taskId ?? routeTaskId
  const selectedTaskOption = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  )
  const filteredTasks = useMemo(
    () => tasks.filter((task) => matchesReviewTaskFilter(task, taskFilter)),
    [taskFilter, tasks],
  )
  const taskOptions = useMemo(() => {
    if (!selectedTaskOption) {
      return filteredTasks
    }

    if (filteredTasks.some((task) => task.id === selectedTaskOption.id)) {
      return filteredTasks
    }

    return [selectedTaskOption, ...filteredTasks]
  }, [filteredTasks, selectedTaskOption])

  function handleTaskFilterChange(nextFilter: ReviewTaskFilter) {
    setTaskFilter(nextFilter)

    const nextTasks = tasks.filter((task) => matchesReviewTaskFilter(task, nextFilter))
    if (!nextTasks.length) {
      return
    }

    if (selectedTaskOption && matchesReviewTaskFilter(selectedTaskOption, nextFilter)) {
      return
    }

    setLoading(true)
    setError("")
    syncTaskRoute(nextTasks[0].id, false)
  }

  function syncTaskRoute(taskId: string, replace = true) {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set("taskId", taskId)
    setSearchParams(nextSearchParams, { replace })
  }

  function applyBlueprintStatus(taskId: string, status: TaskBlueprintRecord["status"]) {
    setDetail((current) =>
      current
        ? {
            ...current,
            blueprintStatus: status,
            taskRunConfig: {
              ...current.taskRunConfig,
              blueprintStatus: status,
            },
          }
        : current,
    )
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              blueprintStatus: status,
            }
          : task,
      ),
    )
  }

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
          routeTaskId ||
          getReviewDefaultTaskId(taskResult.tasks)
        if (!selectedTaskId) {
          setDetail(null)
          setBlueprint(null)
          setReview(null)
          setLoading(false)
          return
        }

        if (!routeTaskId) {
          syncTaskRoute(selectedTaskId, true)
        }

        const [detailResult, blueprintResult, assetsResult] = await Promise.all([
          api.getTaskDetail(selectedTaskId),
          api.getTaskCurrentBlueprint(selectedTaskId),
          api.getTaskAssets(selectedTaskId),
        ])
        if (!active) {
          return
        }

        setDetail(detailResult.detail)
        setBlueprint(blueprintResult.blueprint)
        setReview(blueprintResult.review)
        const sourceAsset = findAsset(assetsResult.assets, "source_script")
        if (sourceAsset) {
          try {
            const response = await fetch(buildAssetPreviewUrl(sourceAsset.taskId, sourceAsset.id))
            const text = await response.text()
            if (active && response.ok) {
              setSourceScript(text)
            } else if (active) {
              setSourceScript("")
            }
          } catch {
            if (active) {
              setSourceScript("")
            }
          }
        } else {
          setSourceScript("")
        }
        setError("")
      } catch (loadError) {
        if (!active) {
          return
        }
        setError(loadError instanceof Error ? loadError.message : "审核内容加载失败")
        setSourceScript("")
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

  useEffect(() => {
    let active = true

    const timer = window.setInterval(() => {
      void api.listTasks()
        .then((taskResult) => {
          if (!active) {
            return
          }
          setTasks(taskResult.tasks)
        })
        .catch(() => {})
    }, 5000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const selectedTask = useMemo(
    () => selectedTaskOption,
    [selectedTaskOption],
  )

  const isApproved = blueprint?.status === "approved"
  const isRejected = blueprint?.status === "rejected"
  const canEditAudioStrategy =
    !!detail &&
    !updatingAudioStrategy &&
    detail.taskRunConfig.executionMode === "review_required" &&
    (detail.blueprintStatus === "ready_for_review" ||
      detail.blueprintStatus === "approved" ||
      detail.blueprintStatus === "rejected")

  function applyAudioStrategy(taskId: string, strategy: TaskDetail["taskRunConfig"]["audioStrategy"]) {
    setDetail((current) =>
      current && current.taskId === taskId
        ? {
            ...current,
            taskRunConfig: {
              ...current.taskRunConfig,
              audioStrategy: strategy,
            },
          }
        : current,
    )
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              audioStrategy: strategy,
            }
          : task,
      ),
    )
  }

  async function submitReview(decision: "approved" | "rejected") {
    if (!detail || !blueprint) {
      return
    }

    if ((decision === "approved" && isApproved) || (decision === "rejected" && isRejected)) {
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
      applyBlueprintStatus(detail.taskId, result.blueprint.status)
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
      applyBlueprintStatus(detail.taskId, result.blueprint.status)
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "继续生成失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function updateAudioStrategy(audioStrategy: TaskDetail["taskRunConfig"]["audioStrategy"]) {
    if (!detail || detail.taskRunConfig.audioStrategy === audioStrategy || !canEditAudioStrategy) {
      return
    }

    setUpdatingAudioStrategy(true)
    setError("")
    try {
      const result = await api.updateTaskAudioStrategy(detail.taskId, { audioStrategy })
      applyAudioStrategy(detail.taskId, result.detail.taskRunConfig.audioStrategy)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "更新音频策略失败")
    } finally {
      setUpdatingAudioStrategy(false)
    }
  }

  if (loading) {
    return <div className="empty-state">正在加载审核内容...</div>
  }

  return (
    <div className="workspace-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">任务审核</div>
          <h1>整任务审核工作台</h1>
          <p>先检查整条视频的生成方案、关键画面和画幅，再决定是否继续生成正片。</p>
        </div>
        <div className="topbar-actions">
          {blueprint ? <span className="pill">{`方案 v${blueprint.version}`}</span> : null}
          {detail?.blueprintStatus ? <span className="pill pill--accent">{getBlueprintStatusLabel(detail.blueprintStatus)}</span> : null}
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

      <div className="workspace-grid">
        <section className="card card--main">
          {taskOptions.length ? (
            <>
              <label className="field-label">任务选择</label>
              <div className="planning-summary-tags" style={{ marginBottom: 12 }}>
                <button
                  className={taskFilter === "ready_for_review" ? "primary-button" : "ghost-button"}
                  onClick={() => handleTaskFilterChange("ready_for_review")}
                  type="button"
                >
                  待审核
                </button>
                <button
                  className={taskFilter === "approved" ? "primary-button" : "ghost-button"}
                  onClick={() => handleTaskFilterChange("approved")}
                  type="button"
                >
                  已通过
                </button>
                <button
                  className={taskFilter === "rejected" ? "primary-button" : "ghost-button"}
                  onClick={() => handleTaskFilterChange("rejected")}
                  type="button"
                >
                  已驳回
                </button>
                <button
                  className={taskFilter === "all" ? "primary-button" : "ghost-button"}
                  onClick={() => handleTaskFilterChange("all")}
                  type="button"
                >
                  显示全部任务
                </button>
              </div>
              <select
                className="input"
                value={selectedTaskId ?? taskOptions[0]?.id ?? ""}
                onChange={(event) => {
                  setLoading(true)
                  setError("")
                  syncTaskRoute(event.target.value, false)
                }}
              >
                {taskOptions.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} · {task.projectId} · {getBlueprintStatusLabel(task.blueprintStatus)}
                  </option>
                ))}
              </select>
            </>
          ) : null}

          <div className="section-header">
            <h2>生成方案总览</h2>
            <div className="section-actions">
              <button
                className="primary-button"
                disabled={!blueprint || submitting || isApproved}
                onClick={() => void submitReview("approved")}
                type="button"
              >
                {isApproved ? "已审核通过" : "审核通过"}
              </button>
              <button
                className="secondary-button"
                disabled={!blueprint || submitting || isRejected}
                onClick={() => void submitReview("rejected")}
                type="button"
              >
                {isRejected ? "已驳回当前方案" : "驳回当前方案"}
              </button>
              <button
                className="ghost-button"
                disabled={blueprint?.status !== "approved" || submitting}
                onClick={() => void resumeExecution()}
                type="button"
              >
                继续生成正片
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
              <span className="planning-chip__label">生成流程</span>
              <strong>{getExecutionModeLabel(blueprint?.blueprint.executionMode ?? detail?.taskRunConfig.executionMode)}</strong>
              <span>{review ? `最近审核：${review.decision}` : "还没有审核记录"}</span>
            </div>
            <div className="planning-chip">
              <span className="planning-chip__label">音频策略</span>
              <strong>{getAudioStrategyLabel(detail?.taskRunConfig.audioStrategy)}</strong>
              <span>
                {detail?.taskRunConfig.audioStrategy === "native_plus_tts_ducked"
                  ? "保留视频自带环境音，并叠加系统配音。"
                  : "最终主音轨使用系统配音。"}
              </span>
              <div className="planning-summary-tags" style={{ marginTop: 10 }}>
                <button
                  className={detail?.taskRunConfig.audioStrategy === "tts_only" ? "primary-button" : "ghost-button"}
                  disabled={!canEditAudioStrategy}
                  onClick={() => void updateAudioStrategy("tts_only")}
                  type="button"
                >
                  系统配音
                </button>
                <button
                  className={detail?.taskRunConfig.audioStrategy === "native_plus_tts_ducked" ? "primary-button" : "ghost-button"}
                  disabled={!canEditAudioStrategy}
                  onClick={() => void updateAudioStrategy("native_plus_tts_ducked")}
                  type="button"
                >
                  保留环境音 + 系统配音
                </button>
              </div>
              <span>
                {canEditAudioStrategy
                  ? "修改只影响最终成片音轨，不会重新生成图片和视频文案。"
                  : "任务进入生成正片阶段后，音频设置会自动锁定。"}
              </span>
            </div>
          </div>

          <section className="planning-summary-card">
            <strong>原始文案</strong>
            <span>{sourceScript || "当前没有留档的原始文案。"}</span>
          </section>

          <section className="planning-summary-card">
            <strong>总旁白稿</strong>
            <span>{blueprint?.blueprint.totalVoiceoverScript ?? detail?.script ?? "暂无旁白稿"}</span>
          </section>

          <section className="planning-summary-card">
            <strong>整体风格</strong>
            <span>{blueprint?.blueprint.visualStyleGuide ?? detail?.visualStyleGuide ?? "暂无风格指引"}</span>
          </section>

          <section className="planning-summary-card">
            <strong>一致性要求</strong>
            <span>
              主体：{blueprint?.blueprint.subjectProfile ?? "--"} ·
              物料：{blueprint?.blueprint.productProfile ?? "--"}
            </span>
            <span>
              背景约束：{blueprint?.blueprint.backgroundConstraints?.join(" / ") || "无"}
            </span>
            <span>
              禁止项：{blueprint?.blueprint.negativeConstraints?.join(" / ") || "无"}
            </span>
          </section>

          <div className="task-list">
            {blueprint?.blueprint.sceneContracts.map((scene) => (
              <section key={scene.id} className="form-section">
                <div className="section-header section-header--stack">
                  <div>
                    <h3>{`第 ${scene.index + 1} 段`}</h3>
                    <span className="muted">{scene.sceneGoal}</span>
                  </div>
                  <span className="pill pill--sm">{`${scene.durationSec}s`}</span>
                </div>
                <div className="review-block">
                  <label className="field-label">旁白</label>
                  <div className="review-content">{scene.voiceoverScript}</div>
                </div>
                <div className="review-block">
                  <label className="field-label">开场画面描述</label>
                  <div className="review-content">{scene.startFrameDescription}</div>
                </div>
                <div className="review-block">
                  <label className="field-label">关键画面预览</label>
                  <img
                    alt={`关键画面 ${scene.id}`}
                    className="visual-preview__image"
                    src={buildKeyframePreviewUrl(detail?.taskId ?? blueprint?.taskId ?? "", scene.id)}
                  />
                </div>
                <div className="review-block">
                  <label className="field-label">图片生成说明</label>
                  <div className="review-content">{scene.imagePrompt}</div>
                </div>
                <div className="review-block">
                  <label className="field-label">视频生成说明</label>
                  <div className="review-content">{scene.videoPrompt}</div>
                </div>
                <div className="review-block">
                  <label className="field-label">连续性要求</label>
                  <div className="review-content">
                    {scene.continuityConstraints.length ? scene.continuityConstraints.join(" / ") : "当前没有额外连续性要求"}
                  </div>
                </div>
              </section>
            )) ?? <div className="empty-inline">当前还没有分段生成方案。</div>}
          </div>
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>当前状态</h3>
            <div className="task-list compact-list">
              <div className="task-item">
                <strong>方案版本</strong>
                <span>{blueprint ? `方案 v${blueprint.version}` : "未生成"}</span>
              </div>
              <div className="task-item">
                <strong>方案状态</strong>
                <span>{getBlueprintStatusLabel(blueprint?.status ?? detail?.blueprintStatus)}</span>
              </div>
              <div className="task-item">
                <strong>最新审核</strong>
                <span>{review ? `${review.decision} · ${review.decidedAt}` : "暂无"}</span>
              </div>
              <div className="task-item">
                <strong>原始文案</strong>
                <span>{sourceScript ? "已加载" : "暂无"}</span>
              </div>
              <div className="task-item">
                <strong>音频策略</strong>
                <span>{getAudioStrategyLabel(detail?.taskRunConfig.audioStrategy)}</span>
              </div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>相关页面</h3>
            <div className="task-list compact-list">
              <Link className="ghost-button" to={buildBatchDashboardUrl(detail?.taskId ?? undefined)}>
                返回生产看板
              </Link>
              <Link className="ghost-button" to={buildAssetCenterUrl(detail?.taskId ?? undefined)}>
                查看素材文件
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
