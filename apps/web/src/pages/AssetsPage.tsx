import { useEffect, useMemo, useState } from "react"
import { api, buildAssetDownloadUrl, buildAssetPreviewUrl, type AssetRecord, type RuntimeStatusResponse, type TaskSummary } from "../api"

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

  const assetStats = useMemo(() => {
    const readyCount = assets.filter((asset) => asset.status === "ready").length
    const previewableCount = assets.filter((asset) => asset.previewable).length
    const directoryCount = assets.filter((asset) => asset.isDirectory).length
    const missingCount = assets.filter((asset) => !asset.exists).length

    return { readyCount, previewableCount, directoryCount, missingCount }
  }, [assets])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  )

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Asset Center</div>
          <h1>素材资产中心</h1>
          <p>集中查看当前任务的脚本、分镜、关键帧与规划摘要，作为后续文件中心与导出中心的入口。</p>
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
                {task.title} · {task.targetDurationSec}s · {task.planning?.generationRouteLabel ?? "待预判"}
              </option>
            ))}
          </select>
          <div className="planning-summary-card">
            <strong>{selectedTask?.planning?.generationRouteLabel ?? "待预判"}</strong>
            <span>{selectedTask?.planning?.planningSummary ?? "这里会展示 route、时长和规划策略的兼容摘要。"}</span>
            <div className="planning-summary-tags">
              <span className="pill pill--sm">{selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span>
              <span className="pill pill--sm">{selectedTask?.targetDurationSec ?? 0}s</span>
              {selectedTask?.actualDurationSec ? (
                <span className="pill pill--sm">实际 {selectedTask.actualDurationSec.toFixed(1)}s</span>
              ) : null}
            </div>
          </div>
          <div className="asset-metrics">
            {[
              { label: "资产总数", value: assets.length },
              { label: "可下载", value: assetStats.readyCount },
              { label: "可预览", value: assetStats.previewableCount },
              { label: "目录资产", value: assetStats.directoryCount },
            ].map((metric) => (
              <div key={metric.label} className="asset-metric-card">
                <div className="metric-label">{metric.label}</div>
                <strong className="metric-value">{metric.value}</strong>
              </div>
            ))}
          </div>
          {assetStats.missingCount ? (
            <div className="asset-missing-notice">
              {assetStats.missingCount} 个记录指向的文件当前不可访问，列表仍保留元数据以兼容历史资产。
            </div>
          ) : null}
          <div className="task-list">
            {assets.map((asset) => (
              <div key={asset.id} className="asset-item">
                <div className="asset-item-header">
                  <div>
                    <div className="asset-item-title">{asset.label}</div>
                    <div className="asset-item-tags">
                      <span className="pill pill--sm">{asset.assetType}</span>
                      <span className="pill pill--sm">
                        {asset.previewKind === "directory" ? "目录" : asset.previewKind === "json" ? "结构化预览" : asset.previewKind === "media" ? "媒体预览" : asset.previewKind === "text" ? "文本预览" : "二进制"}
                      </span>
                      <span className={asset.status === "ready" ? "status-text--success" : "status-text--warning"}>
                        {asset.status === "ready" ? "就绪" : "生成中"}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <strong>{asset.sizeLabel}</strong>
                    <div className="muted">{asset.modifiedAt ? new Date(asset.modifiedAt).toLocaleString("zh-CN") : new Date(asset.createdAt).toLocaleString("zh-CN")}</div>
                  </div>
                </div>
                <div className="asset-item-meta">
                  <div>
                    <div className="field-label" style={{ marginTop: 0 }}>文件名</div>
                    <div className="text-break">{asset.fileName}</div>
                  </div>
                  <div>
                    <div className="field-label" style={{ marginTop: 0 }}>存储位置</div>
                    <div className="text-break muted">{asset.displayPath}</div>
                  </div>
                  <div>
                    <div className="field-label" style={{ marginTop: 0 }}>预览信息</div>
                    <div className="muted">
                      {asset.previewable ? `浏览器内可直接打开 · ${asset.mimeType}` : `${asset.mimeType} · 仅支持下载`}
                    </div>
                  </div>
                  <div>
                    <div className="field-label" style={{ marginTop: 0 }}>目录</div>
                    <div className="muted">{asset.directoryName ?? "根目录"}</div>
                  </div>
                </div>
                <div className="asset-item-footer">
                  <div className="muted" style={{ fontSize: 13 }}>
                    {asset.exists ? "记录已绑定真实文件" : "该记录当前没有可访问的文件"}
                  </div>
                  <div className="asset-item-actions">
                    {asset.previewable ? (
                      <a
                        className="ghost-button"
                        href={buildAssetPreviewUrl(asset.taskId, asset.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        预览
                      </a>
                    ) : (
                      <span className="ghost-button" aria-disabled="true">
                        预览不可用
                      </span>
                    )}
                    <a className="primary-button" href={buildAssetDownloadUrl(asset.taskId, asset.id)} target="_blank" rel="noreferrer">
                      下载文件
                    </a>
                  </div>
                </div>
              </div>
            ))}
            {!assets.length ? (
              <div className="task-item">
                <div><strong>暂无资产</strong><span> · 先创建并执行任务</span></div>
                <div className="muted">资产中心会在生成后展示文件名、大小、预览状态和下载入口</div>
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
              <div className="task-item"><strong>规划摘要</strong><span>{selectedTask?.planning?.planningSummary ?? "待接入真实规划字段"}</span></div>
              <div className="task-item"><strong>文件导出</strong><span>脚本、SRT、图片、视频、成片</span></div>
              <div className="task-item"><strong>版本追踪</strong><span>按任务与 scene 做资产版本管理</span></div>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
