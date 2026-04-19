import type { HelpWorkflowStage } from "../content/types"

type HelpFlowDiagramProps = {
  stages: HelpWorkflowStage[]
}

export function HelpFlowDiagram({ stages }: HelpFlowDiagramProps) {
  return (
    <div className="help-flow">
      {stages.map((stage, index) => (
        <div key={stage.id} className="help-flow__segment">
          <article className="help-flow__card">
            <div className="help-flow__index">{index + 1}</div>
            <div className="help-flow__content">
              <strong>{stage.title}</strong>
              <span>{stage.description}</span>
            </div>
          </article>
          {index < stages.length - 1 ? <div className="help-flow__connector" aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  )
}
