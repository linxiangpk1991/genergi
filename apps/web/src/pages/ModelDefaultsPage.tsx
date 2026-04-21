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
      setError(err instanceof Error ? err.message : "Defaults Center 加载失败")
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
      setNotice("全局默认值已提交。当前以真实后端响应为准。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存全局默认值失败")
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
      setNotice("任务创建默认值已提交。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存任务创建默认值失败")
    } finally {
      setSavingScope(null)
    }
  }

  return (
    <div className="workspace-page">
      <section className="card">
        <div className="section-header section-header--stack">
          <div>
            <div className="eyebrow">Defaults Center</div>
            <h2>默认值中心</h2>
            <p className="section-note">
              这里不负责“模拟解析”，而是直接展示和提交真实默认值配置。任务创建时会把当前有效值冻结为任务快照。
            </p>
          </div>
          <div className="planning-summary-tags">
            <span className="pill pill--sm">全局兜底</span>
            <span className="pill pill--sm">任务创建默认值</span>
            <span className="pill pill--sm">创建时冻结</span>
          </div>
        </div>

        <ModelControlNav />
      </section>

      {error ? <div className="alert">{error}</div> : null}
      {notice ? <div className="empty-state">{notice}</div> : null}

      <section className="card">
        <div className="section-header">
          <h3>优先级说明</h3>
          <span className="muted">冻结关系说明</span>
        </div>
        <div className="precedence-strip">
          <div className="planning-note-card">
            <strong>任务冻结快照</strong>
            <span>任务创建时会把当前有效默认值冻结到 taskRunConfig，之后历史任务不再跟随后续默认值变化。</span>
          </div>
          <div className="planning-note-card">
            <strong>任务创建默认值</strong>
            <span>这套值就是新任务真正会命中的运行时默认值，会覆盖全局兜底。</span>
          </div>
          <div className="planning-note-card">
            <strong>全局默认</strong>
            <span>作为单一路径任务创建的兜底值，只有任务创建默认值没有指定时才会生效。</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>全局默认</h3>
          <span className="muted">给单一路径任务创建提供兜底槽位选择</span>
        </div>

        {loading ? (
          <div className="empty-inline">正在加载真实默认值...</div>
        ) : (
          <>
            <div className="default-grid">
              {MODEL_CONTROL_SLOT_ORDER.map((slot) => (
                <div key={slot} className="default-slot-row">
                  <div className="default-slot-row__copy">
                    <strong>{MODEL_CONTROL_SLOT_LABELS[slot]}</strong>
                    <span>
                      当前后端值：{defaults?.global?.[slot]?.displayName ? describeOption(defaults.global[slot] as SelectableModelOption) : "未设置"}
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
                    可选项仅来自 `available` 池。
                  </div>
                </div>
              ))}
            </div>

            <div className="action-row">
              <button className="ghost-button" onClick={() => setGlobalDraft(buildDraftFromDefaults(defaults))} type="button">
                恢复到后端当前值
              </button>
              <button className="primary-button" disabled={savingScope === "global"} onClick={() => void handleSaveGlobal()} type="button">
                {savingScope === "global" ? "保存中..." : "保存全局默认"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="section-header">
          <h3>任务创建默认值</h3>
          <span className="muted">这就是新任务创建时真正会冻结进 taskRunConfig 的默认组合</span>
        </div>

        {loading ? (
          <div className="empty-inline">正在加载任务创建默认值...</div>
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
                      <span>任务创建值：{describeOption(pool?.options.find((option) => option.recordId === taskCreationDraft[slot]))}</span>
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
                      <option value="">回退到全局默认</option>
                      {(pool?.options ?? []).map((option) => (
                        <option key={option.recordId} value={option.recordId}>
                          {describeOption(option)}
                        </option>
                      ))}
                    </select>
                    <div className="muted">
                      当前池有效项：{pool?.options.length ?? 0}
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
                恢复到后端当前值
              </button>
              <button
                className="primary-button"
                disabled={savingScope === ACTIVE_TASK_CREATION_MODE}
                onClick={() => void handleSaveTaskCreationDefaults()}
                type="button"
              >
                {savingScope === ACTIVE_TASK_CREATION_MODE ? "保存中..." : "保存任务创建默认值"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
