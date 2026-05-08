import { useEffect, useMemo, useState } from "react"
import {
  api,
  MODEL_CONTROL_MODE_LABELS,
  MODEL_CONTROL_SLOT_LABELS,
  MODEL_CONTROL_SLOT_ORDER,
  type ModelControlDefaults,
  type ModelControlModeId,
  type SelectableModelOption,
  type SelectableModelPoolsResponse,
} from "../api"
import { getModelCallProfile } from "../lib/model-control-display"
import {
  ConfirmActionDialog,
  type ConfirmActionState,
  EffectiveDefaultsPanel,
  ModelControlNav,
  ModelControlNotice,
} from "../features/model-control/toolkit"

type SlotDraft = Partial<Record<(typeof MODEL_CONTROL_SLOT_ORDER)[number], string>>

const emptySlotDraft: SlotDraft = {}

function buildDraftFromDefaults(defaults: ModelControlDefaults | null, modeId?: ModelControlModeId) {
  return MODEL_CONTROL_SLOT_ORDER.reduce<SlotDraft>((accumulator, slot) => {
    const selection = modeId ? defaults?.modes?.[modeId]?.[slot] : defaults?.global?.[slot]
    accumulator[slot] = selection?.recordId ?? ""
    return accumulator
  }, {})
}

function mergeSelectableOptions(
  left: SelectableModelOption[] | undefined,
  right: SelectableModelOption[] | undefined,
) {
  const merged = new Map<string, SelectableModelOption>()

  ;[...(left ?? []), ...(right ?? [])].forEach((option) => {
    merged.set(option.recordId, option)
  })

  return [...merged.values()]
}

function toAssignmentPayload(draft: SlotDraft) {
  return MODEL_CONTROL_SLOT_ORDER.reduce<Record<string, string | null>>((accumulator, slot) => {
    accumulator[slot] = draft[slot] || null
    return accumulator
  }, {})
}

function describeOption(option: SelectableModelOption | null | undefined) {
  if (!option) {
    return "未设置"
  }

  const providerLabel = option.providerDisplayName ? ` / ${option.providerDisplayName}` : ""
  if (option.providerModelId && option.capabilityJson) {
    const profile = getModelCallProfile({
      slotType: option.slotType,
      providerModelId: option.providerModelId,
      capabilityJson: option.capabilityJson,
    })
    return `${option.displayName}${providerLabel} · ${profile.label}`
  }

  return `${option.displayName}${providerLabel}`
}

