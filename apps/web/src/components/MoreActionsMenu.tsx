import { useEffect, useRef, useState } from "react"

export type MoreActionItem = {
  label: string
  description?: string
  href?: string
  disabled?: boolean
  tone?: "default" | "danger"
  onSelect?: () => void
}

type MoreActionsMenuProps = {
  label?: string
  ariaLabel?: string
  align?: "left" | "right"
  items: MoreActionItem[]
}

export function MoreActionsMenu({
  label = "更多",
  ariaLabel,
  align = "right",
  items,
}: MoreActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  function handleSelect(item: MoreActionItem) {
    if (item.disabled) {
      return
    }
    setOpen(false)
    item.onSelect?.()
  }

  return (
    <div className="more-actions" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel ?? label}
        className="ghost-button ghost-button--compact more-actions__trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {label}
      </button>
      {open ? (
        <div className={`more-actions__menu more-actions__menu--${align}`} role="menu">
          {items.map((item) => {
            const className = item.tone === "danger" ? "more-actions__item more-actions__item--danger" : "more-actions__item"
            const content = (
              <>
                <strong>{item.label}</strong>
                {item.description ? <span className="more-actions__description">{item.description}</span> : null}
              </>
            )

            if (item.href && !item.disabled) {
              return (
                <a className={className} href={item.href} key={item.label} role="menuitem">
                  {content}
                </a>
              )
            }

            return (
              <button
                aria-disabled={item.disabled || undefined}
                className={className}
                disabled={item.disabled}
                key={item.label}
                onClick={() => handleSelect(item)}
                role="menuitem"
                type="button"
              >
                {content}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
