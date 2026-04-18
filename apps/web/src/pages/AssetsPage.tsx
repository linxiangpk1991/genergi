import { useEffect, useMemo, useState } from "react"
import { api, buildAssetDownloadUrl, buildAssetPreviewUrl, type AssetRecord, type RuntimeStatusResponse, type TaskSummary } from "../api"

function getDurationDelta(task: TaskSummary | null) {
  if (!task || task.actualDurationSec == null) {
    return null
  }

  return task.actualDurationSec - task.targetDurationSec
}

function getToleranceLabel(delta: number | null) {
  if (delta == null) {
    return "待成片"
  }

  if (Math.abs(delta) <= 2) {
    return "容差内"
  }

  return "需复核"
}

function getReviewStageLabel(task: TaskSummary | null) {
  if (!task?.reviewStage) {
    return "待同步"
  }

  if (task.reviewStage === "storyboard_review") {
    return `待审分镜 (${task.pendingReviewCount ?? 0})`
  }

  if (task.reviewStage === "keyframe_review") {
    return `待审关键帧 (${task.pendingReviewCount ?? 0})`
  }

  return "自动 QA"
}

function sortAssetsForDelivery(assets: AssetRecord[]) {
  const priority: Record<AssetRecord["assetType"], number> = {
    video_bundle: 0,
    subtitles: 1,
    script: 2,
    audio: 3,
    storyboard: 4,
    keyframe_bundle: 5,
  }

  return [...assets].sort((left, right) => {
    const priorityDiff = priority[left.assetType] - priority[right.assetType]
    if (priorityDiff !== 0) {
      return priorityDiff
    }
    return left.label.localeCompare(right.label, "zh-CN")
  })
}

