import { useEffect, useMemo, useState } from "react"
import {
  api,
  MODEL_CONTROL_MODE_LABELS,
  MODEL_CONTROL_SLOT_LABELS,
  MODEL_CONTROL_SLOT_ORDER,
  type ModelControlModeId,
  type ModelControlSlotType,
  type ModelFallbackTrigger,
  type ModelRoutingPolicies,
  type ModelRoutingPoliciesResponse,
  type ModelRoutingSlotPolicy,
  type ModelRoutingStrategy,
  type SelectableModelOption,
  type SelectableModelPoolsResponse,
} from "../api"
import { ModelControlNav, ModelControlNotice } from "../features/model-control/toolkit"

type RoutingScope = ModelControlModeId | "global"

const scopeLabels: Record<RoutingScope, string> = {
  high_quality: "高质量模式",
  mass_production: "量产模式",
  global: "全局兜底",
}

function emptyPolicy(): ModelRoutingSlotPolicy {
  return {
    enabled: false,
    strategy: "balanced",
    primary: null,
    fallbacks: [],
    fallbackTriggers: ["timeout", "rate_limit", "provider_error"],
    operatorNote: "",
  }
}

function getSelectionValue(slotType: ModelControlSlotType, selection: ModelRoutingSlotPolicy["primary"]) {
  if (!selection) {
    return ""
  }
  return slotType === "ttsProvider" ? selection.providerId ?? selection.modelId ?? "" : selection.modelId ?? ""
}

function selectionFromValue(slotType: ModelControlSlotType, value: string) {
  if (!value) {
    return null
  }
  return slotType === "ttsProvider" ? { providerId: value, modelId: value } : { modelId: value }
}

function getSelectionIdentity(slotType: ModelControlSlotType, selection: ModelRoutingSlotPolicy["primary"]) {
  return getSelectionValue(slotType, selection)
}

function describeOption(option: SelectableModelOption) {
  const provider = option.providerDisplayName ? ` / ${option.providerDisplayName}` : ""
  const wire = option.routingProfile?.wireApi ? ` · ${String(option.routingProfile.wireApi)}` : ""
  return `${option.displayName}${provider}${wire}`
}

function clonePolicies(policies: ModelRoutingPolicies): ModelRoutingPolicies {
  return JSON.parse(JSON.stringify(policies)) as ModelRoutingPolicies
}

function getPoliciesForScope(policies: ModelRoutingPolicies, scope: RoutingScope) {
  return scope === "global" ? policies.global : policies.modes[scope]
}

function getResolvedForScope(response: ModelRoutingPoliciesResponse | null, scope: RoutingScope) {
  return response?.resolved[scope] ?? null
}

