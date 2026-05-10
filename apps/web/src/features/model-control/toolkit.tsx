import { NavLink } from "react-router-dom"
import type { ReactNode } from "react"
import type {
  ModelControlLifecycleStatus,
  ModelControlModeId,
  ModelControlSlotType,
  ModelControlSelection,
  SelectableModelPoolsResponse,
} from "../../api"
import { MODEL_CONTROL_MODE_LABELS, MODEL_CONTROL_SLOT_LABELS } from "../../api"

const MODEL_CONTROL_NAV_ITEMS = [
  { to: "/model-control-center", label: "总览" },
  { to: "/model-control-center/providers", label: "接入方" },
  { to: "/model-control-center/registry", label: "模型路由" },
  { to: "/model-control-center/defaults", label: "默认与覆盖" },
  { to: "/model-control-center/routing", label: "路由策略" },
  { to: "/model-control-center/diagnostics", label: "诊断记录" },
]

const STATUS_COPY: Record<ModelControlLifecycleStatus, { label: string; detail: string }> = {
  draft: { label: "未检查", detail: "保存后需要检查配置，检查通过后才会进入默认模型池。" },
  validating: { label: "检查中", detail: "系统正在检查配置，完成前不会进入默认模型池。" },
  available: { label: "可用", detail: "已通过检查，可用于默认模型和任务覆盖。" },
  invalid: { label: "异常", detail: "检查未通过，请查看错误信息后修正。" },
  disabled: { label: "已停用", detail: "不会再进入新任务默认模型池。" },
  deprecated: { label: "已弃用", detail: "保留历史记录，不建议继续用于新任务。" },
}

export function ModelControlNav() {
  return (
    <nav className="model-control-nav" aria-label="模型管理菜单">
      {MODEL_CONTROL_NAV_ITEMS.map((item) => (
        <NavLink
          className={({ isActive }) =>
            isActive ? "model-control-nav__item model-control-nav__item--active" : "model-control-nav__item"
          }
          end={item.to === "/model-control-center"}
          key={item.to}
          to={item.to}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function ModelStatusBadge({ status }: { status: ModelControlLifecycleStatus }) {
  const copy = STATUS_COPY[status]
  return (
    <span className={`model-status-badge model-status-badge--${status}`} title={copy.detail}>
      <span aria-hidden="true" className="model-status-badge__dot" />
      {copy.label}
    </span>
  )
}

export function getLifecycleDetail(status: ModelControlLifecycleStatus) {
  return STATUS_COPY[status].detail
}

export function CapabilityTags({ value }: { value: Record<string, unknown> | null | undefined }) {
  const entries = Object.entries(value ?? {}).filter(([key]) => key !== "routingProfile")
  if (!entries.length) {
    return <span className="muted">尚未提供能力元数据</span>
  }
  const supportsBatchKeyframes = value?.supportsBatchKeyframes === true
  const maxBatchImages = typeof value?.maxBatchImages === "number" ? value.maxBatchImages : null
  return (
    <div className="capability-list">
      {supportsBatchKeyframes ? (
        <code className="capability-pill capability-pill--success">
          批量关键画面: 最多 {maxBatchImages ?? 4} 张
        </code>
      ) : null}
      {entries.map(([key, item]) => (
        <code className="capability-pill" key={key}>
          {key}: {String(item)}
        </code>
      ))}
    </div>
  )
}

export function ModelControlNotice({
  tone,
  children,
}: {
  tone: "success" | "warning" | "error" | "info"
  children: ReactNode
}) {
  return <div className={`model-control-notice model-control-notice--${tone}`}>{children}</div>
}

export type ConfirmActionState = {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
} | null

export function ConfirmActionDialog({
  state,
  busy,
  onClose,
}: {
  state: ConfirmActionState
  busy?: boolean
  onClose: () => void
}) {
  if (!state) {
    return null
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="modal-card model-confirm-dialog" role="dialog">
        <div className="section-header">
          <h3>{state.title}</h3>
          <button className="ghost-button ghost-button--compact" disabled={busy} onClick={onClose} type="button">
            关闭
          </button>
        </div>
        <p className="section-note">{state.body}</p>
        <div className="action-row">
          <button className="ghost-button" disabled={busy} onClick={onClose} type="button">
            取消
          </button>
          <button
            className={state.danger ? "danger-button" : "primary-button"}
            disabled={busy}
            onClick={() => void state.onConfirm()}
            type="button"
          >
            {busy ? "处理中..." : state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function describeSelection(selection: ModelControlSelection | null | undefined) {
  if (!selection?.recordId) {
    return "未设置"
  }
  return selection.displayName ?? selection.recordId
}

export function EffectiveDefaultsPanel({
  modeId,
  defaults,
  pools,
}: {
  modeId: ModelControlModeId
  defaults: {
    global: Partial<Record<ModelControlSlotType, ModelControlSelection | null>>
    modes: Partial<Record<ModelControlModeId, Partial<Record<ModelControlSlotType, ModelControlSelection | null>>>>
  } | null
  pools: SelectableModelPoolsResponse | null
}) {
  return (
    <section className="effective-defaults-panel">
      <div className="section-header">
        <div>
          <h3>当前新任务生效组合</h3>
          <p className="section-note">
            当前模式：{MODEL_CONTROL_MODE_LABELS[modeId]}。这里显示任务创建时会被冻结的四个模型槽位。
          </p>
        </div>
      </div>
      <div className="effective-defaults-grid">
        {(Object.keys(MODEL_CONTROL_SLOT_LABELS) as ModelControlSlotType[]).map((slot) => {
          const modeSelection = defaults?.modes?.[modeId]?.[slot] ?? null
          const globalSelection = defaults?.global?.[slot] ?? null
          const pool = pools?.pools?.[slot]
          const effectiveId = modeSelection?.recordId ?? globalSelection?.recordId ?? null
          const matched = effectiveId ? pool?.options.find((option) => option.recordId === effectiveId) : null
          const isStale = Boolean(effectiveId && !matched)
          return (
            <div className={isStale ? "effective-default-card effective-default-card--risk" : "effective-default-card"} key={slot}>
              <span>{MODEL_CONTROL_SLOT_LABELS[slot]}</span>
              <strong>{matched?.displayName ?? describeSelection(modeSelection ?? globalSelection)}</strong>
              <small>
                {isStale
                  ? "当前默认已不可用，请重选"
                  : modeSelection?.recordId
                    ? "来源：模式默认"
                    : globalSelection?.recordId
                      ? "来源：全局兜底"
                      : "未配置"}
              </small>
              <small>可选模型：{pool?.options.length ?? 0}</small>
            </div>
          )
        })}
      </div>
    </section>
  )
}