export function AssetsPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [runtime, setRuntime] = useState<RuntimeStatusResponse["runtime"] | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [lastRefreshAt, setLastRefreshAt] = useState<string>("")
  const [isStale, setIsStale] = useState(false)

  useEffect(() => {
    async function load() {
      const [taskResult, runtimeResult] = await Promise.all([api.listTasks(), api.runtimeStatus()])
      setTasks(taskResult.tasks)
      setRuntime(runtimeResult.runtime)
      setSelectedTaskId((current) => current || taskResult.tasks[0]?.id || "")
      setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
      setIsStale(false)
    }

    void load().catch(() => {})

    const timer = window.setInterval(() => {
      void Promise.all([api.listTasks(), api.runtimeStatus()])
        .then(([taskResult, runtimeResult]) => {
          setTasks(taskResult.tasks)
          setRuntime(runtimeResult.runtime)
          setSelectedTaskId((current) => current || taskResult.tasks[0]?.id || "")
          setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
          setIsStale(false)
        })
        .catch(() => setIsStale(true))
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
      setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
      setIsStale(false)
    }

    void loadAssets().catch(() => {
      setAssets([])
      setIsStale(true)
    })

    const timer = window.setInterval(() => {
      void loadAssets().catch(() => {
        setAssets([])
        setIsStale(true)
      })
    }, 5000)

    return () => window.clearInterval(timer)
  }, [selectedTaskId])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  )

  const assetStats = useMemo(() => {
    const readyCount = assets.filter((asset) => asset.status === "ready").length
    const previewableCount = assets.filter((asset) => asset.previewable).length
    const missingCount = assets.filter((asset) => !asset.exists).length
    const deliverables = assets.filter((asset) => ["video_bundle", "subtitles", "script", "audio"].includes(asset.assetType))
    const deliverableReadyCount = deliverables.filter((asset) => asset.status === "ready").length

    return {
      readyCount,
      previewableCount,
      missingCount,
      deliverableReadyCount,
      deliverableTotal: deliverables.length,
    }
  }, [assets])

  const durationDelta = useMemo(() => getDurationDelta(selectedTask), [selectedTask])
  const durationDeltaLabel = durationDelta == null ? "待成片" : `${durationDelta > 0 ? "+" : ""}${durationDelta.toFixed(1)}s`
  const toleranceLabel = getToleranceLabel(durationDelta)
  const sortedAssets = useMemo(() => sortAssetsForDelivery(assets), [assets])
  const deliverableAssets = sortedAssets.filter((asset) => ["video_bundle", "subtitles", "script", "audio"].includes(asset.assetType))
  const supportingAssets = sortedAssets.filter((asset) => !["video_bundle", "subtitles", "script", "audio"].includes(asset.assetType))

  function renderAssetList(title: string, description: string, items: AssetRecord[]) {
    return (
      <section className="asset-section">
        <div className="section-header">
          <div>
            <h3>{title}</h3>
            <div className="muted">{description}</div>
          </div>
        </div>
        <div className="task-list">
          {items.map((asset) => (
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
          {!items.length ? (
            <div className="task-item">
              <div><strong>当前暂无记录</strong><span> · 等待任务继续产出</span></div>
              <div className="muted">任务一旦进入下一阶段，这里会自动刷新。</div>
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Asset Center</div>
          <h1>素材资产中心</h1>
          <p>先看最终交付物是否达标，再回头检查脚本、字幕、关键帧和中间产物有没有偏掉。</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">{selectedTask?.planning?.generationRouteLabel ?? "待预判"}</span>
          <span className="pill pill--accent">{selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span>
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
            <span>{selectedTask?.planning?.planningSummary ?? "这里会展示 route、时长和生成方式的真实摘要。"}</span>
            <div className="planning-summary-tags">
              <span className="pill pill--sm">{selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span>
              <span className="pill pill--sm">目标 {selectedTask?.targetDurationSec ?? 0}s</span>
              {selectedTask?.actualDurationSec ? (
                <span className="pill pill--sm">实际 {selectedTask.actualDurationSec.toFixed(1)}s</span>
              ) : null}
            </div>
          </div>
          <div className="muted" style={{ marginBottom: 12 }}>
            最近刷新：{lastRefreshAt || "刚刚进入页面"}{isStale ? " · 当前可能显示的是旧数据" : ""}
          </div>

          <div className="asset-metrics">
            <div className="asset-metric-card">
              <div className="metric-label">目标时长</div>
              <strong className="metric-value">{selectedTask?.targetDurationSec ?? "--"}s</strong>
            </div>
            <div className="asset-metric-card">
              <div className="metric-label">实际时长</div>
              <strong className="metric-value">{selectedTask?.actualDurationSec ? `${selectedTask.actualDurationSec.toFixed(1)}s` : "--"}</strong>
            </div>
            <div className="asset-metric-card">
              <div className="metric-label">偏差</div>
              <strong className="metric-value">{durationDeltaLabel}</strong>
            </div>
            <div className="asset-metric-card">
              <div className="metric-label">容差判断</div>
              <strong className="metric-value">{toleranceLabel}</strong>
            </div>
            <div className="asset-metric-card">
              <div className="metric-label">交付就绪度</div>
              <strong className="metric-value">{assetStats.deliverableReadyCount}/{assetStats.deliverableTotal || 0}</strong>
            </div>
            <div className="asset-metric-card">
              <div className="metric-label">审阅阶段</div>
              <strong className="metric-value">{getReviewStageLabel(selectedTask)}</strong>
            </div>
          </div>

          {assetStats.missingCount ? (
            <div className="asset-missing-notice">
              {assetStats.missingCount} 个记录指向的文件当前不可访问，列表仍保留元数据以兼容历史资产。
            </div>
          ) : null}

          {renderAssetList("最终交付物", "优先确认成片、字幕、脚本和音频是否已经齐全。", deliverableAssets)}
          {renderAssetList("规划与中间资产", "用于排查生成过程和回溯中间阶段，不应和最终交付物混读。", supportingAssets)}
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
            <h3>规划依据</h3>
            <div className="task-list compact-list">
              <div className="task-item"><strong>路由原因</strong><span>{selectedTask?.routeReason ?? "待接入"}</span></div>
              <div className="task-item"><strong>内容策略</strong><span>{selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span></div>
              <div className="task-item"><strong>审阅状态</strong><span>{getReviewStageLabel(selectedTask)}</span></div>
              <div className="task-item"><strong>可预览资产</strong><span>{assetStats.previewableCount} 个</span></div>
              <div className="task-item"><strong>已就绪资产</strong><span>{assetStats.readyCount} 个</span></div>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
