import { useEffect, useMemo, useState } from "react";
import {
  api,
  type ExecutionMode,
  MODEL_CONTROL_MODE_LABELS,
  MODEL_CONTROL_SLOT_LABELS,
  MODEL_CONTROL_SLOT_ORDER,
  type BootstrapResponse,
  type GenerationPreferenceId,
  type ModelControlModeId,
  type ModelControlSlotType,
  type ProjectRecord,
  type RenderSpec,
  type SelectableModelOption,
  type SelectableModelPoolsResponse,
  type TerminalPresetId,
  type TaskSummary,
} from "../api";

function formatCurrency(value: number) {
  return `¥${value.toFixed(2)}`;
}

function getPreferenceLabel(preference: GenerationPreferenceId) {
  return preference === "system_enhanced" ? "启用系统增强" : "忠于原脚本";
}

function getPreferenceSummary(preference: GenerationPreferenceId) {
  return preference === "system_enhanced"
    ? "系统会保留主题方向，但主动把表达整理成更适合短视频传播的版本。"
    : "系统会尽量保留你原始内容的表达方式，只做最小必要的整理。";
}

function getChannelLabel(channelId: string) {
  if (channelId === "tiktok") {
    return "TikTok";
  }

  if (channelId === "reels") {
    return "Instagram Reels";
  }

  if (channelId === "shorts") {
    return "YouTube Shorts";
  }

  return channelId;
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

function getDefaultTerminalPresetId(channelId: string): TerminalPresetId {
  return channelId === "tiktok" || channelId === "reels" || channelId === "shorts"
    ? "phone_portrait"
    : "phone_portrait";
}

function getRenderSpec(terminalPresetId: TerminalPresetId): RenderSpec {
  return (
    TERMINAL_PRESET_OPTIONS.find((item) => item.id === terminalPresetId)?.renderSpec ??
    TERMINAL_PRESET_OPTIONS[0].renderSpec
  );
}

function pruneOverrides(
  current: Partial<Record<ModelControlSlotType, string>>,
  selectable: SelectableModelPoolsResponse | null,
) {
  if (!selectable) {
    return {};
  }

  return MODEL_CONTROL_SLOT_ORDER.reduce<
    Partial<Record<ModelControlSlotType, string>>
  >((accumulator, slot) => {
    const selectedId = current[slot];
    if (!selectedId) {
      return accumulator;
    }

    const exists = selectable.pools[slot]?.options.some(
      (option) => option.recordId === selectedId,
    );
    if (exists) {
      accumulator[slot] = selectedId;
    }

    return accumulator;
  }, {});
}

function findOption(
  selectable: SelectableModelPoolsResponse | null,
  slot: ModelControlSlotType,
  recordId?: string | null,
) {
  if (!selectable || !recordId) {
    return null;
  }

  return (
    selectable.pools[slot]?.options.find(
      (option) => option.recordId === recordId,
    ) ?? null
  );
}

function describeOption(option: SelectableModelOption | null) {
  if (!option) {
    return "未设置";
  }

  return option.providerDisplayName
    ? `${option.displayName} / ${option.providerDisplayName}`
    : option.displayName;
}

export function HomePage() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [projectId, setProjectId] = useState("project_default");
  const [modeId, setModeId] = useState<ModelControlModeId>("mass_production");
  const [channelId, setChannelId] = useState("tiktok");
  const [terminalPresetId, setTerminalPresetId] =
    useState<TerminalPresetId>("phone_portrait");
  const [targetDurationSec, setTargetDurationSec] = useState(30);
  const [generationPreference, setGenerationPreference] =
    useState<GenerationPreferenceId>("user_locked");
  const [selectablePools, setSelectablePools] =
    useState<SelectableModelPoolsResponse | null>(null);
  const [modelOverrides, setModelOverrides] = useState<
    Partial<Record<ModelControlSlotType, string>>
  >({});
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideError, setOverrideError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
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
        setGenerationPreference(
          bootstrapRes.generationPreferences[0]?.id ?? "user_locked",
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

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    let cancelled = false;

    async function loadSelectablePools() {
      setOverrideLoading(true);
      setOverrideError("");

      try {
        const response = await api.getSelectableModelPools(modeId);
        if (cancelled) {
          return;
        }

        setSelectablePools(response);
        setModelOverrides((current) => pruneOverrides(current, response));
      } catch (err) {
        if (cancelled) {
          return;
        }

        setSelectablePools(null);
        setModelOverrides({});
        setOverrideError(
          err instanceof Error ? err.message : "高级覆盖池加载失败",
        );
      } finally {
        if (!cancelled) {
          setOverrideLoading(false);
        }
      }
    }

    void loadSelectablePools();

    return () => {
      cancelled = true;
    };
  }, [bootstrap, modeId]);

  useEffect(() => {
    setTerminalPresetId(getDefaultTerminalPresetId(channelId));
  }, [channelId]);

  const selectedMode = useMemo(
    () => bootstrap?.modes.find((mode) => mode.id === modeId) ?? null,
    [bootstrap, modeId],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );
  const selectedExecutionMode: ExecutionMode =
    selectedMode?.executionMode ?? "automated";
  const renderSpec = getRenderSpec(terminalPresetId);

  const routePreview =
    targetDurationSec <= (selectedMode?.maxSingleShotSec ?? 8)
      ? "单条成片"
      : "多段成片";
  const routePreviewDetail =
    routePreview === "单条成片"
      ? "这次内容会优先保持一条完整表达，减少切换感。"
      : "这次内容会按多段组织后再合成为完整成片，优先保证表达稳定。";
  const planningSummary = getPreferenceSummary(generationPreference);
  const overrideCount = Object.values(modelOverrides).filter(Boolean).length;
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

  const effectiveSlotSummary = useMemo(
    () =>
      MODEL_CONTROL_SLOT_ORDER.map((slot) => {
        const pool = selectablePools?.pools?.[slot];
        const overrideId = modelOverrides[slot];
        const overrideOption = findOption(selectablePools, slot, overrideId);
        const modeDefaultOption = findOption(
          selectablePools,
          slot,
          pool?.modeDefaultId ?? null,
        );
        const globalDefaultOption = findOption(
          selectablePools,
          slot,
          pool?.globalDefaultId ?? null,
        );
        const effectiveOption =
          overrideOption ??
          findOption(
            selectablePools,
            slot,
            pool?.effectiveId ??
              pool?.modeDefaultId ??
              pool?.globalDefaultId ??
              null,
          );

        return {
          slot,
          overrideOption,
          modeDefaultOption,
          globalDefaultOption,
          effectiveOption,
        };
      }),
    [modelOverrides, selectablePools],
  );

  async function handleCreateTask() {
    if (!title.trim() || !script.trim()) {
      setError("请先填写任务名称和内容母本");
      return;
    }

    if (overrideLoading) {
      setError("高级覆盖池还在刷新，请稍等加载完成后再提交。");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const overridePayload = Object.fromEntries(
        Object.entries(modelOverrides)
          .filter((entry): entry is [ModelControlSlotType, string] =>
            Boolean(entry[1]),
          )
          .map(([slot, modelId]) => [
            slot,
            slot === "ttsProvider" ? { providerId: modelId } : { modelId },
          ]),
      );

      const result = await api.createTask({
        title,
        script,
        projectId,
        modeId,
        channelId,
        terminalPresetId,
        targetDurationSec,
        generationMode: generationPreference,
        modelOverrides: Object.keys(overridePayload).length
          ? overridePayload
          : undefined,
      });
      setTasks((current) => [result.task, ...current]);
      setTitle("");
      setScript("");
      setModelOverrides({});
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
            先把想表达的内容写清楚，系统会负责把它整理成可执行的脚本、画面和成片链路。
          </p>
        </div>
        <div className="topbar-actions">
          <span className="pill">{MODEL_CONTROL_MODE_LABELS[modeId]}</span>
          <span className="pill pill--accent">
            {getChannelLabel(channelId)}
          </span>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

      <div className="workspace-grid">
        <section className="card card--main">
          <h2>内容母本配置</h2>
          <p className="section-note">
            你只需要描述这条视频想讲什么、想给人什么感觉、最后希望用户做什么，系统会完成后续生产规划。
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

          <label className="field-label">生产模式</label>
          <div className="mode-grid" role="radiogroup">
            {bootstrap?.modes.map((mode) => (
              <button
                key={mode.id}
                className={
                  mode.id === modeId
                    ? "mode-card mode-card--active"
                    : "mode-card"
                }
                onClick={() => setModeId(mode.id as ModelControlModeId)}
                type="button"
                role="radio"
                aria-checked={mode.id === modeId}
              >
                <div className="mode-title">{mode.label}</div>
                <div className="mode-description">{mode.description}</div>
                <div className="mode-budget">
                  预算上限 {formatCurrency(mode.budgetLimitCny)} · 单段上限{" "}
                  {mode.maxSingleShotSec}s
                </div>
              </button>
            ))}
          </div>

          <label className="field-label">生成方式</label>
          <div className="generation-grid" role="radiogroup">
            {(bootstrap?.generationPreferences ?? []).map((option) => (
              <button
                key={option.id}
                className={
                  generationPreference === option.id
                    ? "generation-card generation-card--active"
                    : "generation-card"
                }
                onClick={() => setGenerationPreference(option.id)}
                type="button"
                role="radio"
                aria-checked={generationPreference === option.id}
              >
                <div className="generation-card__title">{option.label}</div>
                <div className="generation-card__desc">
                  {option.description}
                </div>
              </button>
            ))}
          </div>

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

          <label className="field-label">目标渠道</label>
          <div className="channel-list" role="radiogroup">
            {bootstrap?.channels.map((channel) => (
              <button
                key={channel.id}
                className={
                  channelId === channel.id
                    ? "channel-card channel-card--active"
                    : "channel-card"
                }
                onClick={() => setChannelId(channel.id)}
                type="button"
                role="radio"
                aria-checked={channelId === channel.id}
              >
                <strong>{channel.label}</strong>
                <span>{channel.description}</span>
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
              <span className="planning-chip__label">内容处理方式</span>
              <strong>{getPreferenceLabel(generationPreference)}</strong>
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
              <span>生产模式</span>
              <strong>
                {selectedMode?.label ?? MODEL_CONTROL_MODE_LABELS[modeId]}
              </strong>
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
              <span>生成方式</span>
              <strong>{getPreferenceLabel(generationPreference)}</strong>
            </div>
            <div className="metric-row">
              <span>目标渠道</span>
              <strong>
                {bootstrap?.channels.find((channel) => channel.id === channelId)
                  ?.label ?? channelId}
              </strong>
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
              <span>模式预算上限</span>
              <strong>
                {formatCurrency(selectedMode?.budgetLimitCny ?? 0)}
              </strong>
            </div>
            <div className="metric-row">
              <span>任务级覆盖</span>
              <strong>
                {overrideCount ? `${overrideCount} 项` : "未启用"}
              </strong>
            </div>
            <div className="muted">{planningSummary}</div>
          </section>

          <section className="card card--compact">
            <h3>默认链路提醒</h3>
            <div className="task-list compact-list">
              <div className="task-item">
                <strong>优先级固定</strong>
                <span>
                  任务覆盖 &gt; 模式默认 &gt;
                  全局默认。没有临时覆盖时，系统会按模式默认解析。
                </span>
              </div>
              <div className="task-item">
                <strong>可选池受校验状态约束</strong>
                <span>
                  高级覆盖只展示 `available` 记录。无论是模型还是
                  TTS，都不会把草稿或失效项放进下拉框。
                </span>
              </div>
              <div className="task-item">
                <strong>创建后会冻结</strong>
                <span>
                  任务一旦创建，最终解析结果会冻结进任务快照，后续默认值变化不会回写历史任务。
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

      <section className="card card--advanced">
        <div className="section-header">
          <h2>任务级高级覆盖</h2>
          <button
            className="ghost-button"
            onClick={() => setOverridesOpen((current) => !current)}
            type="button"
          >
            {overridesOpen ? "收起高级覆盖" : "展开高级覆盖"}
          </button>
        </div>

        <div className="precedence-strip">
          <div className="planning-note-card">
            <strong>模式默认先确定基线</strong>
            <span>
              {MODEL_CONTROL_MODE_LABELS[modeId]} 会先决定每个槽位的默认解。
            </span>
          </div>
          <div className="planning-note-card">
            <strong>只允许真实可选池</strong>
            <span>
              高级覆盖下拉框只读取 `available` 记录，不支持手输临时 ID。
            </span>
          </div>
          <div className="planning-note-card">
            <strong>只提交改动项</strong>
            <span>
              提交任务时只带有值的覆盖项，留空槽位继续走模式默认 / 全局默认。
            </span>
          </div>
        </div>

        {overridesOpen ? (
          <div className="override-panel">
            {overrideError ? (
              <div className="alert">
                模型控制面接口当前不可用，无法提供高级覆盖池：{overrideError}
              </div>
            ) : null}

            {overrideLoading ? (
              <div className="empty-inline">
                正在加载 {MODEL_CONTROL_MODE_LABELS[modeId]} 的真实可选池...
              </div>
            ) : null}

            {!overrideLoading && selectablePools ? (
              <div className="override-grid">
                {MODEL_CONTROL_SLOT_ORDER.map((slot) => {
                  const pool = selectablePools.pools[slot];
                  const overrideId = modelOverrides[slot] ?? "";
                  const overrideOption = findOption(
                    selectablePools,
                    slot,
                    overrideId,
                  );
                  const effectiveOption =
                    overrideOption ??
                    findOption(
                      selectablePools,
                      slot,
                      pool?.effectiveId ??
                        pool?.modeDefaultId ??
                        pool?.globalDefaultId ??
                        null,
                    );

                  return (
                    <div
                      key={slot}
                      className={
                        overrideOption
                          ? "slot-override-card slot-override-card--overridden"
                          : "slot-override-card"
                      }
                    >
                      <div className="slot-override-card__header">
                        <div>
                          <strong>{MODEL_CONTROL_SLOT_LABELS[slot]}</strong>
                          <div className="muted">
                            当前可选 {pool?.options.length ?? 0} 项
                          </div>
                        </div>
                        <span
                          className={
                            overrideOption
                              ? "pill pill--sm pill--accent"
                              : "pill pill--sm"
                          }
                        >
                          {overrideOption ? "已覆盖" : "默认链路"}
                        </span>
                      </div>

                      <select
                        className="input"
                        value={overrideId}
                        onChange={(event) =>
                          setModelOverrides((current) => ({
                            ...current,
                            [slot]: event.target.value,
                          }))
                        }
                      >
                        <option value="">不覆盖，使用默认解析</option>
                        {(pool?.options ?? []).map((option) => (
                          <option key={option.recordId} value={option.recordId}>
                            {describeOption(option)}
                          </option>
                        ))}
                      </select>

                      <div className="slot-override-card__summary">
                        <span>
                          全局默认：
                          {describeOption(
                            findOption(
                              selectablePools,
                              slot,
                              pool?.globalDefaultId ?? null,
                            ),
                          )}
                        </span>
                        <span>
                          模式默认：
                          {describeOption(
                            findOption(
                              selectablePools,
                              slot,
                              pool?.modeDefaultId ?? null,
                            ),
                          )}
                        </span>
                        <span>最终生效：{describeOption(effectiveOption)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="planning-summary-card">
              <strong>当前有效摘要</strong>
              <span>下面展示每个槽位的来源和最终会提交给后端解析的结果。</span>
              <div className="summary-list">
                {effectiveSlotSummary.map((item) => (
                  <div key={item.slot} className="summary-row">
                    <strong>{MODEL_CONTROL_SLOT_LABELS[item.slot]}</strong>
                    <div className="summary-row__detail">
                      <span>
                        全局默认：{describeOption(item.globalDefaultOption)}
                      </span>
                      <span>
                        模式默认：{describeOption(item.modeDefaultOption)}
                      </span>
                      <span>
                        任务覆盖：{describeOption(item.overrideOption)}
                      </span>
                      <span>
                        最终生效：{describeOption(item.effectiveOption)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="action-row">
              <button
                className="ghost-button"
                onClick={() => setModelOverrides({})}
                type="button"
              >
                清空任务级覆盖
              </button>
              <span className="muted">
                当前仅会提交 {overrideCount} 个显式覆盖槽位。
              </span>
            </div>
          </div>
        ) : (
          <div className="planning-notes">
            <div className="planning-note-card">
              <strong>默认路径更适合大多数任务</strong>
              <span>
                不展开高级覆盖时，系统会直接使用当前模式的默认槽位配置。
              </span>
            </div>
            <div className="planning-note-card">
              <strong>只有在你明确知道要替换哪一段时再覆盖</strong>
              <span>
                例如只想切换文案模型或视频模型，就只改对应槽位，其他保持默认。
              </span>
            </div>
            <div className="planning-note-card">
              <strong>高级覆盖不等于永久改默认</strong>
              <span>
                它只影响当前任务；要改全局或模式默认，请去模型控制中心。
              </span>
            </div>
          </div>
        )}
      </section>
      <div className="sticky-action-bar">
        <button
          className="ghost-button"
          onClick={() => {
            setTitle("");
            setScript("");
            setModelOverrides({});
          }}
          type="button"
        >
          清空输入
        </button>
        <button
          className="primary-button"
          disabled={submitting || overrideLoading}
          onClick={handleCreateTask}
          type="button"
        >
          {submitting
            ? "创建中..."
            : overrideLoading
              ? "等待覆盖池刷新..."
              : "启动渲染队列"}
        </button>
      </div>
    </>
  );
}
