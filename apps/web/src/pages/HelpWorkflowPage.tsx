import { Link, Navigate, useParams } from "react-router-dom"
import { HelpFlowDiagram } from "../help-center/components/HelpFlowDiagram"
import { HelpHero } from "../help-center/components/HelpHero"
import { HelpStageList } from "../help-center/components/HelpStageList"
import { featureGuides } from "../help-center/content/features"
import { workflowGuides } from "../help-center/content/workflows"

export function HelpWorkflowPage() {
  const { workflowId } = useParams()
  const workflow = workflowGuides.find((item) => item.id === workflowId) ?? null

  if (!workflowId) {
    return <Navigate to="/help-center" replace />
  }

  if (!workflow) {
    return (
      <div className="workspace-page">
        <div className="empty-state">未找到这个流程说明。</div>
      </div>
    )
  }

  const relatedFeatures = featureGuides.filter((feature) => workflow.relatedFeatureIds.includes(feature.id))

  return (
    <div className="workspace-page">
      <HelpHero
        eyebrow="Workflow Guide"
        title={workflow.title}
        description={workflow.summary}
        tags={["流程图", "操作步骤", "关键判断点"]}
        actions={<Link className="ghost-button" to="/help-center">返回帮助中心</Link>}
      />

      <section className="card">
        <div className="section-header">
          <h2>主流程图</h2>
          <span className="muted">{workflow.audienceNote}</span>
        </div>
        <HelpFlowDiagram stages={workflow.stages} />
      </section>

      <section className="card">
        <div className="section-header">
          <h2>步骤说明</h2>
          <span className="muted">先看整体，再逐段看具体动作</span>
        </div>
        <HelpStageList stages={workflow.stages} />
      </section>

      <section className="card">
        <div className="section-header">
          <h2>关键判断点</h2>
          <span className="muted">这些判断会决定你下一步应该去哪一页继续处理</span>
        </div>
        <ul className="help-bullet-list">
          {workflow.decisionPoints.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>相关功能</h2>
          <span className="muted">继续看具体页面说明</span>
        </div>
        <div className="help-card-grid">
          {relatedFeatures.map((feature) => (
            <Link key={feature.id} className="card help-entry-card" to={`/help-center/features/${feature.id}`}>
              <div className="eyebrow">Feature</div>
              <h3>{feature.title}</h3>
              <p>{feature.purpose}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
