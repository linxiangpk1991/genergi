import { Link } from "react-router-dom"
import { HelpHero } from "../help-center/components/HelpHero"
import { featureGuides } from "../help-center/content/features"
import { releaseTimelineEntries } from "../help-center/content/releases"
import { workflowGuides } from "../help-center/content/workflows"

export function HelpCenterHomePage() {
  const recentReleases = [...releaseTimelineEntries]
    .sort((left, right) => right.versionDate.localeCompare(left.versionDate))
    .slice(0, 3)

  return (
    <div className="workspace-page">
      <HelpHero
        eyebrow="Help Center"
        title="帮助中心"
        description="按流程学习整个平台的使用方式，按功能快速查阅页面说明，并在时间线里查看每次版本更新。"
        tags={["按流程学习", "按功能查阅", "版本更新"]}
        actions={
          <Link className="primary-button" to="/help-center/releases">
            查看更新时间线
          </Link>
        }
      />

      <section className="card">
        <div className="section-header">
          <h2>按流程学习</h2>
          <span className="muted">适合第一次上手或需要理解整条工作链时使用</span>
        </div>
        <div className="help-card-grid help-card-grid--wide">
          {workflowGuides.map((workflow) => (
            <Link key={workflow.id} className="card help-entry-card" to={`/help-center/workflows/${workflow.id}`}>
              <div className="eyebrow">Workflow</div>
              <h3>{workflow.title}</h3>
              <p>{workflow.summary}</p>
              <span className="muted">{workflow.audienceNote}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>按功能查阅</h2>
          <span className="muted">适合日常操作时快速定位某个页面或模块</span>
        </div>
        <div className="help-card-grid">
          {featureGuides.map((feature) => (
            <Link key={feature.id} className="card help-entry-card" to={`/help-center/features/${feature.id}`}>
              <div className="eyebrow">Feature</div>
              <h3>{feature.title}</h3>
              <p>{feature.purpose}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>最近更新</h2>
          <Link className="ghost-button" to="/help-center/releases">
            查看完整时间线
          </Link>
        </div>
        <div className="help-release-preview">
          {recentReleases.map((entry) => (
            <article key={entry.id} className="help-release-preview__item">
              <strong>{entry.title}</strong>
              <span>{entry.versionDate}</span>
              <p>{entry.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
