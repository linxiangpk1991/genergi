import { useEffect, useMemo, useState } from "react"
import {
  api,
  MODEL_CONTROL_SLOT_LABELS,
  MODEL_CONTROL_SLOT_ORDER,
  type CreateModelRegistryEntryPayload,
  type ModelDiagnosticRecord,
  type ModelControlLifecycleStatus,
  type ModelRegistryRecord,
  type ProviderRegistryRecord,
} from "../api"
import {
  buildCapabilityPreset,
  getModelCallProfile,
  IMAGE_TRANSPORT_OPTIONS,
  normalizeTextWireApiForUi,
  TEXT_WIRE_API_OPTIONS,
} from "../lib/model-control-display"
import {
  CapabilityTags,
  ConfirmActionDialog,
  type ConfirmActionState,
  getLifecycleDetail,
  ModelControlNav,
  ModelControlNotice,
  ModelStatusBadge,
} from "../features/model-control/toolkit"

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

function formatSmokeMode(value: ModelDiagnosticRecord["smokeMode"]) {
  if (value === "minimal_generation") {
    return "真实小样本"
  }
  if (value === "connectivity") {
    return "真实连通"
  }
  return "配置检查"
}

function formatDiagnosticStatus(value: ModelDiagnosticRecord["status"]) {
  if (value === "success") {
    return "通过"
  }
  if (value === "skipped") {
    return "跳过真实调用"
  }
  return "失败"
}

function stringifyCapabilityJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2)
}

function parseCapabilityText(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function mergeCapabilityText(currentText: string, patch: Record<string, unknown>) {
  return stringifyCapabilityJson({
    ...parseCapabilityText(currentText),
    ...patch,
  })
}

function isCapabilityTextValid(value: string) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
  } catch {
    return false
  }
}

