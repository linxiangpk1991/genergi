import { useEffect, useMemo, useState } from "react"
import { api, type StoryboardScene, type TaskDetail, type TaskSummary } from "../api"

export function StoryboardReviewPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [selectedSceneId, setSelectedSceneId] = useState<string>("")

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
          <div className="eyebrow">Storyboard Review</div>
          <h1>分镜审阅工作台</h1>
          <p>对内容母本展开后的 scene 进行审阅，确认时长、规划方式和画面表达是否一致。</p>
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
            <span>{selectedTask?.planning?.planningSummary ?? "系统会根据总时长与生成方式预判分镜规划。"}</span>
            <div className="planning-summary-tags">
              <span className="pill pill--sm">{selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span>
              <span className="pill pill--sm">{selectedTask?.targetDurationSec ?? 0}s</span>
            </div>
          </div>
          <h3>Scene 列表</h3>
          <div className="scene-list">
            {detail?.scenes.map((scene) => (
              <button
                key={scene.id}
                className={scene.id === selectedSceneId ? 'scene-chip scene-chip--active' : 'scene-chip'}
                onClick={() => setSelectedSceneId(scene.id)}
              >
                <strong>{scene.title}</strong>
                <span>{scene.reviewStatus === "approved" ? "已通过" : scene.reviewStatus === "rejected" ? "退回" : "待审阅"}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card review-main">
          <h3>当前 Scene 内容</h3>
          <div className="planning-inline">
            <span className="pill pill--sm">{detail?.planning?.generationRouteLabel ?? "待预判"}</span>
            <span className="pill pill--sm">{detail?.planning?.generationPreferenceLabel ?? "待接入"}</span>
            <span className="pill pill--sm">{detail?.planning?.planningSourceLabel ?? "前端兼容预判"}</span>
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
            <div className="metric-card"><span>时长</span><strong>{selectedScene ? `${selectedScene.durationSec.toFixed(1)}s` : "--"}</strong></div>
            <div className="metric-card"><span>时间轴</span><strong>{selectedScene ? `${selectedScene.startLabel} - ${selectedScene.endLabel}` : "--"}</strong></div>
            <div className="metric-card"><span>规划总长</span><strong>{detail?.planning?.targetDurationSec ?? selectedTask?.targetDurationSec ?? "--"}s</strong></div>
            <div className="metric-card"><span>预判分镜</span><strong>{detail?.planning?.sceneCount ?? detail?.scenes.length ?? "--"}</strong></div>
          </div>
        </section>

        <aside className="card review-actions">
          <h3>审阅操作</h3>
          <button className="primary-button">通过并进入下一 Scene</button>
          <button className="secondary-button">退回修改</button>
          <div style={{ borderTop: "1px solid var(--genergi-border)", margin: "4px 0" }} />
          <button className="ghost-button">合并 Scene</button>
          <button className="ghost-button">拆分 Scene</button>
          <button className="ghost-button">重新生成建议</button>
          <label className="field-label">审阅备注</label>
          <textarea className="textarea textarea--compact" defaultValue="建议把 opening visual 再聚焦到单一卖点，降低背景元素干扰。" />
        </aside>
      </div>
    </>
  )
}
