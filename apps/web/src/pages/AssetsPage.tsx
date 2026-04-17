import { useEffect, useState } from "react"
import { api, type AssetRecord, type RuntimeStatusResponse, type TaskSummary } from "../api"

export function AssetsPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [runtime, setRuntime] = useState<RuntimeStatusResponse["runtime"] | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [assets, setAssets] = useState<AssetRecord[]>([])

  useEffect(() => {
    async function load() {
      const [taskResult, runtimeResult] = await Promise.all([api.listTasks(), api.runtimeStatus()])
      setTasks(taskResult.tasks)
      setRuntime(runtimeResult.runtime)
      setSelectedTaskId((current) => current || taskResult.tasks[0]?.id || "")
    }

    void load().catch(() => {})

    const timer = window.setInterval(() => {
      void Promise.all([api.listTasks(), api.runtimeStatus()])
        .then(([taskResult, runtimeResult]) => {
          setTasks(taskResult.tasks)
          setRuntime(runtimeResult.runtime)
          setSelectedTaskId((current) => current || taskResult.tasks[0]?.id || "")
        })
        .catch(() => {})
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    async function loadAssets() {
      if (!selectedTaskId) {
        setAssets([])
        return
      }

      const result = await api.getTaskAssets(selectedTaskId)
      setAssets(result.assets)
    }

    void loadAssets().catch(() => setAssets([]))
  }, [selectedTaskId])

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Asset Center</div>
          <h1>素材资产中心</h1>
          <p>集中查看当前任务的脚本、分镜、关键帧与运行时资产状态，作为后续文件中心与导出中心的入口。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">英语内容产线</span>
          <span className="pill pill--accent">Phase 1</span>
        </div>
      </header>

      <div className="workspace-grid">
        <section className="card card--main">
          <label className="field-label">任务选择</label>
          <select className="input" value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)}>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
          <h2>最近任务资产概览</h2>
          <div className="task-list">
            {assets.map((asset) => (
              <div key={asset.id} className="task-item task-item--wide">
                <div>
                  <strong>{asset.label}</strong>
                  <span>{asset.assetType}</span>
                </div>
                <div>
                  <strong>{asset.status}</strong>
                  <span>{new Date(asset.createdAt).toLocaleString("zh-CN")}</span>
                </div>
                <div>
                  <strong>记录路径</strong>
                  <span>{asset.path}</span>
                </div>
              </div>
            ))}
            {!assets.length ? (
              <div className="task-item task-item--wide">
                <div><strong>暂无资产</strong><span>先创建并执行任务</span></div>
                <div><strong>pending</strong><span>等待 worker 输出</span></div>
                <div><strong>记录路径</strong><span>暂未生成</span></div>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>运行时状态</h3>
            <div className="task-list compact-list">
              <div className="task-item">
                <strong>{runtime?.api.name ?? "api"}</strong>
                <span>{runtime?.api.status ?? "unknown"} · {runtime?.api.message ?? "N/A"}</span>
              </div>
              <div className="task-item">
                <strong>{runtime?.worker.name ?? "worker"}</strong>
                <span>{runtime?.worker.status ?? "unknown"} · {runtime?.worker.message ?? "N/A"}</span>
              </div>
              <div className="task-item">
                <strong>{runtime?.redis.name ?? "redis"}</strong>
                <span>{runtime?.redis.status ?? "unknown"} · {runtime?.redis.message ?? "N/A"}</span>
              </div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>后续规划</h3>
            <div className="task-list compact-list">
              <div className="task-item"><strong>文件导出</strong><span>脚本、SRT、图片、视频、成片</span></div>
              <div className="task-item"><strong>对象存储</strong><span>S3 / 云存储接入预留</span></div>
              <div className="task-item"><strong>版本追踪</strong><span>按任务与 scene 做资产版本管理</span></div>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
