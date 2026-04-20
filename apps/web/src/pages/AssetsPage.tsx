import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  api,
  buildAssetDownloadUrl,
  buildAssetPreviewUrl,
  buildBatchDashboardUrl,
  buildTaskReviewUrl,
  type AssetRecord,
  type RuntimeStatusResponse,
  type TaskSummary,
} from "../api"

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

function getTaskFlowLabel(task: TaskSummary | null) {
  if (!task) {
    return "待同步"
  }

  if (task.executionMode === "review_required" && task.blueprintStatus === "ready_for_review") {
    return `整任务待审 (蓝图 v${task.blueprintVersion})`
  }

  if (task.executionMode === "review_required" && task.blueprintStatus === "approved") {
    return `审核已通过，待继续执行 (蓝图 v${task.blueprintVersion})`
  }

  if (task.executionMode === "review_required" && task.blueprintStatus === "rejected") {
    return `蓝图已驳回 (蓝图 v${task.blueprintVersion})`
  }

  if (task.status === "completed") {
    return "任务已完成"
  }

  if (task.status === "failed") {
    return "任务失败"
  }

  if (task.status === "running") {
    return "生成进行中"
  }

  return "等待生成"
}

function sortAssetsForDelivery(assets: AssetRecord[]) {
  const priority: Record<AssetRecord["assetType"], number> = {
    video_bundle: 0,
    subtitles: 1,
    script: 2,
    audio: 3,
    source_script: 4,
    planning_prompt: 5,
    planning_response: 6,
    planning_audit: 7,
    storyboard: 8,
    keyframe_bundle: 9,
    keyframe_image: 10,
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
  const [searchParams, setSearchParams] = useSearchParams()
  const routeTaskId = searchParams.get("taskId") ?? ""

  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [runtime, setRuntime] = useState<RuntimeStatusResponse["runtime"] | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [previewAsset, setPreviewAsset] = useState<AssetRecord | null>(null)
  const [previewText, setPreviewText] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState("")
  const [lastRefreshAt, setLastRefreshAt] = useState<string>("")
  const [isStale, setIsStale] = useState(false)
  const [loadError, setLoadError] = useState("")

  function syncTaskContext(taskId?: string, replace = true) {
    const currentTaskId = searchParams.get("taskId") ?? ""
    const nextTaskId = taskId ?? ""

    if (currentTaskId === nextTaskId) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)

    if (taskId) {
      nextSearchParams.set("taskId", taskId)
    } else {
      nextSearchParams.delete("taskId")
    }

    setSearchParams(nextSearchParams, { replace })
  }

  useEffect(() => {
    async function load() {
      const [taskResult, runtimeResult] = await Promise.all([api.listTasks(), api.runtimeStatus()])
      setTasks(taskResult.tasks)
      setRuntime(runtimeResult.runtime)
      setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
      setIsStale(false)
      setLoadError("")
    }

    void load().catch(() => {
      setLoadError("任务或运行时状态加载失败，当前结果可能不完整。")
      setIsStale(true)
    })

    const timer = window.setInterval(() => {
      void Promise.all([api.listTasks(), api.runtimeStatus()])
        .then(([taskResult, runtimeResult]) => {
          setTasks(taskResult.tasks)
          setRuntime(runtimeResult.runtime)
          setLastRefreshAt(new Date().toLocaleTimeString("zh-CN"))
          setIsStale(false)
          setLoadError("")
        })
        .catch(() => {
          setIsStale(true)
          setLoadError("自动刷新失败，当前可能显示的是旧任务状态。")
        })
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!tasks.length) {
      setSelectedTaskId("")
      return
    }

    const nextTask = tasks.find((task) => task.id === routeTaskId) ?? tasks[0] ?? null
    if (nextTask && nextTask.id !== selectedTaskId) {
      setSelectedTaskId(nextTask.id)
    }
  }, [routeTaskId, selectedTaskId, tasks])

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
      setLoadError("")
    }

    void loadAssets().catch(() => {
      setAssets([])
      setIsStale(true)
      setLoadError("资产列表加载失败，当前无法确认交付物完整性。")
    })

    const timer = window.setInterval(() => {
      void loadAssets().catch(() => {
        setAssets([])
        setIsStale(true)
        setLoadError("资产自动刷新失败，当前可能显示的是旧结果。")
      })
    }, 5000)

    return () => window.clearInterval(timer)
  }, [selectedTaskId])

  useEffect(() => {
    if (!selectedTaskId) {
      return
    }

    syncTaskContext(selectedTaskId, true)
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

  useEffect(() => {
    if (previewAsset && !assets.some((asset) => asset.id === previewAsset.id)) {
      setPreviewAsset(null)
      setPreviewText("")
      setPreviewError("")
      setPreviewLoading(false)
    }
  }, [assets, previewAsset])

  async function openInlinePreview(asset: AssetRecord) {
    setPreviewAsset(asset)
    setPreviewError("")

    if (asset.previewKind === "text" || asset.previewKind === "json") {
      setPreviewLoading(true)
      try {
        const response = await fetch(buildAssetPreviewUrl(asset.taskId, asset.id))
        const content = await response.text()
        if (!response.ok) {
          throw new Error(content || `预览失败 (${response.status})`)
        }

        if (asset.previewKind === "json") {
          try {
            setPreviewText(JSON.stringify(JSON.parse(content), null, 2))
          } catch {
            setPreviewText(content)
          }
        } else {
          setPreviewText(content)
        }
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : "文本预览加载失败")
        setPreviewText("")
      } finally {
        setPreviewLoading(false)
      }
      return
    }

    setPreviewLoading(false)
    setPreviewText("")
  }

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
                    <button
                      className="ghost-button"
                      onClick={() => void openInlinePreview(asset)}
                      type="button"
                    >
                      预览
                    </button>
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
          <select
            className="input"
            value={selectedTaskId}
            onChange={(event) => {
              setSelectedTaskId(event.target.value)
              syncTaskContext(event.target.value, false)
            }}
          >
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

          <div className="route-context-card">
            <strong>当前任务已写入链接</strong>
            <span>
              {selectedTaskId
                ? `任务 ${selectedTaskId} 已同步到 URL，可直接收藏这个资产视角，再从侧栏回到对应处理页。`
                : "选择任务后，地址会自动同步当前资产上下文。"}
            </span>
          </div>

          <div className="muted" style={{ marginBottom: 12 }}>
            最近刷新：{lastRefreshAt || "刚刚进入页面"}{isStale ? " · 当前可能显示的是旧数据" : ""}
          </div>
          {loadError ? (
            <div className="review-inline-note review-inline-note--danger" role="alert">
              {loadError}
            </div>
          ) : null}

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
              <div className="metric-label">当前链路</div>
              <strong className="metric-value">{getTaskFlowLabel(selectedTask)}</strong>
            </div>
          </div>

          {assetStats.missingCount ? (
            <div className="asset-missing-notice">
              {assetStats.missingCount} 个记录指向的文件当前不可访问，列表仍保留元数据以兼容历史资产。
            </div>
          ) : null}

          {previewAsset ? (
            <section className="planning-summary-card">
              <div className="section-header">
                <div>
                  <strong>页内预览</strong>
                  <div className="muted">{previewAsset.label} · {previewAsset.fileName}</div>
                </div>
                <button
                  className="ghost-button"
                  onClick={() => {
                    setPreviewAsset(null)
                    setPreviewText("")
                    setPreviewError("")
                    setPreviewLoading(false)
                  }}
                  type="button"
                >
                  关闭预览
                </button>
              </div>
              {previewLoading ? <div className="muted">正在加载预览...</div> : null}
              {previewError ? <div className="review-inline-note review-inline-note--danger">{previewError}</div> : null}
              {!previewLoading && !previewError && (previewAsset.previewKind === "text" || previewAsset.previewKind === "json") ? (
                <pre className="review-content" style={{ whiteSpace: "pre-wrap", maxHeight: 420, overflow: "auto" }}>{previewText}</pre>
              ) : null}
              {!previewLoading && !previewError && previewAsset.mimeType.startsWith("image/") ? (
                <img
                  alt={previewAsset.label}
                  className="visual-preview__image"
                  src={buildAssetPreviewUrl(previewAsset.taskId, previewAsset.id)}
                />
              ) : null}
              {!previewLoading && !previewError && previewAsset.mimeType.startsWith("video/") ? (
                <video
                  controls
                  className="visual-preview__image"
                  src={buildAssetPreviewUrl(previewAsset.taskId, previewAsset.id)}
                />
              ) : null}
              {!previewLoading && !previewError && previewAsset.mimeType.startsWith("audio/") ? (
                <audio
                  controls
                  style={{ width: "100%" }}
                  src={buildAssetPreviewUrl(previewAsset.taskId, previewAsset.id)}
                />
              ) : null}
            </section>
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
            <h3>当前处理入口</h3>
            <div className="task-list compact-list">
              <div className="task-item">
                <strong>{getTaskFlowLabel(selectedTask)}</strong>
                <span>资产排查完成后，直接回到当前任务真正需要处理的唯一主工作台。</span>
                <div className="task-item__actions">
                  {selectedTask?.executionMode === "review_required" &&
                  (selectedTask.blueprintStatus === "ready_for_review" ||
                    selectedTask.blueprintStatus === "approved" ||
                    selectedTask.blueprintStatus === "rejected") ? (
                    <Link className="primary-button" to={buildTaskReviewUrl(selectedTask)}>
                      进入任务审核
                    </Link>
                  ) : (
                    <Link className="primary-button" to={buildBatchDashboardUrl(selectedTaskId || undefined)}>
                      返回生产看板
                    </Link>
                  )}
                  <Link className="ghost-button" to={buildBatchDashboardUrl(selectedTaskId || undefined)}>
                    打开任务在看板中的位置
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>规划依据</h3>
            <div className="task-list compact-list">
              {selectedTask?.status === "failed" && selectedTask?.failureReason ? (
                <div className="task-item"><strong>失败原因</strong><span>{selectedTask.failureReason}</span></div>
              ) : null}
              <div className="task-item"><strong>分镜路由依据</strong><span>{selectedTask?.routeReason ?? "待接入"}</span></div>
              <div className="task-item"><strong>内容策略</strong><span>{selectedTask?.planning?.generationPreferenceLabel ?? "待接入"}</span></div>
              <div className="task-item"><strong>当前链路</strong><span>{getTaskFlowLabel(selectedTask)}</span></div>
              <div className="task-item"><strong>可预览资产</strong><span>{assetStats.previewableCount} 个</span></div>
              <div className="task-item"><strong>已就绪资产</strong><span>{assetStats.readyCount} 个</span></div>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
