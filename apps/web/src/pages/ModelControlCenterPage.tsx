import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  api,
  MODEL_CONTROL_MODE_LABELS,
  MODEL_CONTROL_SLOT_LABELS,
  MODEL_CONTROL_SLOT_ORDER,
  type ModelControlDefaults,
  type ModelRegistryRecord,
  type ProviderRegistryRecord,
} from "../api"

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

function ModelControlNav() {
  const location = useLocation()

  const navItems = [
    { to: "/model-control-center", label: "总览" },
    { to: "/model-control-center/providers", label: "Provider 管理" },
    { to: "/model-control-center/registry", label: "Model Registry" },
    { to: "/model-control-center/defaults", label: "Defaults Center" },
  ]

  return (
    <div className="model-control-nav">
      {navItems.map((item) => {
        const isActive =
          item.to === "/model-control-center"
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to)

        return (
          <Link
            key={item.to}
            className={isActive ? "model-control-nav__item model-control-nav__item--active" : "model-control-nav__item"}
            to={item.to}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}

function getDefaultSelection(
  defaults: ModelControlDefaults | null,
  modeId: keyof typeof MODEL_CONTROL_MODE_LABELS,
  slot: keyof typeof MODEL_CONTROL_SLOT_LABELS,
) {
  return defaults?.modes?.[modeId]?.[slot] ?? defaults?.global?.[slot] ?? null
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
    return <div className="empty-state">模型控制中心正在加载真实配置...</div>
  }

  return (
    <div className="workspace-page">
      <section className="card">
        <div className="section-header section-header--stack">
          <div>
            <div className="eyebrow">Model Control Plane</div>
            <h2>模型控制中心</h2>
            <p className="section-note">
              这里管理真实 provider、真实可选模型、全局默认值与模式默认值。任务发起页只能从这里通过验证的池子里选择。
            </p>
          </div>
          <div className="planning-summary-tags">
            <span className="pill pill--sm">六个槽位统一管控</span>
            <span className="pill pill--sm">任务覆盖 &gt; 模式默认 &gt; 全局默认</span>
          </div>
        </div>

        <ModelControlNav />

        {error ? (
          <div className="alert" style={{ marginTop: 14 }}>
            模型控制面 API 当前未就绪或返回异常：{error}
          </div>
        ) : null}

        <div className="model-control-hero">
          <div className="model-control-hero__copy">
            <span className="eyebrow">唯一控制面</span>
            <h3>把 Provider、Model、默认值和任务覆盖统一到同一条真实链路里。</h3>
            <p>
              运营看到的是可操作的控制台，工程拿到的是可验证、可冻结、可追溯的运行配置。
            </p>
          </div>
          <div className="model-control-hero__rail">
            <div className="hero-rail-card">
              <strong>先校验，再入池</strong>
              <span>草稿和失效项不会进入任务级高级覆盖。</span>
            </div>
            <div className="hero-rail-card">
              <strong>创建后即冻结</strong>
              <span>历史任务不会被后续默认值变化反向污染。</span>
            </div>
          </div>
        </div>

        <div className="model-control-section-label">
          <strong>控制面健康</strong>
          <span>先看当前可用能力，再进入具体配置页面。</span>
        </div>

        <div className="model-control-metrics">
          <div className="stat-card">
            <span>可用 Provider</span>
            <strong>{providerSummary.available}</strong>
            <small>校验通过后才会进入可选池</small>
          </div>
          <div className="stat-card">
            <span>校验中 Provider</span>
            <strong>{providerSummary.validating}</strong>
            <small>等待真实连通性与鉴权结果</small>
          </div>
          <div className="stat-card">
            <span>可用模型记录</span>
            <strong>{modelSummary.available}</strong>
            <small>仅 `available` 才能在任务页覆盖</small>
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
        <span>按运营顺序进入具体配置，而不是先翻一整页信息。</span>
      </div>
      <section className="model-control-link-grid">
        <Link className="card model-control-link-card" to="/model-control-center/providers">
          <div className="eyebrow">Step 1</div>
          <h3>Provider 管理</h3>
          <p>维护 endpoint、鉴权方式、密钥状态和最近一次校验结果。</p>
          <div className="planning-inline">
            <span className={getStatusClass("available")}>{providerSummary.available} 可用</span>
            <span className={getStatusClass("invalid")}>{providerSummary.invalid} 异常</span>
            <span className={getStatusClass("disabled")}>{providerSummary.disabled} 已禁用</span>
          </div>
        </Link>

        <Link className="card model-control-link-card" to="/model-control-center/registry">
          <div className="eyebrow">Step 2</div>
          <h3>Model Registry</h3>
          <p>为六个槽位分别登记可运行模型，并记录能力元数据和绑定的 provider。</p>
          <div className="planning-inline">
            <span className={getStatusClass("available")}>{modelSummary.available} 可用</span>
            <span className={getStatusClass("validating")}>{modelSummary.validating} 校验中</span>
            <span className={getStatusClass("deprecated")}>{modelSummary.deprecated} 已弃用</span>
          </div>
        </Link>

        <Link className="card model-control-link-card" to="/model-control-center/defaults">
          <div className="eyebrow">Step 3</div>
          <h3>Defaults Center</h3>
          <p>设置全局默认值和模式默认值，并明确告诉运营最终生效的是哪一层。</p>
          <div className="planning-inline">
            <span className="pill pill--sm">量产模式</span>
            <span className="pill pill--sm">高质量模式</span>
          </div>
        </Link>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>优先级规则</h2>
          <span className="muted">任务创建时会把最终解析结果冻结进 taskRunConfig</span>
        </div>
        <div className="precedence-strip">
          <div className="planning-note-card">
            <strong>1. 全局默认</strong>
            <span>给所有模式提供兜底选择。只有当模式层和任务层都没有指定时才生效。</span>
          </div>
          <div className="planning-note-card">
            <strong>2. 模式默认</strong>
            <span>给 `量产模式` / `高质量模式` 提供更贴近业务目标的默认组合，会覆盖全局默认。</span>
          </div>
          <div className="planning-note-card">
            <strong>3. 任务临时覆盖</strong>
            <span>仅在任务发起时从可选池挑选单次覆盖项，优先级最高，但只影响当前任务。</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>六槽位覆盖现状</h2>
          <span className="muted">下面显示每个模式当前会落到哪条默认链路</span>
        </div>
        <div className="summary-list">
          {MODEL_CONTROL_SLOT_ORDER.map((slot) => (
            <div key={slot} className="summary-row">
              <strong>{MODEL_CONTROL_SLOT_LABELS[slot]}</strong>
              <div className="summary-row__detail">
                <span>
                  全局默认：
                  {defaults?.global?.[slot]?.displayName
                    ? `${defaults.global[slot]?.displayName} / ${defaults.global[slot]?.providerDisplayName ?? "未标注 provider"}`
                    : "未设置"}
                </span>
                {Object.entries(MODEL_CONTROL_MODE_LABELS).map(([modeId, label]) => {
                  const selection = getDefaultSelection(defaults, modeId as keyof typeof MODEL_CONTROL_MODE_LABELS, slot)
                  return (
                    <span key={modeId}>
                      {label}：
                      {selection?.displayName
                        ? `${selection.displayName} / ${selection.providerDisplayName ?? "未标注 provider"}`
                        : "未设置"}
                    </span>
                  )
                })}
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
            <h3>最近 Provider 校验</h3>
            <span className="muted">按更新时间展示</span>
          </div>
          <div className="task-list compact-list">
            {recentProviders.map((provider) => (
              <div key={provider.id} className="task-item">
                <strong>{provider.displayName}</strong>
                <span>
                  {provider.providerType} · {provider.endpointUrl || "未填 endpoint"}
                </span>
                <span>
                  状态 {provider.status} · 最近校验 {formatDateTime(provider.lastValidatedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-header">
            <h3>最近模型变更</h3>
            <span className="muted">查看 slot 绑定和能力元数据是否完整</span>
          </div>
          <div className="task-list compact-list">
            {recentModels.map((model) => (
              <div key={model.id} className="task-item">
                <strong>{model.displayName}</strong>
                <span>
                  {MODEL_CONTROL_SLOT_LABELS[model.slotType]} · {model.providerDisplayName ?? model.providerId}
                </span>
                <span>
                  状态 {model.lifecycleStatus} · 最近校验 {formatDateTime(model.lastValidatedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
