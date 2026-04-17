import { useEffect, useMemo, useState } from "react"
import { api, type StoryboardScene, type TaskDetail, type TaskSummary } from "../api"

export function KeyframeReviewPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [selectedSceneId, setSelectedSceneId] = useState("")

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
      setSelectedSceneId(result.detail.scenes[0]?.id ?? "")
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

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Keyframe Review</div>
          <h1>关键帧审阅工作台</h1>
          <p>确认画面、时长和风格策略在进入视频生成前是否对齐内容母本。</p>
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
            <span>{selectedTask?.planning?.planningSummary ?? "系统会先预判这条任务的视觉编排，再进入关键帧审阅。"}</span>
            <div className="planning-summary-tags">
              <span className="pill pill--sm">{selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span>
              <span className="pill pill--sm">{selectedTask?.targetDurationSec ?? 0}s</span>
            </div>
          </div>
          <h3>关键帧缩略图</h3>
          <div className="scene-list">
            {detail?.scenes.map((scene) => (
              <button
                key={scene.id}
                className={scene.id === selectedSceneId ? 'scene-chip scene-chip--active' : 'scene-chip'}
                onClick={() => setSelectedSceneId(scene.id)}
              >
                <strong>{scene.title}</strong>
                <span>{scene.keyframeStatus === "approved" ? "已通过" : scene.keyframeStatus === "rejected" ? "退回" : "待审阅"}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card review-main review-main--visual">
          <h3>关键帧预览</h3>
          <div className="planning-inline">
            <span className="pill pill--sm">{detail?.planning?.generationRouteLabel ?? "待预判"}</span>
            <span className="pill pill--sm">{detail?.planning?.planningSourceLabel ?? "前端兼容预判"}</span>
          </div>
          <div className="visual-preview">
            <div className="visual-placeholder">{selectedScene?.title ?? "Preview Frame"}</div>
          </div>
          <div className="metric-grid">
            <div className="metric-card"><span>分辨率</span><strong>1080 × 1920</strong></div>
            <div className="metric-card"><span>时间轴</span><strong>{selectedScene ? `${selectedScene.startLabel} - ${selectedScene.endLabel}` : "--"}</strong></div>
            <div className="metric-card"><span>模型</span><strong>{detail?.taskRunConfig.imageFinalModel?.label ?? "Gemini 3 Pro"}</strong></div>
            <div className="metric-card"><span>预判分镜</span><strong>{detail?.planning?.sceneCount ?? detail?.scenes.length ?? "--"}</strong></div>
          </div>
          <div className="review-block">
            <label className="field-label">图像提示词</label>
            <div className="review-content">{selectedScene?.imagePrompt ?? "暂无提示词"}</div>
          </div>
        </section>

        <aside className="card review-actions">
          <h3>关键帧决策</h3>
          <button className="primary-button">通过关键帧</button>
          <button className="secondary-button">重新生成图片</button>
          <div style={{ borderTop: "1px solid var(--genergi-border)", margin: "4px 0" }} />
          <button className="ghost-button">升级模型重试</button>
          <button className="ghost-button">返回分镜修改</button>
          <label className="field-label">审阅意见</label>
          <textarea className="textarea textarea--compact" defaultValue="主产品主体已经足够明确，但高光可以再柔一点，让品牌质感更高级。" />
        </aside>
      </div>
    </>
  )
}
