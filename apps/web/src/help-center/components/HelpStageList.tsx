import type { HelpWorkflowStage } from "../content/types"

type HelpStageListProps = {
  stages: HelpWorkflowStage[]
}

export function HelpStageList({ stages }: HelpStageListProps) {
  return (
    <div className="help-stage-list">
      {stages.map((stage, index) => (
        <article key={stage.id} className="help-stage-card">
          <div className="help-stage-card__index">Step {index + 1}</div>
          <h3>{stage.title}</h3>
          <p>{stage.description}</p>
          {stage.notes?.length ? (
            <ul className="help-bullet-list">
              {stage.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  )
}