export function ModelRegistryPage() {
  const [models, setModels] = useState<ModelRegistryRecord[]>([])
  const [diagnostics, setDiagnostics] = useState<ModelDiagnosticRecord[]>([])
  const [providers, setProviders] = useState<ProviderRegistryRecord[]>([])
  const [form, setForm] = useState<CreateModelRegistryEntryPayload>(emptyForm)
  const [capabilityText, setCapabilityText] = useState("{}")
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionModelId, setActionModelId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState>(null)
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
      const diagnosticResponse = await api.listModelDiagnostics({ limit: 100 }).catch(() => ({ diagnostics: [] }))

      setModels(modelResponse.models)
      setDiagnostics(diagnosticResponse.diagnostics)
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

  const latestDiagnosticByModelId = useMemo(() => {
    const records = new Map<string, ModelDiagnosticRecord>()
    diagnostics.forEach((diagnostic) => {
      if (diagnostic.modelId && !records.has(diagnostic.modelId)) {
        records.set(diagnostic.modelId, diagnostic)
      }
    })
    return records
  }, [diagnostics])

  const latestSuccessByModelId = useMemo(() => {
    const records = new Map<string, ModelDiagnosticRecord>()
    diagnostics.forEach((diagnostic) => {
      if (diagnostic.modelId && diagnostic.status === "success" && !records.has(diagnostic.modelId)) {
        records.set(diagnostic.modelId, diagnostic)
      }
    })
    return records
  }, [diagnostics])

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

  function applyCapabilityPatch(patch: Record<string, unknown>) {
    setCapabilityText((current) => mergeCapabilityText(current, patch))
  }

  function applyAutoCapabilityPreset() {
    if (!isCapabilityTextValid(capabilityText)) {
      setError("能力说明 JSON 还不是合法对象，先修正后再自动补全，避免覆盖草稿。")
      return
    }
    const preset = buildCapabilityPreset(form.slotType, form.providerModelId)
    setCapabilityText((current) => mergeCapabilityText(current, preset))
    setError("")
    setNotice("已按模型 ID 补全调用能力，当前只是草稿，请点击保存后生效。")
  }

  function getDraftModelForProfile(): Pick<ModelRegistryRecord, "slotType" | "providerModelId" | "capabilityJson"> {
    return {
      slotType: form.slotType,
      providerModelId: form.providerModelId,
      capabilityJson: parseCapabilityText(capabilityText),
    }
  }

  async function handleSubmit() {
    if (!form.modelKey.trim() || !form.displayName.trim() || !form.providerId || !form.providerModelId.trim()) {
      setError("请先填写内部 Key、显示名称、绑定接入方和上游模型 ID")
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
        setNotice("模型记录已更新。若接入方或能力说明改过，请重新校验。")
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
      setNotice("已完成配置检查：通过后会进入默认模型可选池；真实小样本试跑会在检查功能里单独触发。")
      await loadRegistry()
    } catch (err) {
      setError(err instanceof Error ? err.message : "模型校验失败")
    } finally {
      setActionModelId(null)
    }
  }

  function requestStatusChange(model: ModelRegistryRecord, lifecycleStatus: ModelControlLifecycleStatus, noticeText: string) {
    const actionLabel =
      lifecycleStatus === "disabled"
        ? "停用模型"
        : lifecycleStatus === "deprecated"
          ? "弃用模型"
          : "恢复为草稿"
    setConfirmAction({
      title: `${actionLabel}：${model.displayName}`,
      body:
        lifecycleStatus === "draft"
          ? "恢复后不会自动进入默认模型池，需要重新检查配置。历史任务不会受影响。"
          : "该操作会让模型退出默认模型可选池；如果它正在作为默认模型使用，后续新任务需要重新选择可用模型。历史任务会继续保留冻结快照。",
      confirmLabel: actionLabel,
      danger: lifecycleStatus !== "draft",
      onConfirm: async () => {
        await handleStatusChange(model.id, lifecycleStatus, noticeText)
        setConfirmAction(null)
      },
    })
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
          <div className="eyebrow">模型列表</div>
          <h2>模型列表</h2>
          <p className="section-note">
              每条记录都要绑定接入方、用途和能力说明。只有校验通过的模型才会出现在默认模型里。
          </p>
          </div>
          <div className="planning-summary-tags">
            <span className="info-chip">文案 / 图片 / 视频 / 配音</span>
            <span className="info-chip">能力说明 JSON</span>
            <span className="info-chip">检查通过后可选</span>
          </div>
        </div>

        <ModelControlNav />
      </section>

      {error ? <ModelControlNotice tone="error">{error}</ModelControlNotice> : null}
      {notice ? <ModelControlNotice tone="success">{notice}</ModelControlNotice> : null}

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
                <span>先定义内部 Key 和运营能看懂的名称，让默认模型和历史任务都能稳定引用。</span>
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
                <span>每条模型记录都必须明确用途，并绑定一个已可用的接入方。</span>
              </div>

              <div className="modal-grid">
                <label>
                  <span className="field-label">用途</span>
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
                  <span className="field-label">绑定接入方</span>
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
                {form.slotType === "textModel" && form.providerModelId.trim().toLowerCase().startsWith("gpt-5") ? (
                  <span className="field-help">GPT-5 / GPT-5.5 文案模型默认按 Responses API 调用。</span>
                ) : null}
              </label>
            </div>

            <div className="form-section">
              <div className="form-section__title">
                <strong>能力与生命周期</strong>
                <span>能力说明会影响系统校验和任务摘要，所以这里要像正式配置一样认真填写。</span>
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

              <div className="model-profile-editor">
                <div className="form-section__title">
                  <strong>调用方式</strong>
                  <span>这里会写入能力 JSON，worker 会按这个字段决定实际走哪个接口。</span>
                </div>

                {form.slotType === "textModel" ? (
                  <label>
                    <span className="field-label">文本接口</span>
                    <select
                      className="input"
                      value={normalizeTextWireApiForUi(parseCapabilityText(capabilityText).wireApi, form.providerModelId)}
                      onChange={(event) =>
                        applyCapabilityPatch({
                          wireApi: event.target.value,
                          endpointStyle: event.target.value === "responses"
                            ? "responses"
                            : event.target.value === "messages"
                              ? "messages"
                              : "chat-completions",
                        })
                      }
                    >
                      {TEXT_WIRE_API_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} ({option.endpoint})
                        </option>
                      ))}
                    </select>
                    <span className="field-help">
                      {TEXT_WIRE_API_OPTIONS.find((option) => option.value === normalizeTextWireApiForUi(parseCapabilityText(capabilityText).wireApi, form.providerModelId))?.description}
                    </span>
                  </label>
                ) : null}

                {form.slotType === "imageModel" ? (
                  <div className="modal-grid">
                    <label>
                      <span className="field-label">图片接口</span>
                      <select
                        className="input"
                        value={String(parseCapabilityText(capabilityText).imageTransport ?? "")}
                        onChange={(event) => {
                          const option = IMAGE_TRANSPORT_OPTIONS.find((item) => item.value === event.target.value)
                          applyCapabilityPatch({
                            imageTransport: event.target.value,
                            endpointStyle:
                              event.target.value === "openai-images-generations"
                                ? "images-generations"
                                : event.target.value === "gemini-generate-content"
                                  ? "gemini-generate-content"
                                  : "chat-completions",
                            supportsBatchKeyframes: event.target.value === "openai-images-generations",
                            maxBatchImages: event.target.value === "openai-images-generations"
                              ? Number(parseCapabilityText(capabilityText).maxBatchImages ?? 4)
                              : undefined,
                          })
                          if (option?.value === "openai-images-generations") {
                            applyCapabilityPatch({ family: "gpt-image", usage: "image-generation" })
                          }
                        }}
                      >
                        <option value="">待选择</option>
                        {IMAGE_TRANSPORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label} ({option.endpoint})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="field-label">最大批量张数</span>
                      <input
                        className="input"
                        min={1}
                        max={8}
                        type="number"
                        value={String(parseCapabilityText(capabilityText).maxBatchImages ?? "")}
                        onChange={(event) =>
                          applyCapabilityPatch({
                            supportsBatchKeyframes: true,
                            maxBatchImages: Number(event.target.value) || undefined,
                          })
                        }
                        placeholder="例如：4"
                      />
                    </label>
                  </div>
                ) : null}

                {form.slotType === "videoModel" ? (
                  <div className="modal-grid">
                    <label>
                      <span className="field-label">最大单段时长</span>
                      <input
                        className="input"
                        min={1}
                        type="number"
                        value={String(parseCapabilityText(capabilityText).maxSingleShotSec ?? "")}
                        onChange={(event) =>
                          applyCapabilityPatch({
                            maxSingleShotSec: Number(event.target.value) || undefined,
                            usage: "video-generation",
                          })
                        }
                        placeholder="例如：8"
                      />
                    </label>
                    <label>
                      <span className="field-label">质量档位</span>
                      <select
                        className="input"
                        value={String(parseCapabilityText(capabilityText).qualityTier ?? "")}
                        onChange={(event) => applyCapabilityPatch({ qualityTier: event.target.value, usage: "video-generation" })}
                      >
                        <option value="">待选择</option>
                        <option value="fast">快速</option>
                        <option value="high">高质量</option>
                        <option value="hd">高清</option>
                      </select>
                    </label>
                  </div>
                ) : null}

                <div className="model-call-preview">
                  <strong>{getModelCallProfile(getDraftModelForProfile()).label}</strong>
                  <span>{getModelCallProfile(getDraftModelForProfile()).endpoint}</span>
                  <small>{getModelCallProfile(getDraftModelForProfile()).description}</small>
                </div>

                <button className="ghost-button ghost-button--compact" onClick={applyAutoCapabilityPreset} type="button">
                  按模型 ID 自动补全能力
                </button>
              </div>

              <label>
                <span className="field-label">能力说明 JSON</span>
                <textarea
                  className="textarea textarea--mono"
                  value={capabilityText}
                  onChange={(event) => setCapabilityText(event.target.value)}
                  placeholder={`{\n  "maxSingleShotSec": 8,\n  "qualityTier": "fast"\n}`}
                />
              </label>
            </div>

            <div className="form-note">
              能力说明会参与校验和任务固定设置，请保持为合法 JSON。
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
            <div className="empty-inline">正在加载模型列表...</div>
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
                      <span className="info-chip">{MODEL_CONTROL_SLOT_LABELS[model.slotType]}</span>
                      <ModelStatusBadge status={model.lifecycleStatus} />
                    </div>
                  </div>
                  <div className="model-selectable-note">{getLifecycleDetail(model.lifecycleStatus)}</div>

                  <div className="model-call-summary">
                    {(() => {
                      const profile = getModelCallProfile(model)
                      return (
                        <>
                          <strong>{profile.label}</strong>
                          <span>{profile.endpoint}</span>
                          <small>{profile.description}</small>
                        </>
                      )
                    })()}
                  </div>

                  <div className="registry-item__meta">
                    <div className="meta-tile">
                      <span>绑定接入方</span>
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

                  {(() => {
                    const diagnostic = latestDiagnosticByModelId.get(model.id)
                    const latestSuccess = latestSuccessByModelId.get(model.id)
                    return diagnostic ? (
                      <div className="model-diagnostic-summary">
                        <div className="model-diagnostic-summary__header">
                          <strong>最近检查</strong>
                          <span className={diagnostic.status === "failed" ? "status-text--danger" : "status-text--success"}>
                            {formatDiagnosticStatus(diagnostic.status)}
                          </span>
                        </div>
                        <div className="model-diagnostic-summary__grid">
                          <span>{formatSmokeMode(diagnostic.smokeMode)}</span>
                          <span>{diagnostic.wireApi === "responses" ? "Responses API" : diagnostic.wireApi}</span>
                          <span>{diagnostic.requestPath}</span>
                          <span>{diagnostic.durationMs}ms</span>
                        </div>
                        <div className="model-diagnostic-summary__success">
                          最近一次成功：{latestSuccess ? formatDateTime(latestSuccess.createdAt) : "尚无成功记录"}
                        </div>
                        {diagnostic.errorMessage ? (
                          <div className="inline-error-text">{diagnostic.errorMessage}</div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="model-diagnostic-summary model-diagnostic-summary--empty">
                        <strong>最近检查</strong>
                        <span>暂无调用诊断记录</span>
                      </div>
                    )
                  })()}

                  <CapabilityTags value={model.capabilityJson} />

                  <div className="row-actions">
                    <button className="ghost-button ghost-button--compact" onClick={() => startEdit(model)} type="button">
                      载入编辑
                    </button>
                    <button
                      className="model-action-button model-action-button--check"
                      disabled={actionModelId === model.id}
                      onClick={() => void handleValidate(model.id)}
                      type="button"
                    >
                      {actionModelId === model.id ? "检查中..." : "检查配置"}
                    </button>
                    <button
                      className={model.lifecycleStatus === "disabled" ? "ghost-button ghost-button--compact" : "warning-button"}
                      disabled={actionModelId === model.id}
                      onClick={() =>
                        requestStatusChange(
                          model,
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
                      className="danger-button danger-button--compact"
                      disabled={actionModelId === model.id || model.lifecycleStatus === "deprecated"}
                      onClick={() =>
                        requestStatusChange(model, "deprecated", "模型已标记为弃用，保留历史记录但不建议继续选用。")
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
            <div className="empty-inline">当前筛选下没有模型记录。先绑定接入方，再补充能力说明。</div>
          )}
        </section>
      </div>
      <ConfirmActionDialog
        busy={Boolean(actionModelId)}
        onClose={() => setConfirmAction(null)}
        state={confirmAction}
      />
    </div>
  )
}
