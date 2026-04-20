import { useEffect, useMemo, useState } from "react";
import {
  api,
  buildAssetCenterUrl,
  buildBatchDashboardUrl,
  type BootstrapResponse,
  type ProjectRecord,
  type RenderSpec,
  type TerminalPresetId,
  type TaskSummary,
} from "../api";

function formatCurrency(value: number) {
  return `¥${value.toFixed(2)}`;
}

function getCreateTaskNotice(task: TaskSummary) {
  return `任务“${task.title}”已提交到渲染队列。关键画面生成完成后，会进入任务审核队列。`;
}

const TERMINAL_PRESET_OPTIONS: Array<{
  id: TerminalPresetId;
  label: string;
  renderSpec: RenderSpec;
}> = [
  {
    id: "phone_portrait",
    label: "手机竖屏",
    renderSpec: {
      terminalPresetId: "phone_portrait",
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
      compositionGuideline: "主体保持在竖屏中心安全区",
      motionGuideline: "优先轻推拉",
    },
  },
  {
    id: "phone_landscape",
    label: "手机横屏",
    renderSpec: {
      terminalPresetId: "phone_landscape",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
      safeArea: { topPct: 8, rightPct: 6, bottomPct: 8, leftPct: 6 },
      compositionGuideline: "主体不宜过小，适合横向叙事",
      motionGuideline: "可用横向推进和平移",
    },
  },
  {
    id: "tablet_portrait",
    label: "平板竖屏",
    renderSpec: {
      terminalPresetId: "tablet_portrait",
      width: 1536,
      height: 2048,
      aspectRatio: "3:4",
      safeArea: { topPct: 7, rightPct: 6, bottomPct: 9, leftPct: 6 },
      compositionGuideline: "保留更多环境空间，主体仍需集中",
      motionGuideline: "可使用更缓的推进",
    },
  },
  {
    id: "tablet_landscape",
    label: "平板横屏",
    renderSpec: {
      terminalPresetId: "tablet_landscape",
      width: 2048,
      height: 1536,
      aspectRatio: "4:3",
      safeArea: { topPct: 7, rightPct: 6, bottomPct: 7, leftPct: 6 },
      compositionGuideline: "适合横向场景展开",
      motionGuideline: "允许横向环境展开",
    },
  },
];

function getRenderSpec(terminalPresetId: TerminalPresetId): RenderSpec {
  return (
    TERMINAL_PRESET_OPTIONS.find((item) => item.id === terminalPresetId)?.renderSpec ??
    TERMINAL_PRESET_OPTIONS[0].renderSpec
  );
}

