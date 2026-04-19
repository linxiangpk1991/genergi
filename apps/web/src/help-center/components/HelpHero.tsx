import type { ReactNode } from "react"

type HelpHeroProps = {
  eyebrow: string
  title: string
  description: string
  tags?: string[]
  actions?: ReactNode
}

export function HelpHero({ eyebrow, title, description, tags = [], actions }: HelpHeroProps) {
  return (
    <section className="card help-hero">
      <div className="help-hero__copy">
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="help-hero__meta">
        {tags.length ? (
          <div className="planning-summary-tags">
            {tags.map((tag) => (
              <span key={tag} className="pill pill--sm">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        {actions ? <div className="help-hero__actions">{actions}</div> : null}
      </div>
    </section>
  )
}
