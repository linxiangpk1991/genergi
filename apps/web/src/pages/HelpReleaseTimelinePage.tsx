import { Link } from "react-router-dom"
import { HelpHero } from "../help-center/components/HelpHero"
import { HelpReleaseTimeline } from "../help-center/components/HelpReleaseTimeline"
import { releaseTimelineEntries } from "../help-center/content/releases"

export function HelpReleaseTimelinePage() {
  const entries = [...releaseTimelineEntries].sort((left, right) => right.versionDate.localeCompare(left.versionDate))

  return (
    <div className="workspace-page">
      <HelpHero
        eyebrow="Release Timeline"
        title="版本更新"
        description="按时间线查看每次版本升级对运营侧带来的实际变化。"
        tags={["时间线浏览", "影响模块", "运营注意"]}
        actions={<Link className="ghost-button" to="/help-center">返回帮助中心</Link>}
      />

      <section className="card">
        <div className="section-header">
          <h2>更新日志时间线</h2>
          <span className="muted">优先看会影响日常流程的变化</span>
        </div>
        <HelpReleaseTimeline entries={entries} />
      </section>
    </div>
  )
}
