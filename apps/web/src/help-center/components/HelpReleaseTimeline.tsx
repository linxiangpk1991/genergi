import type { HelpReleaseEntry } from "../content/types"

type HelpReleaseTimelineProps = {
  entries: HelpReleaseEntry[]
}

export function HelpReleaseTimeline({ entries }: HelpReleaseTimelineProps) {
  return (
    <div className="help-release-timeline">
      {entries.map((entry) => (
        <article key={entry.id} className="card help-release-card">
          <div className="help-release-card__date">{entry.versionDate}</div>
          <div className="help-release-card__body">
            <h3>{entry.title}</h3>
            <p>{entry.summary}</p>
            <div className="planning-summary-tags">
              {entry.affectedFeatureIds.map((featureId) => (
                <span key={featureId} className="pill pill--sm">
                  {featureId}
                </span>
              ))}
            </div>
            <div className="help-release-card__grid">
              <div>
                <strong>运营注意</strong>
                <ul className="help-bullet-list">
                  {entry.operatorNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>流程变化</strong>
                <ul className="help-bullet-list">
                  {entry.workflowChanges.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
