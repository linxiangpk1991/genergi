import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  api,
  buildAssetCenterUrl,
  buildBatchDashboardUrl,
  buildKeyframePreviewUrl,
  buildStoryboardReviewUrl,
  type ReviewDecision,
  type StoryboardScene,
  type TaskDetail,
  type TaskSummary,
} from "../api"

function getKeyframeStatusLabel(status: StoryboardScene["keyframeStatus"]) {
  if (status === "approved") {
    return "已通过"
  }
  if (status === "rejected") {
    return "退回"
  }
  return "待审阅"
}

function formatDurationDelta(detail: TaskDetail | null, task: TaskSummary | null) {
  const actualDuration = detail?.actualDurationSec ?? task?.actualDurationSec ?? null
  const targetDuration = detail?.taskRunConfig.targetDurationSec ?? task?.targetDurationSec ?? null
  if (actualDuration == null || targetDuration == null) {
    return "待成片"
  }

  const delta = actualDuration - targetDuration
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}s`
}

function getNextKeyframeSceneId(detail: TaskDetail, currentSceneId: string) {
  const pendingScenes = detail.scenes.filter((scene) => scene.keyframeStatus === "pending")
  if (pendingScenes.length === 0) {
    return currentSceneId
  }

  const currentIndex = detail.scenes.findIndex((scene) => scene.id === currentSceneId)
  const laterPending = detail.scenes.find(
    (scene) => scene.index > (currentIndex >= 0 ? detail.scenes[currentIndex]?.index ?? -1 : -1) && scene.keyframeStatus === "pending",
  )

  return laterPending?.id ?? pendingScenes[0]?.id ?? currentSceneId
}

function getPreferredKeyframeSceneId(detail: TaskDetail, requestedSceneId: string) {
  const requestedScene = requestedSceneId ? detail.scenes.find((scene) => scene.id === requestedSceneId) : null
  if (requestedScene) {
    return requestedScene.id
  }

  return detail.scenes.find((scene) => scene.keyframeStatus === "pending")?.id ?? detail.scenes[0]?.id ?? ""
}

function replaceTaskSummary(tasks: TaskSummary[], nextTask: TaskSummary) {
  const existingIndex = tasks.findIndex((task) => task.id === nextTask.id)
  if (existingIndex < 0) {
    return [nextTask, ...tasks]
  }

  return tasks.map((task) => (task.id === nextTask.id ? nextTask : task))
}

export function KeyframeReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const routeTaskId = searchParams.get("taskId") ?? ""
  const routeSceneId = searchParams.get("sceneId") ?? ""

  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [selectedSceneId, setSelectedSceneId] = useState("")
  const [reviewNote, setReviewNote] = useState("")
  const [previewFailed, setPreviewFailed] = useState(false)
  const [submittingDecision, setSubmittingDecision] = useState<ReviewDecision | null>(null)
  const [submitError, setSubmitError] = useState("")
  const [submitMessage, setSubmitMessage] = useState("")
  const [loadError, setLoadError] = useState("")
  const [detailLoading, setDetailLoading] = useState(false)

  function syncRouteContext(taskId?: string, sceneId?: string, replace = true) {
    const currentTaskId = searchParams.get("taskId") ?? ""
    const currentSceneId = searchParams.get("sceneId") ?? ""
    const nextTaskId = taskId ?? ""
    const nextSceneId = sceneId ?? ""

    if (currentTaskId === nextTaskId && currentSceneId === nextSceneId) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)

    if (taskId) {
      nextSearchParams.set("taskId", taskId)
    } else {
      nextSearchParams.delete("taskId")
    }

    if (sceneId) {
      nextSearchParams.set("sceneId", sceneId)
    } else {
      nextSearchParams.delete("sceneId")
    }

    setSearchParams(nextSearchParams, { replace })
  }

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const taskList = await api.listTasks()
        if (!active) {
          return
        }

        setTasks(taskList.tasks)
        setLoadError("")
      } catch {
        if (!active) {
          return
        }

        setTasks([])
        setLoadError("任务列表加载失败，请稍后刷新页面重试。")
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!tasks.length) {
      setSelectedTaskId("")
      return
    }

    const nextTask =
      tasks.find((task) => task.id === routeTaskId) ??
      tasks.find((task) => task.reviewStage === "keyframe_review") ??
      tasks[0] ??
      null

    if (nextTask && nextTask.id !== selectedTaskId) {
      setSelectedTaskId(nextTask.id)
    }
  }, [routeTaskId, selectedTaskId, tasks])

  useEffect(() => {
    if (!selectedTaskId) {
      setDetail(null)
      setSelectedSceneId("")
      return
    }

    let active = true

    async function loadDetail() {
      setDetailLoading(true)

      try {
        const result = await api.getTaskDetail(selectedTaskId)
        if (!active) {
          return
        }

        setDetail(result.detail)
        setLoadError("")
        setSubmitError("")
        setSubmitMessage("")
      } catch {
        if (!active) {
          return
        }

        setDetail(null)
        setSelectedSceneId("")
        setLoadError("任务详情加载失败，当前无法进入关键帧审阅。")
      } finally {
        if (active) {
          setDetailLoading(false)
        }
      }
    }

    void loadDetail()

    return () => {
      active = false
    }
  }, [selectedTaskId])

  useEffect(() => {
    if (!detail) {
      return
    }

    const nextSceneId = getPreferredKeyframeSceneId(detail, routeSceneId)
    if (nextSceneId !== selectedSceneId) {
      setSelectedSceneId(nextSceneId)
    }

    syncRouteContext(detail.taskId, nextSceneId || undefined, true)
  }, [detail, routeSceneId, selectedSceneId])

  const selectedScene = useMemo<StoryboardScene | null>(() => {
    if (!detail) {
      return null
    }

    return detail.scenes.find((scene) => scene.id === selectedSceneId) ?? detail.scenes[0] ?? null
  }, [detail, selectedSceneId])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  )

  useEffect(() => {
    setReviewNote(selectedScene?.keyframeReviewNote ?? "")
    setPreviewFailed(false)
    setSubmitError("")
    setSubmitMessage("")
  }, [selectedScene?.id, selectedScene?.keyframeReviewNote])

  function handleTaskChange(taskId: string) {
    setSelectedTaskId(taskId)
    setDetail(null)
    setSelectedSceneId("")
    syncRouteContext(taskId, undefined, false)
  }

  function handleSceneChange(sceneId: string) {
    setSelectedSceneId(sceneId)
    setPreviewFailed(false)
    syncRouteContext(selectedTaskId, sceneId, false)
  }

  const previewUrl = selectedTaskId && selectedScene
    ? buildKeyframePreviewUrl(selectedTaskId, selectedScene.id)
    : null

  async function submitDecision(decision: ReviewDecision) {
    if (!selectedTaskId || !selectedScene) {
      return
    }

    setSubmittingDecision(decision)
    setSubmitError("")
    setSubmitMessage("")

    try {
      const response = await api.submitKeyframeReview(selectedTaskId, selectedScene.id, {
        decision,
        note: reviewNote.trim() || undefined,
      })

      const nextSceneId =
        decision === "approved"
          ? getNextKeyframeSceneId(response.detail, selectedScene.id)
          : selectedScene.id

      setTasks((current) => replaceTaskSummary(current, response.task))
      setDetail(response.detail)
      setSelectedSceneId(nextSceneId)
      syncRouteContext(response.detail.taskId, nextSceneId, true)
      setSubmitMessage(decision === "approved" ? "当前关键帧已通过并写回服务器。" : "当前关键帧已退回并写回服务器。")
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "提交失败，请稍后重试。")
    } finally {
      setSubmittingDecision(null)
    }
  }

  const pendingCount = detail?.pendingReviewCount ?? selectedTask?.pendingReviewCount ?? 0
  const selectedSceneAvailable = Boolean(selectedScene)

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Keyframe Review</div>
          <h1>关键帧审阅工作台</h1>
          <p>先看系统为什么这样规划，再直接检查真实关键帧是否和分镜、风格与 CTA 方向保持一致。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">{detail?.planning?.generationRouteLabel ?? selectedTask?.planning?.generationRouteLabel ?? "待预判"}</span>
          <span className="pill pill--accent">{detail?.planning?.generationPreferenceLabel ?? selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span>
        </div>
      </header>

      <div className="review-grid">
        <section className="card review-sidebar">
          <label className="field-label">任务选择</label>
          <select className="input" value={selectedTaskId} onChange={(event) => handleTaskChange(event.target.value)}>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} · {task.targetDurationSec}s · {task.planning?.generationRouteLabel ?? "待预判"}
              </option>
            ))}
          </select>

          <div className="planning-summary-card">
            <strong>{selectedTask?.planning?.generationRouteLabel ?? "待预判"}</strong>
            <span>{selectedTask?.planning?.planningSummary ?? "系统会先预判这条任务的视觉编排，再进入关键帧审阅。"}</span>
            <div className="planning-summary-tags">
              <span className="pill pill--sm">{selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span>
              <span className="pill pill--sm">目标 {selectedTask?.targetDurationSec ?? 0}s</span>
              <span className="pill pill--sm">待审 {pendingCount}</span>
            </div>
          </div>

          <div className="route-context-card">
            <strong>当前定位会写入链接</strong>
            <span>
              {selectedTaskId
                ? `任务 ${selectedTaskId}${selectedScene ? ` · Scene #${selectedScene.index + 1}` : ""} 已同步到 URL，可刷新或收藏后继续处理。`
                : "选择任务和关键帧后，地址会自动同步当前上下文。"}
            </span>
          </div>

          <div className="review-sidebar-card">
            <h3>规划依据</h3>
            <div className="task-list compact-list">
              <div className="task-item"><strong>路由原因</strong><span>{detail?.taskRunConfig.routeReason ?? selectedTask?.routeReason ?? "待接入"}</span></div>
              <div className="task-item"><strong>风格指引</strong><span>{detail?.visualStyleGuide ?? "暂无风格指引"}</span></div>
              <div className="task-item"><strong>CTA</strong><span>{detail?.ctaLine ?? "暂无 CTA"}</span></div>
              <div className="task-item"><strong>时长对齐</strong><span>{formatDurationDelta(detail, selectedTask)}</span></div>
              <div className="task-item"><strong>当前阶段</strong><span>{detail?.reviewStage === "keyframe_review" ? "关键帧审阅中" : detail?.reviewStage === "storyboard_review" ? "仍在分镜审阅" : "本阶段已清空"}</span></div>
            </div>
          </div>

          <h3>关键帧列表</h3>
          {detailLoading ? <div className="review-inline-note">正在加载关键帧列表...</div> : null}
          {loadError ? (
            <div className="review-inline-note review-inline-note--danger" role="alert">
              {loadError}
            </div>
          ) : null}
          {!detailLoading && detail && detail.scenes.length === 0 ? (
            <div className="review-inline-note">当前任务还没有可审的关键帧场景，稍后刷新会自动补位。</div>
          ) : null}
          <div className="scene-list">
            {detail?.scenes.map((scene) => (
              <button
                key={scene.id}
                className={scene.id === selectedSceneId ? "scene-chip scene-chip--active" : "scene-chip"}
                onClick={() => handleSceneChange(scene.id)}
                type="button"
              >
                <div className="scene-chip__title-row">
                  <strong>#{scene.index + 1} · {scene.title}</strong>
                  <span className={scene.keyframeStatus === "approved" ? "status-text--success" : scene.keyframeStatus === "rejected" ? "status-text--danger" : "status-text--warning"}>
                    {getKeyframeStatusLabel(scene.keyframeStatus)}
                  </span>
                </div>
                <div className="scene-chip__meta">
                  <span>{scene.durationSec.toFixed(1)}s</span>
                  <span>{scene.startLabel} - {scene.endLabel}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="card review-main review-main--visual">
          <div className="section-header">
            <h3>关键帧预览</h3>
            {selectedScene ? <span className="pill pill--sm">#{selectedScene.index + 1}</span> : null}
          </div>
          <div className="planning-inline">
            <span className="pill pill--sm">{detail?.planning?.generationRouteLabel ?? "待预判"}</span>
            <span className="pill pill--sm">{detail?.planning?.generationPreferenceLabel ?? "待接入"}</span>
            <span className="pill pill--sm">偏差 {formatDurationDelta(detail, selectedTask)}</span>
          </div>
          <div className="visual-preview">
            {!selectedScene ? (
              <div className="review-empty-state">当前任务还没有可审的关键帧场景。</div>
            ) : previewFailed || !previewUrl ? (
              <div className="review-empty-state">关键帧暂未产出，或当前图片读取失败。请先检查资产中心或重新生成。</div>
            ) : (
              <img
                alt={`${selectedScene.title} keyframe preview`}
                className="visual-preview__image"
                onError={() => setPreviewFailed(true)}
                onLoad={() => setPreviewFailed(false)}
                src={previewUrl}
              />
            )}
          </div>
          <div className="metric-grid">
            <div className="metric-card"><span>分辨率</span><strong>1080 × 1920</strong></div>
            <div className="metric-card"><span>时间轴</span><strong>{selectedScene ? `${selectedScene.startLabel} - ${selectedScene.endLabel}` : "--"}</strong></div>
            <div className="metric-card"><span>图像模型</span><strong>{detail?.taskRunConfig.imageModel?.label ?? "待同步"}</strong></div>
            <div className="metric-card"><span>分镜总数</span><strong>{detail?.scenes.length ?? "--"}</strong></div>
          </div>
          <div className="review-block">
            <label className="field-label">图像提示词</label>
            <div className="review-content">{selectedScene?.imagePrompt ?? "暂无提示词"}</div>
          </div>
        </section>

        <aside className="card review-actions">
          <div className="review-actions-note">
            {submittingDecision
              ? `正在提交${submittingDecision === "approved" ? "通过" : "退回"}结果...`
              : "当前页会把关键帧审阅结果真实写回服务器，并按服务器返回结果刷新任务状态。"}
          </div>
          {submitError ? (
            <div className="review-actions-note review-actions-note--danger" role="alert">
              提交失败：{submitError}
            </div>
          ) : null}
          {submitMessage ? (
            <div className="review-actions-note review-actions-note--success">
              {submitMessage}
            </div>
          ) : null}
          <div className="review-aside-group">
            <h3>主决策</h3>
            <button
              className="primary-button"
              disabled={!selectedSceneAvailable || submittingDecision != null}
              onClick={() => void submitDecision("approved")}
              type="button"
            >
              {submittingDecision === "approved" ? "提交中..." : "通过关键帧"}
            </button>
            <button
              className="secondary-button"
              disabled={!selectedSceneAvailable || submittingDecision != null}
              onClick={() => void submitDecision("rejected")}
              type="button"
            >
              {submittingDecision === "rejected" ? "提交中..." : "退回当前关键帧"}
            </button>
          </div>

          <div className="review-aside-group">
            <h3>定位入口</h3>
            <Link className="ghost-button" to={buildStoryboardReviewUrl(selectedTaskId || undefined, selectedScene?.id)}>
              回到同 Scene 分镜
            </Link>
            <Link className="ghost-button" to={buildAssetCenterUrl(selectedTaskId || undefined)}>
              打开任务资产
            </Link>
            <Link className="ghost-button" to={buildBatchDashboardUrl(selectedTaskId || undefined)}>
              返回生产看板
            </Link>
          </div>

          <div className="review-aside-group">
            <h3>暂未开放</h3>
            <div className="review-inline-note">
              模型升级重试、返回脚本复核和直接重新生成图片仍未接入后端。当前只保留能直达真实处理页的入口，不展示假动作。
            </div>
          </div>

          <label className="field-label">审阅意见</label>
          <textarea
            className="textarea textarea--compact"
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="写给图像返工链路的具体意见会一起持久化。"
            value={reviewNote}
          />
        </aside>
      </div>
    </>
  )
}