export function HomePage() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [projectId, setProjectId] = useState("project_default");
  const [terminalPresetId, setTerminalPresetId] =
    useState<TerminalPresetId>("phone_portrait");
  const [targetDurationSec, setTargetDurationSec] = useState(30);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createdTask, setCreatedTask] = useState<TaskSummary | null>(null);
  const [tasksUpdatedAt, setTasksUpdatedAt] = useState<string>("");

  useEffect(() => {
    async function load() {
      try {
        const [bootstrapRes, taskRes, projectRes] = await Promise.all([
          api.bootstrap(),
          api.listTasks(),
          api.listProjects(),
        ]);
        setBootstrap(bootstrapRes);
        setTasks(taskRes.tasks);
        setProjects(projectRes.projects);
        if (projectRes.projects[0]?.id) {
          setProjectId(projectRes.projects[0].id);
        }
        setTasksUpdatedAt(new Date().toLocaleTimeString("zh-CN"));
        setTargetDurationSec(
          bootstrapRes.durationOptions[1] ??
            bootstrapRes.durationOptions[0] ??
            30,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    }

    void load();

    const timer = window.setInterval(() => {
      void api
        .listTasks()
        .then((taskRes) => {
          setTasks(taskRes.tasks);
          setTasksUpdatedAt(new Date().toLocaleTimeString("zh-CN"));
        })
        .catch(() => {});
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );
  const renderSpec = getRenderSpec(terminalPresetId);
  const selectedExecutionMode = "review_required";

  const routePreview =
    targetDurationSec <= 8
      ? "单条成片"
      : "多段成片";
  const routePreviewDetail =
    routePreview === "单条成片"
      ? "这次内容会优先保持一条完整表达，减少切换感。"
      : "这次内容会按多段组织后再合成为完整成片，优先保证表达稳定。";
  const planningSummary = "系统只会按母本保真优先做结构化分镜，不会主动改变主题、人物、场景和内容领域。";
  const taskStatusSummary = useMemo(() => {
    const runningCount = tasks.filter(
      (task) => task.status === "running",
    ).length;
    const completedCount = tasks.filter(
      (task) => task.status === "completed",
    ).length;
    const failedCount = tasks.filter((task) => task.status === "failed").length;
    return { runningCount, completedCount, failedCount };
  }, [tasks]);
  const recentTasks = useMemo(
    () =>
      [...tasks]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 3),
    [tasks],
  );

  async function handleCreateTask() {
    if (!title.trim() || !script.trim()) {
      setNotice("");
      setCreatedTask(null);
      setError("请先填写任务名称和内容母本");
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice("");
    setCreatedTask(null);
    try {
      const result = await api.createTask({
        title,
        script,
        projectId,
        terminalPresetId,
        targetDurationSec,
      });
      setTasks((current) => [result.task, ...current]);
      setNotice(getCreateTaskNotice(result.task));
      setCreatedTask(result.task);
      setTitle("");
      setScript("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="empty-state">GENERGI 正在加载工作台...</div>;
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">GENERGI Command Center</div>
          <h1>新建生产任务</h1>
          <p>
            先把内容母本写清楚，再只用时长和尺寸约束系统。平台会按保真优先的单一路径生成蓝图、关键画面和成片。
          </p>
        </div>
        <div className="topbar-actions">
          <span className="pill">单一路径</span>
          <span className="pill pill--accent">审核优先</span>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}
      {notice && createdTask ? (
        <section className="planning-summary-card">
          <strong>提交成功</strong>
          <span>{notice}</span>
          <div className="planning-summary-tags">
            <a className="ghost-button" href={buildBatchDashboardUrl(createdTask.id)}>
              查看生产看板
            </a>
            <a className="ghost-button" href={buildAssetCenterUrl(createdTask.id)}>
              打开任务资产
            </a>
          </div>
        </section>
      ) : null}

      <div className="workspace-grid">
        <section className="card card--main">
          <h2>内容母本配置</h2>
          <p className="section-note">
            你只需要描述这条视频想讲什么。系统只负责结构化拆分和镜头化表达，不会主动改题材、换人物或替你重写内容方向。
          </p>

          <label className="field-label">任务名称</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：夏季新品种草短视频"
          />

          <label className="field-label">内容母本</label>
          <textarea
            className="textarea"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="直接写你要表达的内容、卖点、情绪和转化目标，不需要手动写技术提示词。"
          />

          <label className="field-label">正片总时长</label>
          <div className="mode-grid" role="radiogroup">
            {bootstrap?.durationOptions.map((duration) => (
              <button
                key={duration}
                className={
                  duration === targetDurationSec
                    ? "mode-card mode-card--active"
                    : "mode-card"
                }
                onClick={() => setTargetDurationSec(duration)}
                type="button"
                role="radio"
                aria-checked={duration === targetDurationSec}
              >
                <div className="mode-title">{duration}s</div>
                <div className="mode-description">
                  用于控制最终成片节奏与信息密度
                </div>
              </button>
            ))}
          </div>

          <label className="field-label">所属项目</label>
          <select
            className="input"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <label className="field-label">终端预设</label>
          <select
            className="input"
            value={terminalPresetId}
            onChange={(event) =>
              setTerminalPresetId(event.target.value as TerminalPresetId)
            }
          >
            {TERMINAL_PRESET_OPTIONS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label} · {preset.renderSpec.width} × {preset.renderSpec.height}
              </option>
            ))}
          </select>

          <div className="planning-strip">
            <div className="planning-chip">
              <span className="planning-chip__label">成片组织方式</span>
              <strong>{routePreview}</strong>
              <span>{routePreviewDetail}</span>
            </div>
            <div className="planning-chip">
              <span className="planning-chip__label">文本规划原则</span>
              <strong>保真优先</strong>
              <span>{planningSummary}</span>
            </div>
            <div className="planning-chip">
              <span className="planning-chip__label">执行方式</span>
              <strong>{selectedExecutionMode}</strong>
              <span>
                {selectedExecutionMode === "review_required"
                  ? "关键画面与提示词审核通过后，才继续完整视频生成。"
                  : "关键画面完成后会自动继续生成视频。"}
              </span>
            </div>
            <div className="planning-chip">
              <span className="planning-chip__label">终端规格</span>
              <strong>{renderSpec.width} × {renderSpec.height}</strong>
              <span>{renderSpec.aspectRatio} · {renderSpec.compositionGuideline}</span>
            </div>
          </div>
        </section>

        <aside className="side-panel">
          <section className="card card--compact">
            <h3>本次任务摘要</h3>
            <div className="metric-row">
              <span>所属项目</span>
              <strong>{selectedProject?.name ?? "未选择"}</strong>
            </div>
            <div className="metric-row">
              <span>任务路径</span>
              <strong>单一路径</strong>
            </div>
            <div className="metric-row">
              <span>执行方式</span>
              <strong>{selectedExecutionMode}</strong>
            </div>
            <div className="metric-row">
              <span>目标正片长度</span>
              <strong>{targetDurationSec}s</strong>
            </div>
            <div className="metric-row">
              <span>文本规划原则</span>
              <strong>保真优先</strong>
            </div>
            <div className="metric-row">
              <span>成片组织</span>
              <strong>{routePreview}</strong>
            </div>
            <div className="metric-row">
              <span>终端预设</span>
              <strong>
                {TERMINAL_PRESET_OPTIONS.find((item) => item.id === terminalPresetId)?.label ?? terminalPresetId}
              </strong>
            </div>
            <div className="metric-row">
              <span>输出规格</span>
              <strong>{renderSpec.width} × {renderSpec.height}</strong>
            </div>
            <div className="metric-row">
              <span>画面比例</span>
              <strong>{renderSpec.aspectRatio}</strong>
            </div>
            <div className="metric-row">
              <span>默认执行链</span>
              <strong>关键画面审核后继续完整生成</strong>
            </div>
            <div className="muted">{planningSummary}</div>
          </section>

          <section className="card card--compact">
            <h3>系统约束</h3>
            <div className="task-list compact-list">
              <div className="task-item">
                <strong>内容保真优先</strong>
                <span>
                  系统只允许按母本做结构化拆分，不会主动增强钩子、改写 CTA 或切换内容题材。
                </span>
              </div>
              <div className="task-item">
                <strong>尺寸和时长仍然生效</strong>
                <span>
                  系统会基于目标时长和当前模型单段上限决定单条成片或多分镜编排，但不会改变内容主题。
                </span>
              </div>
              <div className="task-item">
                <strong>创建后冻结</strong>
                <span>
                  任务创建后会冻结到统一的审核优先链路，后续不会因为默认值变化而回写历史任务。
                </span>
              </div>
            </div>
          </section>

          <section className="card card--compact">
            <h3>最近活动</h3>
            <div className="planning-summary-tags" style={{ marginBottom: 10 }}>
              <span className="pill pill--sm">
                运行中 {taskStatusSummary.runningCount}
              </span>
              <span className="pill pill--sm">
                已完成 {taskStatusSummary.completedCount}
              </span>
              {taskStatusSummary.failedCount ? (
                <span className="pill pill--sm">
                  异常 {taskStatusSummary.failedCount}
                </span>
              ) : null}
            </div>
            <div className="muted" style={{ marginBottom: 10 }}>
              最近刷新：{tasksUpdatedAt || "刚刚进入页面"}
            </div>
            <div className="task-list compact-list">
              {recentTasks.map((task) => (
                <div
                  key={task.id}
                  className={
                    task.status === "running"
                      ? "task-item task-item--running"
                      : "task-item"
                  }
                >
                  <strong>
                    {task.status === "running" && (
                      <span className="status-dot status-dot--running" />
                    )}{" "}
                    {task.title}
                  </strong>
                  <span>
                    {task.targetDurationSec}s · {task.status} ·{" "}
                    {task.actualDurationSec
                      ? `实际 ${task.actualDurationSec.toFixed(1)}s`
                      : "生成中"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <div className="sticky-action-bar">
        <button
          className="ghost-button"
          onClick={() => {
            setTitle("");
            setScript("");
          }}
          type="button"
        >
          清空输入
        </button>
        <button
          className="primary-button"
          disabled={submitting}
          onClick={handleCreateTask}
          type="button"
        >
          {submitting
            ? "创建中..."
            : "启动渲染队列"}
        </button>
      </div>
    </>
  );
}
