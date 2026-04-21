import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  api,
  MODEL_CONTROL_SLOT_LABELS,
  MODEL_CONTROL_SLOT_ORDER,
  type CreateModelRegistryEntryPayload,
  type ModelControlLifecycleStatus,
  type ModelRegistryRecord,
  type ProviderRegistryRecord,
} from "../api"

const emptyForm: CreateModelRegistryEntryPayload = {
  modelKey: "",
  providerId: "",
  slotType: "textModel",
  providerModelId: "",
  displayName: "",
  capabilityJson: {},
  lifecycleStatus: "draft",
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

function stringifyCapabilityJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2)
}

export function ModelRegistryPage() {
  const [models, setModels] = useState<ModelRegistryRecord[]>([])
  const [providers, setProviders] = useState<ProviderRegistryRecord[]>([])
  const [form, setForm] = useState<CreateModelRegistryEntryPayload>(emptyForm)
  const [capabilityText, setCapabilityText] = useState("{}")
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionModelId, setActionModelId] = useState<string | null>(null)
  const [slotFilter, setSlotFilter] = useState<"all" | CreateModelRegistryEntryPayload["slotType"]>("all")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  async function loadRegistry() {
    setLoading(true)
    setError("")

    try {
      const [modelResponse, providerResponse] = await Promise.all([
        api.listModelRegistry(),
        api.listModelProviders(),
      ])

      setModels(modelResponse.models)
      setProviders(providerResponse.providers)
      setForm((current) => ({
        ...current,
        providerId: current.providerId || providerResponse.providers[0]?.id || "",
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "模型注册表加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRegistry()
  }, [])

  const filteredModels = useMemo(
    () => models.filter((model) => slotFilter === "all" || model.slotType === slotFilter),
    [models, slotFilter],
  )

  const availableProviders = useMemo(
    () =>
      providers.filter(
        (provider) => provider.status === "available" || provider.id === form.providerId,
      ),
    [form.providerId, providers],
  )

  function resetForm() {
    setEditingModelId(null)
    setForm({
      ...emptyForm,
      providerId: availableProviders[0]?.id || "",
    })
    setCapabilityText("{}")
  }

  function startEdit(model: ModelRegistryRecord) {
    setEditingModelId(model.id)
    setForm({
      modelKey: model.modelKey,
      providerId: model.providerId,
      slotType: model.slotType,
      providerModelId: model.providerModelId,
      displayName: model.displayName,
      capabilityJson: model.capabilityJson,
      lifecycleStatus: model.lifecycleStatus,
    })
    setCapabilityText(stringifyCapabilityJson(model.capabilityJson))
    setNotice("")
    setError("")
  }

  async function handleSubmit() {
    if (!form.modelKey.trim() || !form.displayName.trim() || !form.providerId || !form.providerModelId.trim()) {
      setError("请先填写 modelKey、显示名、绑定 Provider 和 providerModelId")
      return
    }

    let parsedCapabilityJson: Record<string, unknown> = {}
    try {
      parsedCapabilityJson = JSON.parse(capabilityText) as Record<string, unknown>
    } catch {
      setError("能力元数据必须是合法 JSON")
      return
    }

    setSaving(true)
    setError("")
    setNotice("")

    try {
      const payload = {
        modelKey: form.modelKey.trim(),
        providerId: form.providerId,
        slotType: form.slotType,
        providerModelId: form.providerModelId.trim(),
        displayName: form.displayName.trim(),
        capabilityJson: parsedCapabilityJson,
        lifecycleStatus: form.lifecycleStatus,
      }

      if (editingModelId) {
        await api.updateModelRegistryEntry(editingModelId, payload)
        setNotice("模型记录已更新。若 provider 或能力元数据改过，请重新校验。")
      } else {
        await api.createModelRegistryEntry(payload)
        setNotice("模型记录已创建。只有校验通过后才会进入默认值可选池。")
      }

      resetForm()
      await loadRegistry()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存模型记录失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleValidate(modelId: string) {
    setActionModelId(modelId)
    setError("")
    setNotice("")

    try {
      await api.validateModelRegistryEntry(modelId)
      setNotice("已触发真实模型校验，请查看状态与错误信息。")
      await loadRegistry()
    } catch (err) {
      setError(err instanceof Error ? err.message : "模型校验失败")
    } finally {
      setActionModelId(null)
    }
  }

  async function handleStatusChange(modelId: string, lifecycleStatus: ModelControlLifecycleStatus, noticeText: string) {
    setActionModelId(modelId)
    setError("")
    setNotice("")

    try {
      await api.updateModelRegistryEntry(modelId, { lifecycleStatus })
      setNotice(noticeText)
      await loadRegistry()
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新模型状态失败")
    } finally {
      setActionModelId(null)
    }
  }

  return (
    <div className="workspace-page">
      <section className="card">
        <div className="section-header section-header--stack">
          <div>
            <div className="eyebrow">Model Registry</div>
            <h2>模型注册表</h2>
            <p className="section-note">
              每条记录都要明确绑定一个 provider、一个槽位和一份能力元数据。只有 `available` 的记录才会进入默认值选择池。
            </p>
          </div>
          <div className="planning-summary-tags">
            <span className="pill pill--sm">四槽位实链</span>
            <span className="pill pill--sm">能力元数据 JSON</span>
            <span className="pill pill--sm">真实校验后入池</span>
          </div>
        </div>

        <ModelControlNav />
      </section>

      {error ? <div className="alert">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}

      <div className="model-control-grid">
        <section className="card">
          <div className="section-header">
            <h3>{editingModelId ? "编辑模型记录" : "新增模型记录"}</h3>
            {editingModelId ? (
              <button className="ghost-button ghost-button--compact" onClick={resetForm} type="button">
                取消编辑
              </button>
            ) : null}
          </div>

          <div className="modal-form">
            <div className="form-section">
              <div className="form-section__title">
                <strong>模型身份</strong>
                <span>先定义内部 key 和运营名称，让默认值中心和任务快照都能稳定引用。</span>
              </div>

              <label>
                <span className="field-label">内部 Key</span>
                <input
                  className="input"
                  value={form.modelKey}
                  onChange={(event) => setForm((current) => ({ ...current, modelKey: event.target.value }))}
                  placeholder="例如：veo-3-1-fast-prod"
                />
              </label>

              <label>
                <span className="field-label">显示名称</span>
                <input
                  className="input"
                  value={form.displayName}
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="例如：Veo 3.1 Fast"
                />
              </label>
            </div>

            <div className="form-section">
              <div className="form-section__title">
                <strong>绑定关系</strong>
                <span>每条模型记录都必须明确归属到一个槽位，并绑定一个已可用的 Provider。</span>
              </div>

              <div className="modal-grid">
                <label>
                  <span className="field-label">槽位</span>
                  <select
                    className="input"
                    value={form.slotType}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        slotType: event.target.value as CreateModelRegistryEntryPayload["slotType"],
                      }))
                    }
                  >
                    {MODEL_CONTROL_SLOT_ORDER.map((slot) => (
                      <option key={slot} value={slot}>
                        {MODEL_CONTROL_SLOT_LABELS[slot]}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="field-label">绑定 Provider</span>
                  <select
                    className="input"
                    value={form.providerId}
                    onChange={(event) => setForm((current) => ({ ...current, providerId: event.target.value }))}
                  >
                    {availableProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.displayName} ({provider.status})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                <span className="field-label">上游模型 ID</span>
                <input
                  className="input mono"
                  value={form.providerModelId}
                  onChange={(event) => setForm((current) => ({ ...current, providerModelId: event.target.value }))}
                  placeholder="例如：veo-3.1-fast"
                />
              </label>
            </div>

            <div className="form-section">
              <div className="form-section__title">
                <strong>能力与生命周期</strong>
                <span>能力元数据会直接影响后端校验和运行时摘要，所以这里要像正式配置一样认真填写。</span>
              </div>

              <label>
                <span className="field-label">初始状态</span>
                <select
                  className="input"
                  value={form.lifecycleStatus}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      lifecycleStatus: event.target.value as ModelControlLifecycleStatus,
                    }))
                  }
                >
                  <option value="draft">draft</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>

              <label>
                <span className="field-label">能力元数据 JSON</span>
                <textarea
                  className="textarea textarea--mono"
                  value={capabilityText}
                  onChange={(event) => setCapabilityText(event.target.value)}
                  placeholder={`{\n  "maxSingleShotSec": 8,\n  "qualityTier": "fast"\n}`}
                />
              </label>
            </div>

            <div className="form-note">
              能力元数据会参与校验和任务快照，请保持为合法 JSON。
            </div>

            <div className="action-row">
              <button className="ghost-button" onClick={resetForm} type="button">
                清空表单
              </button>
              <button className="primary-button" disabled={saving} onClick={handleSubmit} type="button">
                {saving ? "提交中..." : editingModelId ? "保存模型记录" : "创建模型记录"}
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-header">
            <h3>已登记模型</h3>
            <div className="section-actions">
              <select
                className="input input--compact"
                value={slotFilter}
                onChange={(event) =>
                  setSlotFilter(event.target.value as "all" | CreateModelRegistryEntryPayload["slotType"])
                }
              >
                <option value="all">全部槽位</option>
                {MODEL_CONTROL_SLOT_ORDER.map((slot) => (
                  <option key={slot} value={slot}>
                    {MODEL_CONTROL_SLOT_LABELS[slot]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="empty-inline">正在加载模型注册表...</div>
          ) : filteredModels.length ? (
            <div className="registry-list">
              {filteredModels.map((model) => (
                <article key={model.id} className="registry-item">
                  <div className="registry-item__header">
                    <div>
                      <strong>{model.displayName}</strong>
                      <div className="muted mono">{model.modelKey}</div>
                    </div>
                    <div className="planning-inline">
                      <span className="pill pill--sm">{MODEL_CONTROL_SLOT_LABELS[model.slotType]}</span>
                      <span className={getStatusClass(model.lifecycleStatus)}>{model.lifecycleStatus}</span>
                    </div>
                  </div>

                  <div className="registry-item__meta">
                    <div className="meta-tile">
                      <span>绑定 Provider</span>
                      <strong>{model.providerDisplayName ?? model.providerId}</strong>
                    </div>
                    <div className="meta-tile">
                      <span>上游模型 ID</span>
                      <strong className="mono text-break">{model.providerModelId}</strong>
                    </div>
                    <div className="meta-tile">
                      <span>最近校验</span>
                      <strong>{formatDateTime(model.lastValidatedAt)}</strong>
                    </div>
                    <div className="meta-tile">
                      <span>错误信息</span>
                      <strong className={model.lastValidationError ? "status-text--danger text-break" : ""}>
                        {model.lastValidationError || "无"}
                      </strong>
                    </div>
                  </div>

                  <div className="capability-list">
                    {Object.entries(model.capabilityJson ?? {}).length ? (
                      Object.entries(model.capabilityJson).map(([key, value]) => (
                        <span key={key} className="capability-pill">
                          {key}: {String(value)}
                        </span>
                      ))
                    ) : (
                      <span className="muted">尚未提供能力元数据</span>
                    )}
                  </div>

                  <div className="row-actions">
                    <button className="ghost-button ghost-button--compact" onClick={() => startEdit(model)} type="button">
                      编辑
                    </button>
                    <button
                      className="ghost-button ghost-button--compact"
                      disabled={actionModelId === model.id}
                      onClick={() => void handleValidate(model.id)}
                      type="button"
                    >
                      {actionModelId === model.id ? "处理中..." : "执行校验"}
                    </button>
                    <button
                      className="ghost-button ghost-button--compact"
                      disabled={actionModelId === model.id}
                      onClick={() =>
                        void handleStatusChange(
                          model.id,
                          model.lifecycleStatus === "disabled" ? "draft" : "disabled",
                          model.lifecycleStatus === "disabled"
                            ? "模型已恢复到草稿状态，请重新校验。"
                            : "模型已标记为禁用，不再出现在默认值选择池中。",
                        )
                      }
                      type="button"
                    >
                      {model.lifecycleStatus === "disabled" ? "恢复草稿" : "标记禁用"}
                    </button>
                    <button
                      className="ghost-button ghost-button--compact"
                      disabled={actionModelId === model.id || model.lifecycleStatus === "deprecated"}
                      onClick={() =>
                        void handleStatusChange(model.id, "deprecated", "模型已标记为弃用，保留历史记录但不建议继续选用。")
                      }
                      type="button"
                    >
                      标记弃用
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-inline">当前筛选下没有模型记录。先绑定 Provider，再补充能力元数据。</div>
          )}
        </section>
      </div>
    </div>
  )
}