export function ModelDefaultsPage() {
  const [defaults, setDefaults] = useState<ModelControlDefaults | null>(null)
  const [taskCreationSelectable, setTaskCreationSelectable] = useState<SelectableModelPoolsResponse | null>(null)
  const [selectedModeId, setSelectedModeId] = useState<ModelControlModeId>("high_quality")
  const [globalDraft, setGlobalDraft] = useState<SlotDraft>(emptySlotDraft)
  const [taskCreationDraft, setTaskCreationDraft] = useState<SlotDraft>(emptySlotDraft)
  const [loading, setLoading] = useState(true)
  const [savingScope, setSavingScope] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  async function loadDefaults() {
    setLoading(true)
    setError("")

    try {
      const [defaultsResponse, taskCreationSelectableResponse] = await Promise.all([
        api.getModelDefaults(),
        api.getSelectableModelPools(selectedModeId),
      ])

      setDefaults(defaultsResponse)
      setTaskCreationSelectable(taskCreationSelectableResponse)
      setGlobalDraft(buildDraftFromDefaults(defaultsResponse))
      setTaskCreationDraft(buildDraftFromDefaults(defaultsResponse, selectedModeId))
    } catch (err) {
      setError(err instanceof Error ? err.message : "默认模型加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDefaults()
  }, [selectedModeId])

  const globalOptions = useMemo(
    () =>
      MODEL_CONTROL_SLOT_ORDER.reduce<Record<string, SelectableModelOption[]>>((accumulator, slot) => {
        accumulator[slot] = mergeSelectableOptions(
          taskCreationSelectable?.pools?.[slot]?.options,
          undefined,
        )
        return accumulator
      }, {}),
    [taskCreationSelectable],
  )

  function resolveTaskCreationOption(slot: keyof typeof MODEL_CONTROL_SLOT_LABELS) {
    const options = taskCreationSelectable?.pools?.[slot]?.options ?? []
    const effectiveId = taskCreationDraft[slot] || globalDraft[slot]
    return options.find((option) => option.recordId === effectiveId) ?? null
  }

  async function handleSaveGlobal() {
    setSavingScope("global")
    setError("")
    setNotice("")

    try {
      const response = await api.updateGlobalModelDefaults({
        assignments: toAssignmentPayload(globalDraft),
      })
      setDefaults(response)
      setGlobalDraft(buildDraftFromDefaults(response))
      setTaskCreationDraft(buildDraftFromDefaults(response, selectedModeId))
      setNotice("全局兜底模型已保存。当前以系统返回结果为准。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存全局兜底模型失败")
    } finally {
      setSavingScope(null)
    }
  }

  async function handleSaveTaskCreationDefaults() {
    setSavingScope(selectedModeId)
    setError("")
    setNotice("")

    try {
      const response = await api.updateModeModelDefaults(selectedModeId, {
        assignments: toAssignmentPayload(taskCreationDraft),
      })
      setDefaults(response)
      setGlobalDraft(buildDraftFromDefaults(response))
      setTaskCreationDraft(buildDraftFromDefaults(response, selectedModeId))
      setNotice(`${MODEL_CONTROL_MODE_LABELS[selectedModeId]}默认模型已保存。后续新任务会使用新的生效组合，历史任务不受影响。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存新任务默认模型失败")
    } finally {
      setSavingScope(null)
    }
  }

  function requestSaveGlobal() {
    setConfirmAction({
      title: "保存全局兜底模型",
      body: "全局兜底只在当前模式没有单独指定模型时生效。保存后只影响后续新任务，历史任务会继续使用创建时冻结的模型快照。",
      confirmLabel: "保存全局兜底",
      onConfirm: async () => {
        await handleSaveGlobal()
        setConfirmAction(null)
      },
    })
  }

  function requestSaveModeDefaults() {
    setConfirmAction({
      title: `保存${MODEL_CONTROL_MODE_LABELS[selectedModeId]}默认模型`,
      body: "这会改变该模式后续新任务的默认模型组合，不会影响已经创建的任务。保存前请确认四个槽位的当前有效值符合预期。",
      confirmLabel: `保存${MODEL_CONTROL_MODE_LABELS[selectedModeId]}`,
      onConfirm: async () => {
        await handleSaveTaskCreationDefaults()
        setConfirmAction(null)
      },
    })
  }

  return (
    <div className="workspace-page">
      <section className="card">
        <div className="section-header section-header--stack">
          <div>
            <div className="eyebrow">默认模型</div>
            <h2>默认模型</h2>
            <p className="section-note">
              这里直接展示和保存真实默认模型。新任务创建时，会把当前生效的模型组合固定到任务里。
            </p>
          </div>
          <div className="planning-summary-tags">
            <span className="info-chip">全局兜底</span>
            <span className="info-chip">新任务默认</span>
            <span className="info-chip">创建时固定</span>
          </div>
        </div>

        <ModelControlNav />
      </section>

      {error ? <ModelControlNotice tone="error">{error}</ModelControlNotice> : null}
      {notice ? <ModelControlNotice tone="success">{notice}</ModelControlNotice> : null}

      <section className="card">
        <div className="section-header section-header--stack">
          <div>
            <h3>新任务模式</h3>
            <p className="section-note">
              先选择要维护的模式，再调整该模式的新任务默认模型。这里的当前生效组合会在任务创建时固定下来。
            </p>
          </div>
          <div className="segmented-control segmented-control--compact" role="radiogroup" aria-label="新任务模式">
            {(["high_quality", "mass_production"] as ModelControlModeId[]).map((modeId) => (
              <button
                aria-checked={selectedModeId === modeId}
                className={selectedModeId === modeId ? "segment segment--active" : "segment"}
                key={modeId}
                onClick={() => setSelectedModeId(modeId)}
                role="radio"
                type="button"
              >
                {MODEL_CONTROL_MODE_LABELS[modeId]}
              </button>
            ))}
          </div>
        </div>

        <EffectiveDefaultsPanel modeId={selectedModeId} defaults={defaults} pools={taskCreationSelectable} />
      </section>

      <section className="card">
        <div className="section-header">
          <h3>优先级说明</h3>
          <span className="muted">生效顺序说明</span>
        </div>
        <div className="precedence-strip">
          <div className="planning-note-card">
            <strong>任务固定设置</strong>
            <span>任务创建时会把当前生效的模型组合固定下来，之后历史任务不再跟随后续默认值变化。</span>
          </div>
          <div className="planning-note-card">
            <strong>新任务默认</strong>
            <span>这套值就是新任务真正会用到的默认模型，会覆盖全局兜底。</span>
          </div>
          <div className="planning-note-card">
            <strong>全局默认</strong>
            <span>作为兜底模型，只有新任务默认没有指定时才会生效。</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>全局兜底</h3>
          <span className="muted">给新任务提供兜底模型选择</span>
        </div>

        {loading ? (
          <div className="empty-inline">正在加载真实默认模型...</div>
        ) : (
          <>
            <div className="default-grid">
              {MODEL_CONTROL_SLOT_ORDER.map((slot) => (
                <div key={slot} className="default-slot-row">
                  <div className="default-slot-row__copy">
                    <strong>{MODEL_CONTROL_SLOT_LABELS[slot]}</strong>
                    <span>
                      当前系统值：{defaults?.global?.[slot]?.displayName ? describeOption(defaults.global[slot] as SelectableModelOption) : "未设置"}
                    </span>
                  </div>
                  <select
                    className="input"
                    value={globalDraft[slot] ?? ""}
                    onChange={(event) =>
                      setGlobalDraft((current) => ({
                        ...current,
                        [slot]: event.target.value,
                      }))
                    }
                  >
                    <option value="">保持为空</option>
                    {(globalOptions[slot] ?? []).map((option) => (
                      <option key={option.recordId} value={option.recordId}>
                        {describeOption(option)}
                      </option>
                    ))}
                  </select>
                  <div className="muted">
                    这里只显示已校验可用的模型。
                  </div>
                </div>
              ))}
            </div>

            <div className="action-row">
              <button className="ghost-button" onClick={() => setGlobalDraft(buildDraftFromDefaults(defaults))} type="button">
                恢复到系统当前值
              </button>
              <button className="primary-button" disabled={savingScope === "global"} onClick={requestSaveGlobal} type="button">
                {savingScope === "global" ? "保存中..." : "保存全局兜底"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="section-header">
          <h3>{MODEL_CONTROL_MODE_LABELS[selectedModeId]}默认</h3>
          <span className="muted">这就是该模式新任务创建时真正会固定下来的模型组合</span>
        </div>

        {loading ? (
          <div className="empty-inline">正在加载新任务默认模型...</div>
        ) : (
          <>
            <div className="default-grid">
              {MODEL_CONTROL_SLOT_ORDER.map((slot) => {
                const pool = taskCreationSelectable?.pools?.[slot]
                const effectiveOption = resolveTaskCreationOption(slot)
                return (
                  <div key={slot} className="default-slot-row">
                    <div className="default-slot-row__copy">
                      <strong>{MODEL_CONTROL_SLOT_LABELS[slot]}</strong>
                      <span>全局兜底：{describeOption(globalOptions[slot]?.find((option) => option.recordId === globalDraft[slot]))}</span>
                      <span>新任务默认：{describeOption(pool?.options.find((option) => option.recordId === taskCreationDraft[slot]))}</span>
                      <span>当前有效值：{describeOption(effectiveOption)}</span>
                    </div>
                    <select
                      className="input"
                      value={taskCreationDraft[slot] ?? ""}
                      onChange={(event) =>
                        setTaskCreationDraft((current) => ({
                          ...current,
                          [slot]: event.target.value,
                        }))
                      }
                    >
                      <option value="">使用全局兜底</option>
                      {(pool?.options ?? []).map((option) => (
                        <option key={option.recordId} value={option.recordId}>
                          {describeOption(option)}
                        </option>
                      ))}
                    </select>
                    <div className="muted">
                      当前可选模型：{pool?.options.length ?? 0}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="action-row">
              <button
                className="ghost-button"
                onClick={() => setTaskCreationDraft(buildDraftFromDefaults(defaults, selectedModeId))}
                type="button"
              >
                恢复到系统当前值
              </button>
              <button
                className="primary-button"
                disabled={savingScope === selectedModeId}
                onClick={requestSaveModeDefaults}
                type="button"
              >
                {savingScope === selectedModeId ? "保存中..." : `保存${MODEL_CONTROL_MODE_LABELS[selectedModeId]}`}
              </button>
            </div>
          </>
        )}
      </section>

      <ConfirmActionDialog
        busy={Boolean(savingScope)}
        onClose={() => setConfirmAction(null)}
        state={confirmAction}
      />
    </div>
  )
}