export function ModelRoutingPage() {
  const [scope, setScope] = useState<RoutingScope>("high_quality")
  const [response, setResponse] = useState<ModelRoutingPoliciesResponse | null>(null)
  const [draft, setDraft] = useState<ModelRoutingPolicies | null>(null)
  const [pools, setPools] = useState<SelectableModelPoolsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const poolMode: ModelControlModeId = scope === "mass_production" ? "mass_production" : "high_quality"

  async function load() {
    setLoading(true)
    setError("")
    try {
      const [routingResponse, selectableResponse] = await Promise.all([
        api.getModelRoutingPolicies(),
        api.getSelectableModelPools(poolMode),
      ])
      setResponse(routingResponse)
      setDraft(clonePolicies(routingResponse.policies))
      setPools(selectableResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : "路由策略加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [poolMode])

  const scopePolicies = useMemo(
    () => (draft ? getPoliciesForScope(draft, scope) : null),
    [draft, scope],
  )
  const resolved = useMemo(() => getResolvedForScope(response, scope), [response, scope])

  function patchSlot(slotType: ModelControlSlotType, patch: Partial<ModelRoutingSlotPolicy>) {
    setDraft((current) => {
      if (!current) {
        return current
      }
      const next = clonePolicies(current)
      const target = getPoliciesForScope(next, scope)
      target[slotType] = {
        ...emptyPolicy(),
        ...(target[slotType] ?? {}),
        ...patch,
      }
      return next
    })
  }

  function setFallback(slotType: ModelControlSlotType, index: number, value: string) {
    const current = scopePolicies?.[slotType] ?? emptyPolicy()
    const fallbacks = [...current.fallbacks]
    const selection = selectionFromValue(slotType, value)
    if (selection) {
      fallbacks[index] = selection
    } else {
      fallbacks.splice(index, 1)
    }
    patchSlot(slotType, { fallbacks })
  }

  function addFallback(slotType: ModelControlSlotType) {
    const current = scopePolicies?.[slotType] ?? emptyPolicy()
    const used = new Set([
      getSelectionIdentity(slotType, current.primary),
      ...current.fallbacks.map((fallback) => getSelectionIdentity(slotType, fallback)),
    ].filter(Boolean))
    const nextOption = pools?.pools?.[slotType]?.options.find((option) => !used.has(option.recordId))
    if (!nextOption) {
      setError("没有可添加的备用模型。备用模型不能和主模型重复。")
      return
    }
    patchSlot(slotType, { fallbacks: [...current.fallbacks, selectionFromValue(slotType, nextOption.recordId)!] })
  }

  function validateScope() {
    if (!scopePolicies) {
      return "策略还没有加载完成。"
    }
    for (const slotType of MODEL_CONTROL_SLOT_ORDER) {
      const policy = scopePolicies[slotType] ?? emptyPolicy()
      if (!policy.enabled) {
        continue
      }
      const primaryValue = getSelectionIdentity(slotType, policy.primary)
      const seen = new Set<string>()
      for (const fallback of policy.fallbacks) {
        const fallbackValue = getSelectionIdentity(slotType, fallback)
        if (!fallbackValue) {
          return `${MODEL_CONTROL_SLOT_LABELS[slotType]} 有空的备用模型，请先选择模型或移除这一行。`
        }
        if (primaryValue && fallbackValue === primaryValue) {
          return `${MODEL_CONTROL_SLOT_LABELS[slotType]} 的备用模型不能和主模型相同。`
        }
        if (seen.has(fallbackValue)) {
          return `${MODEL_CONTROL_SLOT_LABELS[slotType]} 里有重复的备用模型。`
        }
        seen.add(fallbackValue)
      }
    }
    return ""
  }

  function toggleTrigger(slotType: ModelControlSlotType, trigger: ModelFallbackTrigger) {
    const current = scopePolicies?.[slotType] ?? emptyPolicy()
    const set = new Set(current.fallbackTriggers)
    if (set.has(trigger)) {
      set.delete(trigger)
    } else {
      set.add(trigger)
    }
    patchSlot(slotType, { fallbackTriggers: [...set] })
  }

  async function saveScope() {
    if (!draft) {
      return
    }
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const validationError = validateScope()
      if (validationError) {
        setError(validationError)
        return
      }
      const payload =
        scope === "global"
          ? { global: draft.global }
          : { modes: { [scope]: draft.modes[scope] } }
      const next = await api.updateModelRoutingPolicies(payload)
      setResponse(next)
      setDraft(clonePolicies(next.policies))
      setNotice(`${scopeLabels[scope]}路由策略已保存。后续新任务会按这里的规则固定模型。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存路由策略失败")
    } finally {
      setSaving(false)
    }
  }

  function resetScope() {
    if (response) {
      setDraft(clonePolicies(response.policies))
      setNotice("已恢复为上次保存的策略。")
    }
  }

  return (
    <div className="workspace-page">
      <section className="card">
        <div className="section-header section-header--stack">
          <div>
            <div className="eyebrow">模型设置</div>
            <h2>路由策略</h2>
            <p className="section-note">
              设置每个环节先用哪个模型、出问题时换哪个备用模型。保存后只影响后续新任务，历史任务继续使用创建时固定的记录。
            </p>
          </div>
          <div className="planning-summary-tags">
            <span className="info-chip">主模型</span>
            <span className="info-chip">备用路线</span>
            <span className="info-chip">选择原因</span>
          </div>
        </div>
        <ModelControlNav />
      </section>

      {error ? <ModelControlNotice tone="error">{error}</ModelControlNotice> : null}
      {notice ? <ModelControlNotice tone="success">{notice}</ModelControlNotice> : null}

      <section className="card">
        <div className="section-header section-header--stack">
          <div>
            <h3>维护范围</h3>
            <p className="section-note">
              先选一个范围。模式策略优先于全局兜底；如果本次任务手动指定模型，手动选择仍然最优先。
            </p>
          </div>
          <div className="segmented-control segmented-control--compact" role="radiogroup" aria-label="路由策略范围">
            {(["high_quality", "mass_production", "global"] as RoutingScope[]).map((item) => (
              <button
                aria-checked={scope === item}
                className={scope === item ? "segment segment--active" : "segment"}
                key={item}
                onClick={() => setScope(item)}
                role="radio"
                type="button"
              >
                {scopeLabels[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="routing-precedence">
          <div>
            <strong>生效顺序</strong>
            <span>本次任务手动指定 → 当前模式路由策略 → 全局路由策略 → 当前模式默认 → 全局默认</span>
          </div>
          <div>
            <strong>什么时候切备用</strong>
            <span>默认只在超时、限流、接入方错误这类可恢复问题上切换；密钥错、模型不存在不会悄悄切走。</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h3>{scopeLabels[scope]}策略</h3>
            <p className="section-note">建议每个环节只放一个主模型，备用模型按可靠程度从前往后排。</p>
          </div>
          <div className="action-row">
            <button className="ghost-button" disabled={saving || loading} onClick={resetScope} type="button">
              撤回修改
            </button>
            <button className="primary-button" disabled={saving || loading || !draft} onClick={() => void saveScope()} type="button">
              {saving ? "保存中..." : "保存策略"}
            </button>
          </div>
        </div>

        {loading || !scopePolicies ? (
          <div className="empty-inline">正在加载策略...</div>
        ) : (
          <div className="routing-policy-list">
            {MODEL_CONTROL_SLOT_ORDER.map((slotType) => {
              const policy = scopePolicies[slotType] ?? emptyPolicy()
              const options = pools?.pools?.[slotType]?.options ?? []
              const resolvedSlot = resolved?.[slotType]
              return (
                <div className="routing-policy-row" key={slotType}>
                  <div className="routing-policy-row__head">
                    <div>
                      <strong>{MODEL_CONTROL_SLOT_LABELS[slotType]}</strong>
                      <span>{resolvedSlot?.summary ?? "还没有保存过这个环节的策略。"}</span>
                    </div>
                    <label className="toggle-line">
                      <input
                        checked={policy.enabled}
                        onChange={(event) => patchSlot(slotType, { enabled: event.target.checked })}
                        type="checkbox"
                      />
                      <span>启用策略</span>
                    </label>
                  </div>

                  <div className="routing-policy-grid">
                    <label className="form-field">
                      <span>主模型</span>
                      <select
                        className="input"
                        disabled={!policy.enabled}
                        value={getSelectionValue(slotType, policy.primary)}
                        onChange={(event) => patchSlot(slotType, { primary: selectionFromValue(slotType, event.target.value) })}
                      >
                        <option value="">使用默认模型</option>
                        {options.map((option) => (
                          <option key={option.recordId} value={option.recordId}>
                            {describeOption(option)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="form-field">
                      <span>选择方式</span>
                      <select
                        className="input"
                        disabled={!policy.enabled}
                        value={policy.strategy}
                        onChange={(event) => patchSlot(slotType, { strategy: event.target.value as ModelRoutingStrategy })}
                      >
                        {(response?.strategyOptions ?? []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="routing-fallbacks">
                    <div className="routing-subhead">
                      <strong>备用模型</strong>
                      <button
                        className="ghost-button ghost-button--compact"
                        disabled={!policy.enabled || policy.fallbacks.length >= 3}
                        onClick={() => addFallback(slotType)}
                        type="button"
                      >
                        添加备用
                      </button>
                    </div>
                    {policy.fallbacks.length ? (
                      policy.fallbacks.map((fallback, index) => (
                        <div className="routing-fallback-row" key={`${slotType}-${index}`}>
                          <select
                            className="input"
                            disabled={!policy.enabled}
                            value={getSelectionValue(slotType, fallback)}
                            onChange={(event) => setFallback(slotType, index, event.target.value)}
                          >
                            <option value="">选择备用模型</option>
                            {options.map((option) => (
                              <option key={option.recordId} value={option.recordId}>
                                {describeOption(option)}
                              </option>
                            ))}
                          </select>
                          <button
                            className="ghost-button ghost-button--compact"
                            disabled={!policy.enabled}
                            onClick={() => setFallback(slotType, index, "")}
                            type="button"
                          >
                            移除
                          </button>
                        </div>
                      ))
                    ) : (
                      <span className="muted">暂无备用模型。主模型异常时不会自动换路。</span>
                    )}
                  </div>

                  <div className="routing-trigger-group">
                    <strong>允许切换的情况</strong>
                    <div className="routing-trigger-options">
                      {(response?.triggerOptions ?? []).map((option) => (
                        <label className="check-pill" key={option.value}>
                          <input
                            checked={policy.fallbackTriggers.includes(option.value)}
                            disabled={!policy.enabled}
                            onChange={() => toggleTrigger(slotType, option.value)}
                            type="checkbox"
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <label className="form-field">
                    <span>备注</span>
                    <textarea
                      className="input textarea routing-note-input"
                      disabled={!policy.enabled}
                      maxLength={500}
                      onChange={(event) => patchSlot(slotType, { operatorNote: event.target.value })}
                      placeholder="例如：图片主模型优先保证角色一致；只有超时或限流才换备用。"
                      value={policy.operatorNote}
                    />
                  </label>

                  {resolvedSlot?.warnings.length ? (
                    <div className="inline-error-text">{resolvedSlot.warnings.join(" ")}</div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
