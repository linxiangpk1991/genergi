import type { HelpFeatureSection as HelpFeatureSectionModel } from "../content/types"

type HelpFeatureSectionProps = {
  section: HelpFeatureSectionModel
}

export function HelpFeatureSection({ section }: HelpFeatureSectionProps) {
  return (
    <section className="card help-feature-section">
      <h3>{section.title}</h3>
      <ul className="help-bullet-list">
        {section.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </section>
  )
}
