import { useEffect, useMemo, useState } from "react"
import { api, type ReviewDecision, type StoryboardScene, type TaskDetail, type TaskSummary } from "../api"

function getReviewStatusLabel(status: StoryboardScene["reviewStatus"]) {
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

function getNextStoryboardSceneId(detail: TaskDetail, currentSceneId: string) {
  const pendingScenes = detail.scenes.filter((scene) => scene.reviewStatus === "pending")
  if (pendingScenes.length === 0) {
    return currentSceneId
  }

  const currentIndex = detail.scenes.findIndex((scene) => scene.id === currentSceneId)
  const laterPending = detail.scenes.find(
    (scene) => scene.index > (currentIndex >= 0 ? detail.scenes[currentIndex]?.index ?? -1 : -1) && scene.reviewStatus === "pending",
  )

  return laterPending?.id ?? pendingScenes[0]?.id ?? currentSceneId
}

function replaceTaskSummary(tasks: TaskSummary[], nextTask: TaskSummary) {
  const existingIndex = tasks.findIndex((task) => task.id === nextTask.id)
  if (existingIndex < 0) {
    return [nextTask, ...tasks]
  }

  return tasks.map((task) => (task.id === nextTask.id ? nextTask : task))
}

export function StoryboardReviewPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [selectedSceneId, setSelectedSceneId] = useState<string>("")
  const [reviewNote, setReviewNote] = useState("")
  const [submittingDecision, setSubmittingDecision] = useState<ReviewDecision | null>(null)
  const [submitError, setSubmitError] = useState("")
  const [submitMessage, setSubmitMessage] = useState("")

  useEffect(() => {
    async function load() {
      const taskList = await api.listTasks()
      setTasks(taskList.tasks)
      const targetTask = taskList.tasks[0]
      if (!targetTask) {
        return
      }

      setSelectedTaskId(targetTask.id)
    }

    void load().catch(() => {})
  }, [])

  useEffect(() => {
    async function loadDetail() {
      if (!selectedTaskId) {
        return
      }

      const result = await api.getTaskDetail(selectedTaskId)
      setDetail(result.detail)
      const pendingScene = result.detail.scenes.find((scene) => scene.reviewStatus === "pending")
      setSelectedSceneId(pendingScene?.id ?? result.detail.scenes[0]?.id ?? "")
      setSubmitError("")
      setSubmitMessage("")
    }

    void loadDetail().catch(() => {})
  }, [selectedTaskId])

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
    setReviewNote(selectedScene?.reviewNote ?? "")
    setSubmitError("")
    setSubmitMessage("")
  }, [selectedScene?.id, selectedScene?.reviewNote])

  async function submitDecision(decision: ReviewDecision) {
    if (!selectedTaskId || !selectedScene) {
      return
    }

    setSubmittingDecision(decision)
    setSubmitError("")
    setSubmitMessage("")

    try {
      const response = await api.submitStoryboardReview(selectedTaskId, selectedScene.id, {
        decision,
        note: reviewNote.trim() || undefined,
      })

      setTasks((current) => replaceTaskSummary(current, response.task))
      setDetail(response.detail)
      setSelectedSceneId(
        decision === "approved"
          ? getNextStoryboardSceneId(response.detail, selectedScene.id)
          : selectedScene.id,
      )
      setSubmitMessage(decision === "approved" ? "当前 Scene 已通过并写回服务器。" : "当前 Scene 已退回并写回服务器。")
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
          <div className="eyebrow">Storyboard Review</div>
          <h1>分镜审阅工作台</h1>
          <p>先看为什么这样规划，再逐个判断 scene 的脚本、镜头提示和节奏是否真的对齐内容母本。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">{detail?.planning?.generationRouteLabel ?? selectedTask?.planning?.generationRouteLabel ?? "待预判"}</span>
          <span className="pill pill--accent">{detail?.planning?.generationPreferenceLabel ?? selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span>
        </div>
      </header>

      <div className="review-grid">
        <section className="card review-sidebar">
          <label className="field-label">任务选择</label>
          <select className="input" value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)}>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} · {task.targetDurationSec}s · {task.planning?.generationRouteLabel ?? "待预判"}
              </option>
            ))}
          </select>

          <div className="planning-summary-card">
            <strong>{selectedTask?.planning?.generationRouteLabel ?? "待预判"}</strong>
            <span>{selectedTask?.planning?.planningSummary ?? "系统会根据内容母本与时长做规划。"}</span>
            <div className="planning-summary-tags">
              <span className="pill pill--sm">{selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span>
              <span className="pill pill--sm">目标 {selectedTask?.targetDurationSec ?? 0}s</span>
              <span className="pill pill--sm">待审 {pendingCount}</span>
            </div>
          </div>

          <div className="review-sidebar-card">
            <h3>规划依据</h3>
            <div className="task-list compact-list">
              <div className="task-item"><strong>路由原因</strong><span>{detail?.taskRunConfig.routeReason ?? selectedTask?.routeReason ?? "待接入"}</span></div>
              <div className="task-item"><strong>风格指引</strong><span>{detail?.visualStyleGuide ?? "暂无风格指引"}</span></div>
              <div className="task-item"><strong>CTA</strong><span>{detail?.ctaLine ?? "暂无 CTA"}</span></div>
              <div className="task-item"><strong>时长对齐</strong><span>{formatDurationDelta(detail, selectedTask)}</span></div>
              <div className="task-item"><strong>当前阶段</strong><span>{detail?.reviewStage === "storyboard_review" ? "分镜审阅中" : detail?.reviewStage === "keyframe_review" ? "关键帧审阅中" : "本阶段已清空"}</span></div>
            </div>
          </div>

          <h3>Scene 列表</h3>
          <div className="scene-list">
            {detail?.scenes.map((scene) => (
              <button
                key={scene.id}
                className={scene.id === selectedSceneId ? "scene-chip scene-chip--active" : "scene-chip"}
                onClick={() => setSelectedSceneId(scene.id)}
                type="button"
              >
                <div className="scene-chip__title-row">
                  <strong>#{scene.index + 1} · {scene.title}</strong>
                  <span className={scene.reviewStatus === "approved" ? "status-text--success" : scene.reviewStatus === "rejected" ? "status-text--danger" : "status-text--warning"}>
                    {getReviewStatusLabel(scene.reviewStatus)}
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

        <section className="card review-main">
          <div className="section-header">
            <h3>当前 Scene 内容</h3>
            {selectedScene ? <span className="pill pill--sm">#{selectedScene.index + 1}</span> : null}
          </div>
          <div className="planning-inline">
            <span className="pill pill--sm">{detail?.planning?.generationRouteLabel ?? "待预判"}</span>
            <span className="pill pill--sm">{detail?.planning?.generationPreferenceLabel ?? "待接入"}</span>
            <span className="pill pill--sm">偏差 {formatDurationDelta(detail, selectedTask)}</span>
          </div>
          <div className="review-block">
            <label className="field-label">英文脚本文案</label>
            <div className="review-content">{selectedScene?.script ?? "暂无分镜内容"}</div>
          </div>
          <div className="review-block">
            <label className="field-label">Image Prompt</label>
            <div className="review-content">{selectedScene?.imagePrompt ?? "暂无图像提示词"}</div>
          </div>
          <div className="review-block">
            <label className="field-label">Video Prompt</label>
            <div className="review-content">{selectedScene?.videoPrompt ?? "暂无视频提示词"}</div>
          </div>
          <div className="metric-grid">
            <div className="metric-card"><span>分镜时长</span><strong>{selectedScene ? `${selectedScene.durationSec.toFixed(1)}s` : "--"}</strong></div>
            <div className="metric-card"><span>时间轴</span><strong>{selectedScene ? `${selectedScene.startLabel} - ${selectedScene.endLabel}` : "--"}</strong></div>
            <div className="metric-card"><span>规划总长</span><strong>{detail?.taskRunConfig.targetDurationSec ?? selectedTask?.targetDurationSec ?? "--"}s</strong></div>
            <div className="metric-card"><span>分镜总数</span><strong>{detail?.scenes.length ?? "--"}</strong></div>
          </div>
        </section>

        <aside className="card review-actions">
          <div className="review-actions-note">
            {submittingDecision
              ? `正在提交${submittingDecision === "approved" ? "通过" : "退回"}结果...`
              : "当前页会把分镜审阅结果真实写回服务器，并按服务器返回结果刷新任务状态。"}
          </div>
          {submitError ? (
            <div className="review-actions-note" role="alert">
              提交失败：{submitError}
            </div>
          ) : null}
          {submitMessage ? (
            <div className="review-actions-note">
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
              {submittingDecision === "approved" ? "提交中..." : "通过并继续审阅"}
            </button>
            <button
              className="secondary-button"
              disabled={!selectedSceneAvailable || submittingDecision != null}
              onClick={() => void submitDecision("rejected")}
              type="button"
            >
              {submittingDecision === "rejected" ? "提交中..." : "退回当前 Scene"}
            </button>
          </div>

          <div className="review-aside-group">
            <h3>重工动作</h3>
            <button className="ghost-button" disabled type="button">重新生成建议</button>
            <button className="ghost-button" disabled type="button">返回脚本调整</button>
          </div>

          <div className="review-aside-group">
            <h3>高级操作</h3>
            <button className="ghost-button" disabled type="button">合并 Scene</button>
            <button className="ghost-button" disabled type="button">拆分 Scene</button>
          </div>

          <label className="field-label">审阅备注</label>
          <textarea
            className="textarea textarea--compact"
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="写给后续处理链路的具体反馈会一起持久化。"
            value={reviewNote}
          />
        </aside>
      </div>
    </>
  )
}
