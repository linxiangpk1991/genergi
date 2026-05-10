import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ModelUsageSummary } from "../components/ModelUsageSummary"
import {
  api,
  buildAssetCenterUrl,
  buildAssetPreviewUrl,
  buildKeyframePreviewUrl,
  buildBatchDashboardUrl,
  getAudioStrategyLabel,
  getBlueprintStatusLabel,
  getExecutionModeLabel,
  normalizeOperatorCopy,
  type AssetRecord,
  type QualityIssueCategory,
  type TaskBlueprintRecord,
  type TaskBlueprintReviewRecord,
  type TaskDetail,
  type TaskSummary,
} from "../api"

const QUALITY_REASON_OPTIONS: Array<{
  issueCategory: QualityIssueCategory
  slotType: "textModel" | "imageModel" | "videoModel" | "ttsProvider" | null
  label: string
}> = [
  { issueCategory: "script_off_track", slotType: "textModel", label: "文案跑偏" },
  { issueCategory: "image_inconsistent", slotType: "imageModel", label: "画面不一致" },
  { issueCategory: "character_unstable", slotType: "imageModel", label: "人物不稳定" },
  { issueCategory: "low_image_quality", slotType: "imageModel", label: "画质不够" },
  { issueCategory: "poor_motion", slotType: "videoModel", label: "动作不自然" },
  { issueCategory: "subtitle_issue", slotType: "ttsProvider", label: "字幕问题" },
  { issueCategory: "voice_issue", slotType: "ttsProvider", label: "配音问题" },
  { issueCategory: "other", slotType: null, label: "其他" },
]

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

function isTaskBlueprintNotFoundError(error: unknown) {
  return error instanceof Error && error.message === "TASK_BLUEPRINT_NOT_FOUND"
}

function getReviewDecisionLabel(decision: TaskBlueprintReviewRecord["decision"]) {
  return decision === "approved" ? "已通过" : "已驳回"
}

