import { Link, Navigate, useParams } from "react-router-dom"
import { HelpFeatureSection } from "../help-center/components/HelpFeatureSection"
import { HelpHero } from "../help-center/components/HelpHero"
import { featureGuides } from "../help-center/content/features"
import { workflowGuides } from "../help-center/content/workflows"

export function HelpFeaturePage() {
  const { featureId } = useParams()
  const feature = featureGuides.find((item) => item.id === featureId) ?? null

  if (!featureId) {
    return <Navigate to="/help-center" replace />
  }

  if (!feature) {
    return (
      <div className="workspace-page">
        <div className="empty-state">未找到这个功能说明。</div>
      </div>
    )
  }

  const relatedWorkflows = workflowGuides.filter((workflow) => feature.relatedWorkflowIds.includes(workflow.id))

  return (
    <div className="workspace-page">
      <HelpHero
        eyebrow="Feature Guide"
        title={feature.title}
        description={feature.purpose}
        tags={["功能说明", "常见操作", "相关流程"]}
        actions={<Link className="ghost-button" to="/help-center">返回帮助中心</Link>}
      />

      <section className="help-feature-grid">
        <article className="card help-feature-summary">
          <h3>什么时候用</h3>
          <p>{feature.whenToUse}</p>
        </article>
        <article className="card help-feature-summary">
          <h3>相关流程</h3>
          <div className="help-link-list">
            {relatedWorkflows.length ? (
              relatedWorkflows.map((workflow) => (
                <Link key={workflow.id} to={`/help-center/workflows/${workflow.id}`}>
                  {workflow.title}
                </Link>
              ))
            ) : (
              <span className="muted">当前没有直接绑定的流程说明。</span>
            )}
          </div>
        </article>
      </section>

      {feature.sections.map((section) => (
        <HelpFeatureSection key={section.title} section={section} />
      ))}
    </div>
  )
}
