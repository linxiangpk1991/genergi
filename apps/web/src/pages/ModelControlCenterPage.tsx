import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  api,
  MODEL_CONTROL_SLOT_LABELS,
  MODEL_CONTROL_SLOT_ORDER,
  type ModelControlDefaults,
  type ModelControlModeId,
  type ModelRegistryRecord,
  type ProviderRegistryRecord,
} from "../api"
import { formatProviderType, getModelCallProfile } from "../lib/model-control-display"
import { ModelControlNav } from "../features/model-control/toolkit"

const ACTIVE_TASK_CREATION_MODE: ModelControlModeId = "high_quality"

function formatDateTime(value?: string | null) {
  if (!value) {
    return "尚未记录"
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString("zh-CN")
}

function getStatusClass(status: string) {
  return `status-badge status-badge--${status}`
}

function getLifecycleStatusLabel(status: string) {
  switch (status) {
    case "draft":
      return "未检查"
    case "validating":
      return "检查中"
    case "available":
      return "可用"
    case "invalid":
      return "异常"
    case "disabled":
      return "已停用"
    case "deprecated":
      return "已弃用"
    default:
      return status
  }
}

function getDefaultSelection(
  defaults: ModelControlDefaults | null,
  slot: keyof typeof MODEL_CONTROL_SLOT_LABELS,
) {
  return defaults?.modes?.[ACTIVE_TASK_CREATION_MODE]?.[slot] ?? defaults?.global?.[slot] ?? null
}

export function ModelControlCenterPage() {
  const [providers, setProviders] = useState<ProviderRegistryRecord[]>([])
  const [models, setModels] = useState<ModelRegistryRecord[]>([])
  const [defaults, setDefaults] = useState<ModelControlDefaults | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError("")

      try {
        const [providerResponse, modelResponse, defaultsResponse] = await Promise.all([
          api.listModelProviders(),
          api.listModelRegistry(),
          api.getModelDefaults(),
        ])

        setProviders(providerResponse.providers)
        setModels(modelResponse.models)
        setDefaults(defaultsResponse)
      } catch (err) {
        setError(err instanceof Error ? err.message : "模型控制中心加载失败")
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  const providerSummary = useMemo(() => {
    const available = providers.filter((item) => item.status === "available").length
    const validating = providers.filter((item) => item.status === "validating").length
    const invalid = providers.filter((item) => item.status === "invalid").length
    const disabled = providers.filter((item) => item.status === "disabled").length
    return { available, validating, invalid, disabled }
  }, [providers])

  const modelSummary = useMemo(() => {
    const available = models.filter((item) => item.lifecycleStatus === "available").length
    const validating = models.filter((item) => item.lifecycleStatus === "validating").length
    const invalid = models.filter((item) => item.lifecycleStatus === "invalid").length
    const deprecated = models.filter((item) => item.lifecycleStatus === "deprecated").length
    return { available, validating, invalid, deprecated }
  }, [models])

  const recentProviders = useMemo(
    () =>
      [...providers].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")).slice(0, 4),
    [providers],
  )

  const recentModels = useMemo(
    () =>
      [...models].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")).slice(0, 4),
    [models],
  )

  if (loading) {
    return <div className="empty-state">模型设置正在加载真实配置...</div>
  }

  return (
    <div className="workspace-page">
      <section className="card">
        <div className="section-header section-header--stack">
          <div>
            <div className="eyebrow">模型设置</div>
            <h2>模型设置</h2>
            <p className="section-note">
              管理模型接入方、可用模型、新任务默认使用的模型。
            </p>
          </div>
          <div className="planning-summary-tags">
            <span className="pill pill--sm">文案 / 图片 / 视频 / 配音</span>
            <span className="pill pill--sm">任务设置 &gt; 新任务默认 &gt; 全局兜底</span>
          </div>
        </div>

        <ModelControlNav />

        {error ? (
          <div className="alert" style={{ marginTop: 14 }}>
            模型设置服务当前未就绪或返回异常：{error}
          </div>
        ) : null}

        <div className="model-control-hero">
          <div className="model-control-hero__copy">
            <span className="eyebrow">配置概览</span>
            <h3>先看当前可用能力，再进入具体配置。</h3>
            <p>
              这里汇总当前可用接入方、可用模型、默认模型和最近变更。
            </p>
          </div>
          <div className="model-control-hero__rail">
            <div className="hero-rail-card">
              <strong>先校验，再入池</strong>
              <span>只有可用记录会出现在默认值选择列表里。</span>
            </div>
            <div className="hero-rail-card">
              <strong>提交后固定</strong>
              <span>任务创建时会固定当时生效的模型组合。</span>
            </div>
          </div>
        </div>

        <div className="model-control-section-label">
          <strong>配置健康度</strong>
          <span>先看当前可用能力，再进入具体配置页面。</span>
        </div>

        <div className="model-control-metrics">
          <div className="stat-card">
            <span>可用接入方</span>
            <strong>{providerSummary.available}</strong>
            <small>校验通过后才会进入可选池</small>
          </div>
          <div className="stat-card">
            <span>校验中接入方</span>
            <strong>{providerSummary.validating}</strong>
            <small>等待真实连通性与鉴权结果</small>
          </div>
          <div className="stat-card">
            <span>可用模型</span>
            <strong>{modelSummary.available}</strong>
            <small>检查通过后才会进入默认模型选择列表</small>
          </div>
          <div className="stat-card">
            <span>异常 / 已弃用</span>
            <strong>{providerSummary.invalid + modelSummary.invalid + modelSummary.deprecated}</strong>
            <small>需要运营或工程处理后再恢复</small>
          </div>
        </div>
      </section>

      <div className="model-control-section-label">
        <strong>常用操作路径</strong>
        <span>先处理接入方，再维护模型清单，最后调整默认模型。</span>
      </div>
      <section className="model-control-link-grid">
        <Link className="card model-control-link-card" to="/model-control-center/providers">
          <div className="eyebrow">Step 1</div>
          <h3>接入方管理</h3>
          <p>维护接口地址、鉴权方式、密钥状态和最近一次校验结果。</p>
          <div className="planning-inline">
            <span className={getStatusClass("available")}>{providerSummary.available} 可用</span>
            <span className={getStatusClass("invalid")}>{providerSummary.invalid} 异常</span>
            <span className={getStatusClass("disabled")}>{providerSummary.disabled} 已禁用</span>
          </div>
        </Link>

        <Link className="card model-control-link-card" to="/model-control-center/registry">
          <div className="eyebrow">Step 2</div>
          <h3>模型列表</h3>
          <p>为文案、图片、视频、配音登记可运行模型，并记录能力说明和绑定的接入方。</p>
          <div className="planning-inline">
            <span className={getStatusClass("available")}>{modelSummary.available} 可用</span>
            <span className={getStatusClass("validating")}>{modelSummary.validating} 校验中</span>
            <span className={getStatusClass("deprecated")}>{modelSummary.deprecated} 已弃用</span>
          </div>
        </Link>

        <Link className="card model-control-link-card" to="/model-control-center/defaults">
          <div className="eyebrow">Step 3</div>
          <h3>默认模型</h3>
          <p>设置全局兜底和新任务默认模型，让运营知道新任务会用哪套组合。</p>
          <div className="planning-inline">
            <span className="pill pill--sm">单一路径</span>
            <span className="pill pill--sm">提交后固定</span>
          </div>
        </Link>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>优先级规则</h2>
          <span className="muted">任务创建时会把最终生效的模型组合固定下来</span>
        </div>
        <div className="precedence-strip">
          <div className="planning-note-card">
            <strong>1. 全局默认</strong>
            <span>给单一路径任务创建提供兜底选择。只有任务创建默认值没有指定时才会生效。</span>
          </div>
          <div className="planning-note-card">
            <strong>2. 任务创建默认值</strong>
            <span>这套默认值就是新任务真正会使用的模型组合，会覆盖全局兜底。</span>
          </div>
          <div className="planning-note-card">
            <strong>3. 任务固定设置</strong>
            <span>任务创建时会把当下生效的模型组合固定下来，之后历史任务不再跟随后续默认值变化。</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>当前默认模型</h2>
          <span className="muted">按单一路径任务创建查看当前默认组合。</span>
        </div>
        <div className="summary-list">
          {MODEL_CONTROL_SLOT_ORDER.map((slot) => (
            <div key={slot} className="summary-row">
              <strong>{MODEL_CONTROL_SLOT_LABELS[slot]}</strong>
              <div className="summary-row__detail">
                <span>
                  全局兜底：
                  {defaults?.global?.[slot]?.displayName
                    ? `${defaults.global[slot]?.displayName} / ${defaults.global[slot]?.providerDisplayName ?? "未标注 provider"}`
                    : "未设置"}
                </span>
                <span>
                  新任务默认：
                  {getDefaultSelection(defaults, slot)?.displayName
                    ? `${getDefaultSelection(defaults, slot)?.displayName} / ${getDefaultSelection(defaults, slot)?.providerDisplayName ?? "未标注 provider"}`
                    : "未设置"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="model-control-section-label">
        <strong>最近变更窗口</strong>
        <span>用来确认谁是最近被校验、最近被调整的记录。</span>
      </div>
      <section className="model-control-link-grid">
        <div className="card">
          <div className="section-header">
          <h3>最近接入方校验</h3>
            <span className="muted">按更新时间展示</span>
          </div>
          <div className="task-list compact-list">
            {recentProviders.map((provider) => (
              <div key={provider.id} className="task-item">
                <strong>{provider.displayName}</strong>
                <span>
                  {formatProviderType(provider.providerType)} · {provider.endpointUrl || "未填接口地址"}
                </span>
                <span>
                  状态 {getLifecycleStatusLabel(provider.status)} · 最近校验 {formatDateTime(provider.lastValidatedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-header">
            <h3>最近模型变更</h3>
            <span className="muted">查看用途绑定和能力说明是否完整</span>
          </div>
          <div className="task-list compact-list">
            {recentModels.map((model) => (
              <div key={model.id} className="task-item">
                <strong>{model.displayName}</strong>
                <span>
                  {MODEL_CONTROL_SLOT_LABELS[model.slotType]} · {model.providerDisplayName ?? model.providerId}
                </span>
                <span>
                  调用方式：{getModelCallProfile(model).label} · {getModelCallProfile(model).endpoint}
                </span>
                <span>
                  状态 {getLifecycleStatusLabel(model.lifecycleStatus)} · 最近校验 {formatDateTime(model.lastValidatedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