function getReviewStatusChipClass(status: TaskBlueprintRecord["status"] | null | undefined) {
  if (status === "approved") {
    return "review-status-chip review-status-chip--approved"
  }
  if (status === "rejected") {
    return "review-status-chip review-status-chip--rejected"
  }
  return "review-status-chip"
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
  const [failedKeyframeImages, setFailedKeyframeImages] = useState<string[]>([])
  const [selectedQualityReasons, setSelectedQualityReasons] = useState<QualityIssueCategory[]>([])
  const [qualityNote, setQualityNote] = useState("")
  const [emptyFilterNotice, setEmptyFilterNotice] = useState<ReviewTaskFilter | null>(null)
  const taskListPollingRef = useRef(false)

  const selectedTaskId = detail?.taskId ?? routeTaskId
  const selectedTaskOption = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  )
  const filteredTasks = useMemo(
    () => tasks.filter((task) => matchesReviewTaskFilter(task, taskFilter)),
    [taskFilter, tasks],
  )
  const taskOptions = useMemo(() => filteredTasks, [filteredTasks])
  const filterHasNoTasks = taskFilter !== "all" && emptyFilterNotice === taskFilter && filteredTasks.length === 0

  function handleTaskFilterChange(nextFilter: ReviewTaskFilter) {
    setTaskFilter(nextFilter)
    setEmptyFilterNotice(null)

    const nextTasks = tasks.filter((task) => matchesReviewTaskFilter(task, nextFilter))
    if (!nextTasks.length) {
      setEmptyFilterNotice(nextFilter)
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

        const [detailResult, assetsResult] = await Promise.all([
          api.getTaskDetail(selectedTaskId),
          api.getTaskAssets(selectedTaskId),
        ])
        let blueprintResult: Awaited<ReturnType<typeof api.getTaskCurrentBlueprint>> | null = null
        if (detailResult.detail.blueprintStatus !== "pending_generation") {
          try {
            blueprintResult = await api.getTaskCurrentBlueprint(selectedTaskId)
          } catch (blueprintError) {
            if (!isTaskBlueprintNotFoundError(blueprintError)) {
              throw blueprintError
            }
          }
        }
        if (!active) {
          return
        }

        setDetail(detailResult.detail)
        setBlueprint(blueprintResult?.blueprint ?? null)
        setReview(blueprintResult?.review ?? null)
        setFailedKeyframeImages([])
        setSelectedQualityReasons([])
        setQualityNote("")
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
      if (taskListPollingRef.current) {
        return
      }
      taskListPollingRef.current = true
      void api.listTasks()
        .then((taskResult) => {
          if (!active) {
            return
          }
          setTasks(taskResult.tasks)
        })
        .catch(() => {})
        .finally(() => {
          taskListPollingRef.current = false
        })
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
  const canSubmitReview = blueprint?.status === "ready_for_review"
  const canResumeApprovedBlueprint = blueprint?.status === "approved"
  const hasRejectReason = selectedQualityReasons.length > 0
  const canEditAudioStrategy =
    !!detail &&
    !updatingAudioStrategy &&
    detail.taskRunConfig.executionMode === "review_required" &&
    (detail.blueprintStatus === "ready_for_review" ||
      detail.blueprintStatus === "approved" ||
      detail.blueprintStatus === "rejected")
  const visibleKeyframeCount = Math.max(
    blueprint?.blueprint.visualPlan?.keyframeCount ?? 0,
    blueprint?.blueprint.sceneContracts.length ?? 0,
    detail?.taskRunConfig.keyframeCount ?? 0,
  )
  const visibleKeyframeMode = blueprint?.blueprint.visualPlan?.generationMode ?? detail?.taskRunConfig.keyframeGenerationMode
  const blueprintPendingNotice = detail && !blueprint
    ? detail.blueprintStatus === "pending_generation"
      ? "当前任务还在准备生成方案，生成完成后会自动进入待审核列表。"
      : "当前任务还没有可审核的生成方案。"
    : ""

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

  function toggleQualityReason(issueCategory: QualityIssueCategory) {
    setSelectedQualityReasons((current) =>
      current.includes(issueCategory)
        ? current.filter((item) => item !== issueCategory)
        : [...current, issueCategory],
    )
  }

  async function submitReview(decision: "approved" | "rejected") {
    if (!detail || !blueprint) {
      return
    }

    if ((decision === "approved" && isApproved) || (decision === "rejected" && isRejected)) {
      return
    }

    if (decision === "rejected" && !hasRejectReason) {
      setError("请先选择一个驳回原因。这样后续才知道该重做文案、画面、视频还是配音。")
      return
    }

    setSubmitting(true)
    setError("")
    try {
      const qualityReasons = decision === "rejected"
        ? selectedQualityReasons.map((issueCategory) => {
            const option = QUALITY_REASON_OPTIONS.find((item) => item.issueCategory === issueCategory)
            return {
              issueCategory,
              slotType: option?.slotType ?? null,
              note: qualityNote.trim() || undefined,
            }
          })
        : undefined
      const result = await api.reviewTaskBlueprint(detail.taskId, blueprint.version, {
        decision,
        qualityReasons,
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

  function markKeyframeImageFailed(sceneId: string) {
    setFailedKeyframeImages((current) => (current.includes(sceneId) ? current : [...current, sceneId]))
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

  async function retryKeyframe(sceneId: string) {
    if (!detail) {
      return
    }

    setSubmitting(true)
    setError("")
    try {
      const result = await api.retryTask(detail.taskId, {
        scope: "keyframe",
        sceneId,
        reason: "审核时重做单张关键画面",
      })
      setDetail(result.detail)
      setTasks((current) => current.map((task) => (task.id === result.task.id ? result.task : task)))
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重做关键画面失败")
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

  const visibleDetail = filterHasNoTasks ? null : detail
  const visibleBlueprint = filterHasNoTasks ? null : blueprint
  const visibleReview = filterHasNoTasks ? null : review
  const visiblePendingNotice = filterHasNoTasks ? "" : blueprintPendingNotice

  return (
    <div className="workspace-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">任务审核</div>
          <h1>任务审核台</h1>
          <p>先把脚本、关键画面和尺寸看一遍，确认方向对了再继续生成正片。</p>
        </div>
        <div className="topbar-actions">
          {visibleBlueprint ? <span className="pill">{`方案 v${visibleBlueprint.version}`}</span> : null}
          {visibleDetail?.blueprintStatus ? <span className="pill pill--accent">{getBlueprintStatusLabel(visibleDetail.blueprintStatus)}</span> : null}
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}
      {visiblePendingNotice ? <div className="alert alert--warning">{visiblePendingNotice}</div> : null}

      <div className="workspace-grid">
        <section className="card card--main">
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
          {taskOptions.length ? (
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
          ) : (
            <div className="empty-inline">
              {taskFilter === "approved"
                ? "当前没有已通过的任务。"
                : taskFilter === "rejected"
                  ? "当前没有已驳回的任务。"
                  : "当前没有待审核任务。"}
            </div>
          )}

          {!filterHasNoTasks ? (
            <>
          <div className="section-header">
            <h2>生成方案总览</h2>
            <div className="section-actions">
              {canSubmitReview ? (
                <>
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
                    驳回并重做方案
                  </button>
                </>
              ) : canResumeApprovedBlueprint ? (
                <button
                  className="primary-button"
                  disabled={submitting}
                  onClick={() => void resumeExecution()}
                  type="button"
                >
                  继续生成正片
                </button>
              ) : (
                <span className="pill pill--sm">{isRejected ? "已驳回，等待重做" : "当前没有待审核动作"}</span>
              )}
            </div>
          </div>

          <div className="planning-strip">
            <div className="planning-chip">
              <span className="planning-chip__label">所属任务</span>
              <strong>{detail?.title ?? selectedTask?.title ?? "--"}</strong>
              <span>{selectedTask?.projectId ?? detail?.projectId ?? "--"}</span>
            </div>
            <div className="planning-chip">
              <span className="planning-chip__label">画面尺寸</span>
              <strong>{formatRenderSpec(detail, blueprint)}</strong>
              <span>{blueprint?.blueprint.renderSpec.aspectRatio ?? detail?.taskRunConfig.renderSpecJson.aspectRatio ?? "--"}</span>
            </div>
            <div className="planning-chip">
              <span className="planning-chip__label">生成方式</span>
              <strong>{getExecutionModeLabel(blueprint?.blueprint.executionMode ?? detail?.taskRunConfig.executionMode)}</strong>
              <span>{review ? `最近审核：${getReviewDecisionLabel(review.decision)}` : "还没有审核记录"}</span>
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

          <ModelUsageSummary source={detail?.taskRunConfig} trace={detail?.modelTrace} />

          <section className="planning-summary-card">
            <strong>视频内容</strong>
            <span>{sourceScript || "当前没有留档的视频内容。"}</span>
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
            <strong>画面参考（可选）与关键画面</strong>
            <span>
              {blueprint?.blueprint.visualPlan?.sourceBrief ??
                detail?.taskRunConfig.visualSeedInput ??
                "画面参考不是必填。未填写时，系统会直接根据视频内容生成关键画面。"}
            </span>
            <span>
              {`关键画面：${visibleKeyframeCount} 张 · ${visibleKeyframeMode === "single" ? "单张生成" : "批量生成"}`}
            </span>
            {blueprint?.blueprint.visualPlan ? (
              <span>
                主角：{blueprint.blueprint.visualPlan.subjectProfile} · 场景：{blueprint.blueprint.visualPlan.setting} · 情绪：{blueprint.blueprint.visualPlan.mood}
              </span>
            ) : null}
          </section>

          <section className="planning-summary-card">
            <strong>一致性要求</strong>
            <span>
              主体：{normalizeOperatorCopy(blueprint?.blueprint.subjectProfile ?? "--")} ·
              物料：{normalizeOperatorCopy(blueprint?.blueprint.productProfile ?? "--")}
            </span>
            <span>
              背景约束：{blueprint?.blueprint.backgroundConstraints?.map(normalizeOperatorCopy).join(" / ") || "无"}
            </span>
            <span>
              禁止项：{blueprint?.blueprint.negativeConstraints?.map(normalizeOperatorCopy).join(" / ") || "无"}
            </span>
          </section>

          <section className="planning-summary-card quality-reason-panel">
            <strong>驳回原因</strong>
            <span>{canSubmitReview ? "如果要驳回，请先选择最贴近的问题；备注可以不写。" : "这里会记录驳回时选择的问题，方便后续判断模型质量。"}</span>
            <div className="quality-reason-grid">
              {QUALITY_REASON_OPTIONS.map((option) => (
                <label key={option.issueCategory} className="quality-reason-option">
                  <input
                    checked={selectedQualityReasons.includes(option.issueCategory)}
                    disabled={!canSubmitReview}
                    onChange={() => toggleQualityReason(option.issueCategory)}
                    type="checkbox"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <label className="field-label" htmlFor="quality-note">可选备注</label>
            <textarea
              className="input quality-reason-note"
              disabled={!canSubmitReview}
              id="quality-note"
              maxLength={500}
              onChange={(event) => setQualityNote(event.target.value)}
              placeholder="一句话说明哪里不对，方便后续排查。"
              value={qualityNote}
            />
          </section>

          <div className="task-list">
            {blueprint?.blueprint.sceneContracts.map((scene) => (
              <section key={scene.id} className="keyframe-review-card">
                <div className="section-header section-header--stack">
                  <div>
                    <h3>{`第 ${scene.index + 1} 张关键画面`}</h3>
                    <span className="muted">{scene.sceneGoal}</span>
                  </div>
                  <span className={getReviewStatusChipClass(blueprint.status)}>
                    {getBlueprintStatusLabel(blueprint.status)}
                  </span>
                </div>
                <div className="keyframe-review-card__body">
                  <div className="keyframe-review-card__media">
                    <img
                      alt={`第 ${scene.index + 1} 张关键画面预览`}
                      className="visual-preview__image"
                      decoding="async"
                      loading="lazy"
                      onError={() => markKeyframeImageFailed(scene.id)}
                      src={buildKeyframePreviewUrl(detail?.taskId ?? blueprint?.taskId ?? "", scene.id)}
                    />
                    {failedKeyframeImages.includes(scene.id) ? (
                      <div className="visual-preview__error" role="status">
                        这张关键画面暂时打不开，请到素材页确认文件是否生成成功。
                      </div>
                    ) : null}
                  </div>
                  <div className="keyframe-review-card__details">
                    <div className="review-block">
                      <label className="field-label">这张图表达什么</label>
                      <div className="review-content">{scene.startFrameDescription}</div>
                    </div>
                    <div className="review-block">
                      <label className="field-label">使用模型</label>
                      <div className="review-content">{detail?.taskRunConfig.imageModel?.label ?? detail?.taskRunConfig.imageModel?.id ?? "未记录图片模型"}</div>
                    </div>
                    <div className="review-block">
                      <label className="field-label">生成依据 / 英文提示词</label>
                      <div className="review-content">{scene.imagePrompt}</div>
                    </div>
                    <div className="review-block">
                      <label className="field-label">状态</label>
                      <div className="review-content">
                        {failedKeyframeImages.includes(scene.id)
                          ? "预览图加载失败，建议先去素材页确认文件。"
                          : `画面记录已生成，预计视频片段 ${scene.durationSec}s。`}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="review-block">
                  <label className="field-label">接下来这段视频怎么动</label>
                  <div className="review-content">{scene.videoPrompt}</div>
                </div>
                <div className="review-block">
                  <label className="field-label">旁白</label>
                  <div className="review-content">{scene.voiceoverScript}</div>
                </div>
                <div className="review-block">
                  <label className="field-label">需要保持一致的地方</label>
                  <div className="review-content">
                    {scene.continuityConstraints.length ? scene.continuityConstraints.join(" / ") : "当前没有额外连续性要求"}
                  </div>
                </div>
                <div className="keyframe-review-card__actions">
                  <button
                    className="keyframe-action-button"
                    disabled={!detail || submitting || !canSubmitReview || !["waiting_review", "failed"].includes(selectedTask?.status ?? "")}
                    onClick={() => void retryKeyframe(scene.id)}
                    title={selectedTask?.status === "waiting_review" ? "只重做这一张关键画面" : "只有待审核或失败任务可以局部重做"}
                    type="button"
                  >
                    重做这张画面
                  </button>
                  {canSubmitReview ? (
                    <>
                      <button
                        className="primary-button"
                        disabled={!blueprint || submitting}
                        onClick={() => void submitReview("approved")}
                        type="button"
                      >
                        通过这个方案
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!blueprint || submitting}
                        onClick={() => void submitReview("rejected")}
                        type="button"
                      >
                        重做这个方案
                      </button>
                    </>
                  ) : (
                    <span className={getReviewStatusChipClass(blueprint?.status)}>
                      {isApproved ? "方案已通过" : isRejected ? "方案已驳回" : "等待方案"}
                    </span>
                  )}
                </div>
              </section>
            )) ?? <div className="empty-inline">当前还没有分段生成方案。</div>}
          </div>
            </>
          ) : null}
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>当前状态</h3>
            <div className="task-list compact-list">
              {filterHasNoTasks ? (
                <div className="task-item">
                  <strong>当前筛选</strong>
                  <span>暂无任务</span>
                </div>
              ) : (
                <>
                  <div className="task-item">
                    <strong>方案版本</strong>
                    <span>{visibleBlueprint ? `方案 v${visibleBlueprint.version}` : "未生成"}</span>
                  </div>
                  <div className="task-item">
                    <strong>方案状态</strong>
                    <span>{getBlueprintStatusLabel(visibleBlueprint?.status ?? visibleDetail?.blueprintStatus)}</span>
                  </div>
                  <div className="task-item">
                    <strong>最新审核</strong>
                    <span>{visibleReview ? `${getReviewDecisionLabel(visibleReview.decision)} · ${visibleReview.decidedAt}` : "暂无"}</span>
                  </div>
                  <div className="task-item">
                    <strong>视频内容</strong>
                    <span>{sourceScript ? "已加载" : "暂无"}</span>
                  </div>
                  <div className="task-item">
                    <strong>音频策略</strong>
                    <span>{getAudioStrategyLabel(visibleDetail?.taskRunConfig.audioStrategy)}</span>
                  </div>
                </>
              )}
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
