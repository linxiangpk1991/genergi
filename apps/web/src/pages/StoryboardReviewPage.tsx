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

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Storyboard Review</div>
          <h1>分镜审阅工作台</h1>
          <p>对英语短视频脚本进行场景级审阅，确认画面、时长和生成策略。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">高质量模式</span>
          <span className="pill pill--accent">TikTok / Reels</span>
        </div>
      </header>

      <div className="review-grid">
        <section className="card review-sidebar">
          <label className="field-label">任务选择</label>
          <select className="input" value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)}>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
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
