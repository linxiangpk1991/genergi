import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  api,
  type CreateModelProviderPayload,
  type ModelControlLifecycleStatus,
  type ProviderAuthType,
  type ProviderRegistryRecord,
} from "../api"

const emptyForm: CreateModelProviderPayload = {
  providerKey: "",
  providerType: "openai-compatible",
  displayName: "",
  endpointUrl: "",
  authType: "bearer_token",
  secret: "",
  status: "draft",
}

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

function getStatusClass(status: ModelControlLifecycleStatus) {
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

export function ModelProvidersPage() {
  const [providers, setProviders] = useState<ProviderRegistryRecord[]>([])
  const [form, setForm] = useState<CreateModelProviderPayload>(emptyForm)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionProviderId, setActionProviderId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  async function loadProviders() {
    setLoading(true)
    setError("")

    try {
      const response = await api.listModelProviders()
      setProviders(response.providers)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider 列表加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProviders()
  }, [])

  function resetForm() {
    setForm(emptyForm)
    setEditingProviderId(null)
  }

  function startEdit(provider: ProviderRegistryRecord) {
    setEditingProviderId(provider.id)
    setForm({
      providerKey: provider.providerKey,
      providerType: provider.providerType,
      displayName: provider.displayName,
      endpointUrl: provider.endpointUrl,
      authType: provider.authType,
      secret: "",
      status: provider.status,
    })
    setNotice("")
    setError("")
  }

  async function handleSubmit() {
    if (!form.providerKey.trim() || !form.displayName.trim() || !form.providerType.trim() || !form.authType.trim()) {
      setError("请先填写 providerKey、显示名、Provider 类型和鉴权方式")
      return
    }

    setSaving(true)
    setError("")
    setNotice("")

    try {
      if (editingProviderId) {
        const payload = {
          providerKey: form.providerKey.trim(),
          providerType: form.providerType.trim(),
          displayName: form.displayName.trim(),
          endpointUrl: form.endpointUrl.trim(),
          authType: form.authType.trim() as ProviderAuthType,
          status: form.status,
          ...(form.secret?.trim() ? { secret: form.secret.trim() } : {}),
        }

        await api.updateModelProvider(editingProviderId, payload)
        setNotice("Provider 已更新。若改了 endpoint 或密钥，请重新校验。")
      } else {
        await api.createModelProvider({
          providerKey: form.providerKey.trim(),
          providerType: form.providerType.trim(),
          displayName: form.displayName.trim(),
          endpointUrl: form.endpointUrl.trim(),
          authType: form.authType.trim() as ProviderAuthType,
          secret: form.secret?.trim() || undefined,
          status: form.status,
        })
        setNotice("Provider 已创建。下一步请执行真实校验。")
      }

      resetForm()
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存 Provider 失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleValidate(providerId: string) {
    setActionProviderId(providerId)
    setError("")
    setNotice("")

    try {
      await api.validateModelProvider(providerId)
      setNotice("已触发真实 Provider 校验。结果请看状态和错误字段。")
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider 校验失败")
    } finally {
      setActionProviderId(null)
    }
  }

  async function handleToggleProvider(provider: ProviderRegistryRecord) {
    setActionProviderId(provider.id)
    setError("")
    setNotice("")

    try {
      const nextStatus: ModelControlLifecycleStatus = provider.status === "disabled" ? "draft" : "disabled"
      await api.updateModelProvider(provider.id, { status: nextStatus })
      setNotice(nextStatus === "disabled" ? "Provider 已标记为禁用。" : "Provider 已恢复为草稿状态，请重新校验。")
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新 Provider 状态失败")
    } finally {
      setActionProviderId(null)
    }
  }

  return (
    <div className="workspace-page">
      <section className="card">
        <div className="section-header section-header--stack">
          <div>
            <div className="eyebrow">Provider Registry</div>
            <h2>Provider 管理</h2>
            <p className="section-note">
              管理连接目标、鉴权方式和密钥状态。
            </p>
          </div>
          <div className="planning-summary-tags">
            <span className="pill pill--sm">真实 endpoint</span>
            <span className="pill pill--sm">真实校验</span>
            <span className="pill pill--sm">掩码展示</span>
          </div>
        </div>

        <ModelControlNav />
      </section>

      {error ? <div className="alert">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}

      <div className="model-control-grid">
        <section className="card">
          <div className="section-header">
            <h3>{editingProviderId ? "编辑 Provider" : "新增 Provider"}</h3>
            {editingProviderId ? (
              <button
                className="ghost-button ghost-button--compact"
                onClick={resetForm}
                type="button"
              >
                取消编辑
              </button>
            ) : null}
          </div>

          <div className="modal-form">
            <div className="form-section">
              <div className="form-section__title">
                <strong>身份标识</strong>
                <span>先定义内部 key 和运营可读名称，后续所有默认值和任务快照都基于这里的标识。</span>
              </div>

              <label>
                <span className="field-label">内部 Key</span>
                <input
                  className="input"
                  value={form.providerKey}
                  onChange={(event) => setForm((current) => ({ ...current, providerKey: event.target.value }))}
                  placeholder="例如：openai-prod-01"
                />
              </label>

              <label>
                <span className="field-label">显示名称</span>
                <input
                  className="input"
                  value={form.displayName}
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="例如：OpenAI Production"
                />
              </label>
            </div>

            <div className="form-section">
              <div className="form-section__title">
                <strong>连接方式</strong>
                <span>这里决定 Provider 的协议族、鉴权方法和实际接入目标。</span>
              </div>

              <div className="modal-grid">
                <label>
                  <span className="field-label">Provider 类型</span>
                  <select
                    className="input"
                    value={form.providerType}
                    onChange={(event) => setForm((current) => ({ ...current, providerType: event.target.value }))}
                  >
                    <option value="openai-compatible">openai-compatible</option>
                    <option value="anthropic-compatible">anthropic-compatible</option>
                    <option value="edge-tts">edge-tts</option>
                    <option value="azure-tts">azure-tts</option>
                    <option value="custom">custom</option>
                  </select>
                </label>

                <label>
                  <span className="field-label">鉴权方式</span>
                  <select
                    className="input"
                    value={form.authType}
                    onChange={(event) => setForm((current) => ({ ...current, authType: event.target.value }))}
                  >
                    <option value="bearer_token">bearer_token</option>
                    <option value="api_key_header">api_key_header</option>
                    <option value="x_api_key">x_api_key</option>
                    <option value="custom_header">custom_header</option>
                    <option value="none">none</option>
                  </select>
                </label>
              </div>

              <label>
                <span className="field-label">Endpoint URL</span>
                <input
                  className="input"
                  value={form.endpointUrl}
                  onChange={(event) => setForm((current) => ({ ...current, endpointUrl: event.target.value }))}
                  placeholder="例如：https://api.example.com/v1"
                />
              </label>
            </div>

            <div className="form-section">
              <div className="form-section__title">
                <strong>密钥与生命周期</strong>
                <span>密钥只在提交时传给后端保存；状态只决定是否允许后续进入校验或被停用。</span>
              </div>

              <label>
                <span className="field-label">{editingProviderId ? "更新密钥（留空表示保持现状）" : "密钥 / Token"}</span>
                <input
                  className="input mono"
                  type="password"
                  value={form.secret}
                  onChange={(event) => setForm((current) => ({ ...current, secret: event.target.value }))}
                  placeholder="仅在提交时传给后端，不会回显"
                />
              </label>

              <label>
                <span className="field-label">初始状态</span>
                <select
                  className="input"
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as ModelControlLifecycleStatus,
                    }))
                  }
                >
                  <option value="draft">draft</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
            </div>

            <div className="form-note">
              密钥不会回显；留空表示保持当前值。
            </div>

            <div className="action-row">
              <button className="ghost-button" onClick={resetForm} type="button">
                清空表单
              </button>
              <button className="primary-button" disabled={saving} onClick={handleSubmit} type="button">
                {saving ? "提交中..." : editingProviderId ? "保存 Provider" : "创建 Provider"}
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-header">
            <h3>已登记 Provider</h3>
            <span className="muted">仅展示真实后端返回的数据</span>
          </div>

          {loading ? (
            <div className="empty-inline">正在加载 Provider 列表...</div>
          ) : providers.length ? (
            <div className="table-wrap">
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>类型 / 鉴权</th>
                    <th>Endpoint</th>
                    <th>密钥状态</th>
                    <th>校验状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((provider) => (
                    <tr key={provider.id}>
                      <td>
                        <strong>{provider.displayName}</strong>
                        <div className="muted mono">{provider.providerKey}</div>
                      </td>
                      <td>
                        <div>{provider.providerType}</div>
                        <div className="muted">{provider.authType}</div>
                      </td>
                      <td className="text-break mono">{provider.endpointUrl || "未配置"}</td>
                      <td>
                        <div>{provider.maskedSecret ?? (provider.hasSecret ? "已保存密钥" : "未配置密钥")}</div>
                        <div className="muted">不会显示明文</div>
                      </td>
                      <td>
                        <div className={getStatusClass(provider.status)}>{provider.status}</div>
                        <div className="muted">最近校验：{formatDateTime(provider.lastValidatedAt)}</div>
                        {provider.lastValidationError ? (
                          <div className="inline-error-text">{provider.lastValidationError}</div>
                        ) : null}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="ghost-button ghost-button--compact"
                            onClick={() => startEdit(provider)}
                            type="button"
                          >
                            编辑
                          </button>
                          <button
                            className="ghost-button ghost-button--compact"
                            disabled={actionProviderId === provider.id}
                            onClick={() => void handleValidate(provider.id)}
                            type="button"
                          >
                            {actionProviderId === provider.id ? "处理中..." : "执行校验"}
                          </button>
                          <button
                            className="ghost-button ghost-button--compact"
                            disabled={actionProviderId === provider.id}
                            onClick={() => void handleToggleProvider(provider)}
                            type="button"
                          >
                            {provider.status === "disabled" ? "恢复草稿" : "标记禁用"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-inline">还没有 Provider 记录。先创建真实连接目标，再去登记模型。</div>
          )}
        </section>
      </div>
    </div>
  )
}
