import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  api,
  MODEL_CONTROL_SLOT_LABELS,
  MODEL_CONTROL_SLOT_ORDER,
  type ModelControlDefaults,
  type ModelControlModeId,
  type SelectableModelOption,
  type SelectableModelPoolsResponse,
} from "../api"

type SlotDraft = Partial<Record<(typeof MODEL_CONTROL_SLOT_ORDER)[number], string>>

const emptySlotDraft: SlotDraft = {}
const ACTIVE_TASK_CREATION_MODE: ModelControlModeId = "high_quality"

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

  return `${option.displayName}${option.providerDisplayName ? ` / ${option.providerDisplayName}` : ""}`
}

export function ModelDefaultsPage() {
  const [defaults, setDefaults] = useState<ModelControlDefaults | null>(null)
  const [taskCreationSelectable, setTaskCreationSelectable] = useState<SelectableModelPoolsResponse | null>(null)
  const [globalDraft, setGlobalDraft] = useState<SlotDraft>(emptySlotDraft)
  const [taskCreationDraft, setTaskCreationDraft] = useState<SlotDraft>(emptySlotDraft)
  const [loading, setLoading] = useState(true)
  const [savingScope, setSavingScope] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  async function loadDefaults() {
    setLoading(true)
    setError("")

    try {
      const [defaultsResponse, taskCreationSelectableResponse] = await Promise.all([
        api.getModelDefaults(),
        api.getSelectableModelPools(ACTIVE_TASK_CREATION_MODE),
      ])

      setDefaults(defaultsResponse)
      setTaskCreationSelectable(taskCreationSelectableResponse)
      setGlobalDraft(buildDraftFromDefaults(defaultsResponse))
      setTaskCreationDraft(buildDraftFromDefaults(defaultsResponse, ACTIVE_TASK_CREATION_MODE))
    } catch (err) {
      setError(err instanceof Error ? err.message : "默认模型加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDefaults()
  }, [])

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
      setTaskCreationDraft(buildDraftFromDefaults(response, ACTIVE_TASK_CREATION_MODE))
      setNotice("全局兜底模型已保存。当前以系统返回结果为准。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存全局兜底模型失败")
    } finally {
      setSavingScope(null)
    }
  }

  async function handleSaveTaskCreationDefaults() {
    setSavingScope(ACTIVE_TASK_CREATION_MODE)
    setError("")
    setNotice("")

    try {
      const response = await api.updateModeModelDefaults(ACTIVE_TASK_CREATION_MODE, {
        assignments: toAssignmentPayload(taskCreationDraft),
      })
      setDefaults(response)
      setGlobalDraft(buildDraftFromDefaults(response))
      setTaskCreationDraft(buildDraftFromDefaults(response, ACTIVE_TASK_CREATION_MODE))
      setNotice("新任务默认模型已保存。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存新任务默认模型失败")
    } finally {
      setSavingScope(null)
    }
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
            <span className="pill pill--sm">全局兜底</span>
            <span className="pill pill--sm">新任务默认</span>
            <span className="pill pill--sm">创建时固定</span>
          </div>
        </div>

        <ModelControlNav />
      </section>

      {error ? <div className="alert">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}

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
              <button className="primary-button" disabled={savingScope === "global"} onClick={() => void handleSaveGlobal()} type="button">
                {savingScope === "global" ? "保存中..." : "保存全局兜底"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="section-header">
          <h3>新任务默认</h3>
          <span className="muted">这就是新任务创建时真正会固定下来的模型组合</span>
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
                onClick={() => setTaskCreationDraft(buildDraftFromDefaults(defaults, ACTIVE_TASK_CREATION_MODE))}
                type="button"
              >
                恢复到系统当前值
              </button>
              <button
                className="primary-button"
                disabled={savingScope === ACTIVE_TASK_CREATION_MODE}
                onClick={() => void handleSaveTaskCreationDefaults()}
                type="button"
              >
                {savingScope === ACTIVE_TASK_CREATION_MODE ? "保存中..." : "保存新任务默认"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
