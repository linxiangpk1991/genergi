import { useEffect, useMemo, useState } from "react"
import {
  api,
  MODEL_CONTROL_SLOT_LABELS,
  type ModelDiagnosticRecord,
  type ModelQualitySummaryResponse,
} from "../api"
import { ModelControlNav } from "../features/model-control/toolkit"

const STATUS_LABELS: Record<ModelDiagnosticRecord["status"], string> = {
  success: "成功",
  failed: "失败",
  skipped: "跳过",
}

const SMOKE_MODE_LABELS: Record<ModelDiagnosticRecord["smokeMode"], string> = {
  config: "配置检查",
  connectivity: "连接检查",
  minimal_generation: "实际试用",
}

function formatDiagnosticTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString("zh-CN")
}

function describeDiagnosticTarget(record: ModelDiagnosticRecord) {
  return record.modelDisplayName ?? record.providerDisplayName
}

function describeErrorCategory(record: ModelDiagnosticRecord) {
  const category = record.errorCategory ?? ""
  if (record.status === "success") {
    return "正常"
  }
  if (!category) {
    return record.status === "skipped" ? "本次未检查" : "暂未分类"
  }

  if (/auth|credential|secret|key/i.test(category)) {
    return "密钥或权限问题"
  }
  if (/quota|balance|billing|credit/i.test(category)) {
    return "额度或余额问题"
  }
  if (/model|not_found/i.test(category)) {
    return "模型名称或权限问题"
  }
  if (/format|schema|request|compat/i.test(category)) {
    return "请求格式不匹配"
  }
  if (/timeout/i.test(category)) {
    return "响应超时"
  }
  if (/safety|policy|content/i.test(category)) {
    return "内容被拦截"
  }
  if (/empty|no_output/i.test(category)) {
    return "供应商没有返回结果"
  }
  return category
}

export function ModelDiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState<ModelDiagnosticRecord[]>([])
  const [qualitySummary, setQualitySummary] = useState<ModelQualitySummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | ModelDiagnosticRecord["status"]>("all")

  async function loadDiagnostics() {
    setLoading(true)
    setError("")
    try {
      const [result, qualityResult] = await Promise.all([
        api.listModelDiagnostics({ limit: 100 }),
        api.getModelQualitySummary({ limit: 100 }),
      ])
      setDiagnostics(result.diagnostics)
      setQualitySummary(qualityResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载诊断记录失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDiagnostics()
  }, [])

  const filteredDiagnostics = useMemo(() => {
    if (statusFilter === "all") {
      return diagnostics
    }
    return diagnostics.filter((record) => record.status === statusFilter)
  }, [diagnostics, statusFilter])

  const latestFailure = diagnostics.find((record) => record.status === "failed") ?? null

  return (
    <div className="workspace-page model-control-page">
      <div className="topbar">
        <div>
          <div className="eyebrow">模型设置</div>
          <h1>模型检查记录</h1>
          <p>这里记录每次检查结果。先看“哪里坏了”，需要排查时再看接口路径。</p>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={() => void loadDiagnostics()} type="button">
            刷新
          </button>
        </div>
      </div>

      <ModelControlNav />

      {error ? <div className="alert">{error}</div> : null}

      <section className="card">
        <div className="section-header">
          <div>
            <h2>最近质量问题</h2>
            <p className="section-note">
              运营驳回时标记的问题会汇总到这里，优先看次数高的模型和环节。
            </p>
          </div>
          <span className="pill">{qualitySummary ? `${qualitySummary.totalCount} 条` : "加载中"}</span>
        </div>
        {!qualitySummary || loading ? (
          <div className="empty-state">正在加载质量问题...</div>
        ) : qualitySummary.items.length === 0 ? (
          <div className="empty-state">最近还没有运营标记的质量问题。</div>
        ) : (
          <div className="model-quality-summary">
            {qualitySummary.items.map((item) => (
              <article
                className="model-quality-summary__item"
                key={`${item.slotType}-${item.modelId}-${item.issueCategory}`}
              >
                <div>
                  <strong>{item.modelDisplayName}</strong>
                  <span>{item.slotLabel || MODEL_CONTROL_SLOT_LABELS[item.slotType]}</span>
                </div>
                <code>{item.reasonLabel}</code>
                <span>{item.count} 次</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>调用记录</h2>
            <p className="section-note">最近 {filteredDiagnostics.length} 条记录。密钥和敏感地址不会显示明文。</p>
          </div>
          <select
            className="input model-diagnostics-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | ModelDiagnosticRecord["status"])}
          >
            <option value="all">全部状态</option>
            <option value="success">仅成功</option>
            <option value="failed">仅失败</option>
            <option value="skipped">仅跳过</option>
          </select>
        </div>

        {latestFailure ? (
          <div className="model-diagnostics-latest">
            <strong>最近失败</strong>
            <span>{describeDiagnosticTarget(latestFailure)}</span>
            <code>{describeErrorCategory(latestFailure)}</code>
            <span>{latestFailure.errorMessage ?? "暂无错误说明"}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="empty-state">正在加载诊断记录...</div>
        ) : filteredDiagnostics.length === 0 ? (
          <div className="empty-state">当前还没有模型检查记录。</div>
        ) : (
          <div className="table-wrap">
            <table className="model-diagnostics-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>目标</th>
                  <th>槽位</th>
                  <th>状态</th>
                  <th>接口路径</th>
                  <th>耗时</th>
                  <th>问题判断</th>
                </tr>
              </thead>
              <tbody>
                {filteredDiagnostics.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDiagnosticTime(record.createdAt)}</td>
                    <td>
                      <strong>{describeDiagnosticTarget(record)}</strong>
                      <small>{record.providerDisplayName}</small>
                    </td>
                    <td>{record.slotType ? MODEL_CONTROL_SLOT_LABELS[record.slotType] : "接入方"}</td>
                    <td>
                      <span className={`model-diagnostic-status model-diagnostic-status--${record.status}`}>
                        {STATUS_LABELS[record.status]}
                      </span>
                      <small>{SMOKE_MODE_LABELS[record.smokeMode]}</small>
                    </td>
                    <td>
                      <code>{record.wireApi}</code>
                      <small>{record.requestPath}</small>
                    </td>
                    <td>{record.durationMs}ms</td>
                    <td>
                      <code>{describeErrorCategory(record)}</code>
                      <small>{record.errorMessage ?? "无"}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
