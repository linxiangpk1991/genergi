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
    { to: "/model-control-center/providers", label: "接入方管理" },
    { to: "/model-control-center/registry", label: "模型列表" },
    { to: "/model-control-center/defaults", label: "默认模型" },
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
      setError(err instanceof Error ? err.message : "接入方列表加载失败")
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
      setError("请先填写内部 Key、显示名称、接入类型和鉴权方式")
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
        setNotice("接入方已更新。若改了接口地址或密钥，请重新校验。")
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
        setNotice("接入方已创建。下一步请执行真实校验。")
      }

      resetForm()
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存接入方失败")
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
      setNotice("已开始真实校验。结果请看状态和错误信息。")
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : "接入方校验失败")
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
      setNotice(nextStatus === "disabled" ? "接入方已禁用。" : "接入方已恢复为草稿状态，请重新校验。")
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新接入方状态失败")
    } finally {
      setActionProviderId(null)
    }
  }

  return (
    <div className="workspace-page">
      <section className="card">
        <div className="section-header section-header--stack">
          <div>
            <div className="eyebrow">接入方管理</div>
            <h2>接入方管理</h2>
            <p className="section-note">
              管理模型服务的接口地址、鉴权方式和密钥状态。
            </p>
          </div>
          <div className="planning-summary-tags">
            <span className="pill pill--sm">真实接口地址</span>
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
            <h3>{editingProviderId ? "编辑接入方" : "新增接入方"}</h3>
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
                <span>先定义内部 Key 和运营能看懂的名称，后续默认模型和历史任务都会引用这里。</span>
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
                <span>这里决定接入协议、鉴权方法和实际接口地址。</span>
              </div>

              <div className="modal-grid">
                <label>
                  <span className="field-label">接入类型</span>
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
                <span className="field-label">接口地址</span>
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
              密钥不会回显；编辑时留空表示保持当前值。
            </div>

            <div className="action-row">
              <button className="ghost-button" onClick={resetForm} type="button">
                清空表单
              </button>
              <button className="primary-button" disabled={saving} onClick={handleSubmit} type="button">
                {saving ? "提交中..." : editingProviderId ? "保存接入方" : "创建接入方"}
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-header">
            <h3>已登记接入方</h3>
            <span className="muted">仅展示系统真实保存的数据</span>
          </div>

          {loading ? (
            <div className="empty-inline">正在加载接入方列表...</div>
          ) : providers.length ? (
            <div className="table-wrap">
              <table className="user-table">
                <thead>
                  <tr>
                    <th>接入方</th>
                    <th>类型 / 鉴权</th>
                    <th>接口地址</th>
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
                            {actionProviderId === provider.id ? "处理中..." : "开始校验"}
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
            <div className="empty-inline">还没有接入方记录。先创建真实连接目标，再去登记模型。</div>
          )}
        </section>
      </div>
    </div>
  )
}
