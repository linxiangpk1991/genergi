import { useEffect, useMemo, useState } from "react"
import { api, type ProjectApprovedBlueprintRecord, type ProjectRecord } from "../api"

export function ProjectLibraryPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [entries, setEntries] = useState<ProjectApprovedBlueprintRecord[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const result = await api.listProjects()
        if (!active) {
          return
        }
        setProjects(result.projects)
        const nextProjectId = result.projects[0]?.id ?? ""
        setSelectedProjectId(nextProjectId)
        if (nextProjectId) {
          const library = await api.getProjectLibrary(nextProjectId)
          if (!active) {
            return
          }
          setEntries(library.entries)
        }
      } catch (loadError) {
        if (!active) {
          return
        }
        setError(loadError instanceof Error ? loadError.message : "项目模板库加载失败")
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedProjectId) {
      setEntries([])
      return
    }

    let active = true
    void api.getProjectLibrary(selectedProjectId)
      .then((result) => {
        if (active) {
          setEntries(result.entries)
          setError("")
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "项目模板库加载失败")
        }
      })

    return () => {
      active = false
    }
  }, [selectedProjectId])

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )

  return (
    <div className="workspace-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">项目模板库</div>
          <h1>项目模板库</h1>
          <p>这里只沉淀审核通过的方案，方便后续任务复用同样的风格、生成说明和关键画面规则。</p>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

      <section className="card">
        <label className="field-label">项目选择</label>
        <select
          className="input"
          value={selectedProjectId}
          onChange={(event) => setSelectedProjectId(event.target.value)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <div className="planning-summary-card">
          <strong>{selectedProject?.name ?? "未选择项目"}</strong>
          <span>{selectedProject?.description ?? "当前项目还没有额外说明。"}</span>
          <span>
            默认画面参考：{selectedProject?.defaultVisualSeedInput || "未设置，任务启动时按视频内容自动补全"}
          </span>
          <span>
            默认关键画面生成：{selectedProject?.defaultKeyframeGenerationMode === "single" ? "单张生成" : "批量生成"}
          </span>
        </div>

        <div className="task-list">
          {entries.length ? (
            entries.map((entry) => (
              <section key={`${entry.taskId}-${entry.blueprintVersion}`} className="form-section">
                <div className="section-header">
                  <div>
                    <h3>{`任务 ${entry.taskId}`}</h3>
                    <span className="muted">{`方案 v${entry.blueprintVersion}`}</span>
                  </div>
                  <span className="pill pill--sm">{entry.approvedAt}</span>
                </div>
                <div className="review-block">
                  <label className="field-label">总旁白稿</label>
                  <div className="review-content">{entry.blueprint.totalVoiceoverScript}</div>
                </div>
                <div className="review-block">
                  <label className="field-label">全局风格</label>
                  <div className="review-content">{entry.blueprint.visualStyleGuide}</div>
                </div>
              </section>
            ))
          ) : (
            <div className="empty-inline">当前项目还没有审核通过的方案沉淀。</div>
          )}
        </div>
      </section>
    </div>
  )
}
