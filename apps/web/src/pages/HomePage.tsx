import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  buildAssetCenterUrl,
  buildBatchDashboardUrl,
  buildTaskReviewUrl,
  getSubtitleStrategyLabel,
  MODEL_CONTROL_MODE_LABELS,
  MODEL_CONTROL_SLOT_LABELS,
  MODEL_CONTROL_SLOT_ORDER,
  type BootstrapResponse,
  type BilingualUnderstandingPreview,
  type EnglishExecutionBrief,
  type ModelControlModeId,
  type ModelControlSlotType,
  type ModelRoutePreviewResponse,
  type KeyframeGenerationMode,
  type ProjectRecord,
  type RenderSpec,
  type SelectableModelOption,
  type SubtitleStrategy,
  type SelectableModelPoolsResponse,
  type TerminalPresetId,
  type TaskSummary,
} from "../api";
import {
  estimateLaunchProduction,
  findSimilarLaunchTasks,
  getLaunchReadiness,
} from "./homePageLaunchGuards";

function getCreateTaskNotice(task: TaskSummary) {
  return `任务“${task.title}”已提交。系统会先准备生成方案和关键画面，等你审核通过后再继续生成正片。`;
}

type FloatingToastState = {
  tone: "success" | "error"
  message: string
}

type FieldErrors = {
  title?: string
  script?: string
}

type DraftPayload = {
  title: string
  script: string
  visualSeedInput: string
  projectId: string
  modeId: ModelControlModeId
  terminalPresetId: TerminalPresetId
  targetDurationSec: number
  keyframeGenerationMode: KeyframeGenerationMode
  audioStrategy: "tts_only" | "native_plus_tts_ducked"
  subtitleStrategy: SubtitleStrategy
  modelOverrides?: Partial<Record<ModelControlSlotType, string>>
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

const AUDIO_STRATEGY_OPTIONS = [
  {
    id: "tts_only" as const,
    label: "系统配音",
    description: "使用稳定的系统配音作为主音轨，适合大多数任务。",
  },
  {
    id: "native_plus_tts_ducked" as const,
    label: "保留环境音 + 系统配音",
    description: "保留视频自带环境音，再叠加旁白，画面会更有现场感。",
  },
]

const SUBTITLE_STRATEGY_OPTIONS: Array<{
  id: SubtitleStrategy
  label: string
  description: string
}> = [
  {
    id: "tts_aligned",
    label: "跟随配音生成字幕",
    description: "字幕直接跟随系统配音时间轴，稳定、速度快。",
  },
  {
    id: "whisper_cpp",
    label: "从成片音频识别字幕",
    description: "从最终音频里识别字幕，适合后续保留更多原生声音的任务。",
  },
]

const LAUNCH_DRAFT_STORAGE_KEY = "genergi.task-launch.draft.v1"
const DEFAULT_LAUNCH_MODE_ID: ModelControlModeId = "high_quality"

const SCRIPT_TEMPLATES = [
  {
    id: "product-seeding",
    label: "新品种草",
    body:
      "目标人群：\n产品/主题：\n核心卖点：\n使用场景：\n情绪语气：可信、轻松、有画面感\nCTA：引导用户了解或购买\n禁止改动项：品牌名、产品名、核心卖点不要改写",
  },
  {
    id: "feature-demo",
    label: "功能演示",
    body:
      "目标人群：\n痛点：\n功能亮点：\n演示场景：\n结果对比：\nCTA：引导用户尝试或咨询\n禁止改动项：功能边界和使用步骤不要夸大",
  },
  {
    id: "promo",
    label: "优惠活动",
    body:
      "目标人群：\n活动内容：\n核心利益点：\n适用场景：\n紧迫感：\nCTA：引导用户立即行动\n禁止改动项：优惠条件、时间和限制不要改写",
  },
]

function getLaunchDraftStorageKey(operator: string | undefined) {
  return operator ? `${LAUNCH_DRAFT_STORAGE_KEY}.${operator}` : LAUNCH_DRAFT_STORAGE_KEY
}

function getStoredLaunchDraft(operator: string | undefined): Partial<DraftPayload> | null {
  try {
    const raw = window.localStorage.getItem(getLaunchDraftStorageKey(operator))
    return raw ? (JSON.parse(raw) as Partial<DraftPayload>) : null
  } catch {
    return null
  }
}

function getTaskStatusLabel(task: TaskSummary) {
  if (task.status === "waiting_review" || task.blueprintStatus === "ready_for_review") {
    return "待审核"
  }
  if (task.status === "running" || task.status === "queued") {
    return "生成中"
  }
  if (task.status === "failed") {
    return "异常"
  }
  if (task.status === "completed") {
    return "已完成"
  }
  if (task.status === "canceling" || task.status === "canceled") {
    return "已取消"
  }
  return "待处理"
}

function getChannelLabel(channelIds: string[]) {
  const primaryChannel = channelIds[0] ?? "tiktok"
  const labels: Record<string, string> = {
    tiktok: "TikTok",
    reels: "Instagram Reels",
    youtube_shorts: "YouTube Shorts",
    shorts: "YouTube Shorts",
  }
  return labels[primaryChannel] ?? primaryChannel
}

function describeSelectableModel(option: SelectableModelOption | null | undefined) {
  if (!option) {
    return "使用默认"
  }
  const provider = option.providerDisplayName ? ` / ${option.providerDisplayName}` : ""
  const modelId = option.providerModelId ? ` · ${option.providerModelId}` : ""
  return `${option.displayName}${provider}${modelId}`
}

function getRoutePreviewSlot(
  routePreview: ModelRoutePreviewResponse | null,
  slot: ModelControlSlotType,
) {
  return routePreview?.slots.find((item) => item.slotType === slot) ?? null
}

function getOverrideOption(
  modelPools: SelectableModelPoolsResponse | null,
  slot: ModelControlSlotType,
  modelId: string | undefined,
) {
  if (!modelId) {
    return null
  }
  return modelPools?.pools?.[slot]?.options.find((option) => option.recordId === modelId) ?? null
}

function getRoutePreviewTone(routePreview: ModelRoutePreviewResponse | null) {
  if (!routePreview) {
    return "suggestion"
  }
  return routePreview.warnings.length || routePreview.slots.some((slot) => slot.warnings.length)
    ? "suggestion"
    : "ready"
}

function normalizeLaunchModelRouteCopy(value: string | null | undefined) {
  return (value ?? "")
    .replaceAll("模型槽位", "AI 服务")
    .replaceAll("模型路线", "AI 服务组合")
    .replaceAll("路由策略", "选择规则")
}

function buildModelOverridePayload(overrides: Partial<Record<ModelControlSlotType, string>>) {
  return MODEL_CONTROL_SLOT_ORDER.reduce<NonNullable<DraftPayload["modelOverrides"]>>((accumulator, slot) => {
    const value = overrides[slot]
    if (!value) {
      return accumulator
    }
    accumulator[slot] = value
    return accumulator
  }, {})
}

function toCreateTaskOverrides(overrides: Partial<Record<ModelControlSlotType, string>>) {
  const draft = buildModelOverridePayload(overrides)
  const entries = Object.entries(draft) as Array<[ModelControlSlotType, string]>
  if (!entries.length) {
    return undefined
  }
  return entries.reduce<NonNullable<Parameters<typeof api.createTask>[0]["modelOverrides"]>>((accumulator, [slot, value]) => {
    accumulator[slot] = slot === "ttsProvider" ? { providerId: value } : { modelId: value }
    return accumulator
  }, {})
}

export function HomePage({ operator }: { operator?: string } = {}) {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [modelPools, setModelPools] = useState<SelectableModelPoolsResponse | null>(null);
  const [modelRoutePreview, setModelRoutePreview] = useState<ModelRoutePreviewResponse | null>(null);
  const [modelRoutePreviewError, setModelRoutePreviewError] = useState("");
  const draftStorageKey = useMemo(() => getLaunchDraftStorageKey(operator), [operator]);
  const storedDraft = useMemo(() => getStoredLaunchDraft(operator), [operator]);
  const [title, setTitle] = useState(storedDraft?.title ?? "");
  const [script, setScript] = useState(storedDraft?.script ?? "");
  const [visualSeedInput, setVisualSeedInput] = useState(storedDraft?.visualSeedInput ?? "");
  const [projectId, setProjectId] = useState(storedDraft?.projectId ?? "project_default");
  const [terminalPresetId, setTerminalPresetId] =
    useState<TerminalPresetId>(storedDraft?.terminalPresetId ?? "phone_portrait");
  const [targetDurationSec, setTargetDurationSec] = useState(storedDraft?.targetDurationSec ?? 30);
  const [keyframeGenerationMode, setKeyframeGenerationMode] = useState<KeyframeGenerationMode>(
    storedDraft?.keyframeGenerationMode ?? "batch",
  );
  const [audioStrategy, setAudioStrategy] = useState<"tts_only" | "native_plus_tts_ducked">(
    storedDraft?.audioStrategy ?? "tts_only",
  );
  const [subtitleStrategy, setSubtitleStrategy] = useState<SubtitleStrategy>(
    storedDraft?.subtitleStrategy ?? "tts_aligned",
  );
  const [modelOverrides, setModelOverrides] = useState<Partial<Record<ModelControlSlotType, string>>>(
    storedDraft?.modelOverrides ?? {},
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState("");
  const [createdTask, setCreatedTask] = useState<TaskSummary | null>(null);
  const [understandingPreview, setUnderstandingPreview] = useState<BilingualUnderstandingPreview | null>(null);
  const [executionBrief, setExecutionBrief] = useState<EnglishExecutionBrief | null>(null);
  const [understandingLoading, setUnderstandingLoading] = useState(false);
  const [understandingError, setUnderstandingError] = useState("");
  const [tasksUpdatedAt, setTasksUpdatedAt] = useState<string>("");
  const [floatingToast, setFloatingToast] = useState<FloatingToastState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draftRestored, setDraftRestored] = useState(Boolean(storedDraft?.title || storedDraft?.script));
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const scriptInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (draftStorageKey !== LAUNCH_DRAFT_STORAGE_KEY) {
      try {
        window.localStorage.removeItem(LAUNCH_DRAFT_STORAGE_KEY)
      } catch {}
    }
  }, [draftStorageKey])

  useEffect(() => {
    async function load() {
      try {
        const [bootstrapRes, taskRes, projectRes, modelPoolRes, modelRoutePreviewRes] = await Promise.all([
          api.bootstrap(),
          api.listTasks(),
          api.listProjects(),
          api.getSelectableModelPools(DEFAULT_LAUNCH_MODE_ID).catch(() => null),
          api.getModelRoutePreview(DEFAULT_LAUNCH_MODE_ID).catch((err) => {
            setModelRoutePreviewError(err instanceof Error ? err.message : "AI 服务组合预览加载失败")
            return null
          }),
        ]);
        setBootstrap(bootstrapRes);
        setTasks(taskRes.tasks);
        setProjects(projectRes.projects);
        setModelPools(modelPoolRes);
        setModelRoutePreview(modelRoutePreviewRes);
        if (!storedDraft?.projectId && projectRes.projects[0]?.id) {
          setProjectId(projectRes.projects[0].id);
        }
        setTasksUpdatedAt(new Date().toLocaleTimeString("zh-CN"));
        if (!storedDraft?.targetDurationSec) {
          setTargetDurationSec(
            bootstrapRes.durationOptions[1] ??
              bootstrapRes.durationOptions[0] ??
              30,
          );
        }
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
  }, [storedDraft?.projectId, storedDraft?.targetDurationSec]);

  useEffect(() => {
    if (!floatingToast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setFloatingToast(null);
    }, 4200);

    return () => window.clearTimeout(timer);
  }, [floatingToast]);

  useEffect(() => {
    const hasDraft = Boolean(title.trim() || script.trim() || visualSeedInput.trim())
    try {
      if (hasDraft) {
        window.localStorage.setItem(
          draftStorageKey,
          JSON.stringify({
            title,
            script,
            visualSeedInput,
            projectId,
            modeId: DEFAULT_LAUNCH_MODE_ID,
            terminalPresetId,
            targetDurationSec,
            keyframeGenerationMode,
            audioStrategy,
            subtitleStrategy,
            modelOverrides: buildModelOverridePayload(modelOverrides),
          } satisfies DraftPayload),
        )
      } else {
        window.localStorage.removeItem(draftStorageKey)
      }
    } catch {}
  }, [audioStrategy, draftStorageKey, keyframeGenerationMode, modelOverrides, projectId, script, subtitleStrategy, targetDurationSec, terminalPresetId, title, visualSeedInput])

  useEffect(() => {
    const hasDraft = Boolean(title.trim() || script.trim() || visualSeedInput.trim())
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasDraft || submitting) {
        return
      }
      event.preventDefault()
      event.returnValue = ""
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [script, submitting, title, visualSeedInput])

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );
  useEffect(() => {
    if (!selectedProject) {
      return
    }
    if (!storedDraft?.visualSeedInput && !visualSeedInput.trim() && selectedProject.defaultVisualSeedInput) {
      setVisualSeedInput(selectedProject.defaultVisualSeedInput)
    }
    if (!storedDraft?.keyframeGenerationMode && selectedProject.defaultKeyframeGenerationMode) {
      setKeyframeGenerationMode(selectedProject.defaultKeyframeGenerationMode)
    }
  }, [
    selectedProject,
    storedDraft?.keyframeGenerationMode,
    storedDraft?.visualSeedInput,
    visualSeedInput,
  ])
  const renderSpec = getRenderSpec(terminalPresetId);
  const selectedAudioStrategy =
    AUDIO_STRATEGY_OPTIONS.find((item) => item.id === audioStrategy) ?? AUDIO_STRATEGY_OPTIONS[0];
  const selectedSubtitleStrategy =
    SUBTITLE_STRATEGY_OPTIONS.find((item) => item.id === subtitleStrategy) ?? SUBTITLE_STRATEGY_OPTIONS[0];
  const selectedExecutionMode = "review_required";
  const selectedExecutionModeLabel = "审核优先";

  const routePreview =
    targetDurationSec <= 8
      ? "单条成片"
      : "多段成片";
  const keyframeCount = Math.max(1, Math.ceil(targetDurationSec / 15));
  useEffect(() => {
    setUnderstandingPreview(null)
    setExecutionBrief(null)
    setUnderstandingError("")
  }, [script, visualSeedInput, targetDurationSec, keyframeCount])
  const routePreviewDetail =
    routePreview === "单条成片"
      ? "这次内容会优先保持一条完整表达，减少切换感。"
      : "这次内容会按多段组织后再合成为完整成片，优先保证表达稳定。";
  const planningSummary = "系统会尽量保留视频内容的主题、人物、场景和内容方向，只做视频结构整理。";
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
  const launchReadiness = useMemo(
    () => getLaunchReadiness({ title, script, outputLanguage: "English" }),
    [script, title],
  )
  const productionEstimate = useMemo(
    () => estimateLaunchProduction(targetDurationSec),
    [targetDurationSec],
  )
  const similarTasks = useMemo(
    () =>
      findSimilarLaunchTasks({
        title,
        script,
        projectId,
        targetDurationSec,
        tasks,
      }),
    [projectId, script, targetDurationSec, tasks, title],
  )
  const channelLabel = getChannelLabel(selectedProject?.defaultChannelIds ?? ["tiktok"])
  const modelOverrideCount = MODEL_CONTROL_SLOT_ORDER.filter((slot) => Boolean(modelOverrides[slot])).length
  const modelOverrideLabels = MODEL_CONTROL_SLOT_ORDER
    .filter((slot) => Boolean(modelOverrides[slot]))
    .map((slot) => MODEL_CONTROL_SLOT_LABELS[slot])
  const modelRoutePreviewTone = getRoutePreviewTone(modelRoutePreview)
  const modelRouteWarningCount =
    modelRoutePreview?.slots.reduce((count, slot) => count + slot.warnings.length, 0) ??
    (modelRoutePreviewError ? 1 : 0)
  const modelRouteSummary = modelOverrideCount
    ? `本次已手动指定 ${modelOverrideCount} 个环节，提交时会优先使用你选的 AI 服务。`
    : normalizeLaunchModelRouteCopy(modelRoutePreview?.summary)
  const readyCheckCount = launchReadiness.checks.filter((check) => check.status === "ready").length
  const riskyCheckCount = launchReadiness.checks.filter((check) => check.status === "risk").length
  const suggestionCheckCount = launchReadiness.checks.filter((check) => check.status === "suggestion").length
  const requiredFieldsReady = Boolean(title.trim() && script.trim())

  function focusFirstInvalidField(nextErrors: FieldErrors) {
    window.setTimeout(() => {
      if (nextErrors.title) {
        titleInputRef.current?.focus()
        return
      }
      if (nextErrors.script) {
        scriptInputRef.current?.focus()
      }
    }, 0)
  }

  function validateRequiredFields() {
    const nextErrors: FieldErrors = {}
    if (!title.trim()) {
      nextErrors.title = "请填写任务名称"
    }
    if (!script.trim()) {
      nextErrors.script = "请填写视频内容"
    }
    setFieldErrors(nextErrors)
    if (nextErrors.title || nextErrors.script) {
      setNotice("")
      setCreatedTask(null)
      setError("请先补齐必填字段")
      setFloatingToast({
        tone: "error",
        message: "请先补齐任务名称和视频内容",
      })
      focusFirstInvalidField(nextErrors)
      return false
    }
    return true
  }

  function handleSubmitRequest(event?: FormEvent) {
    event?.preventDefault()
    if (!validateRequiredFields()) {
      return
    }
    setError("")
    setConfirmOpen(true)
  }

  function handleClearDraft() {
    if ((title.trim() || script.trim()) && !window.confirm("确认清空当前草稿？")) {
      return
    }
    setTitle("")
    setScript("")
    setVisualSeedInput("")
    setUnderstandingPreview(null)
    setExecutionBrief(null)
    setUnderstandingError("")
    setKeyframeGenerationMode("batch")
    setModelOverrides({})
    setFieldErrors({})
    setDraftRestored(false)
  }

  function applyScriptTemplate(templateBody: string) {
    setScript((current) => (current.trim() ? `${current.trim()}\n\n${templateBody}` : templateBody))
    setFieldErrors((current) => ({ ...current, script: undefined }))
  }

  async function handleGenerateUnderstandingPreview() {
    if (!script.trim()) {
      setFieldErrors((current) => ({ ...current, script: "请先填写视频内容" }))
      setUnderstandingError("请先填写视频内容，系统会根据这段内容理解主题和画面方向。")
      scriptInputRef.current?.focus()
      return
    }

    setUnderstandingLoading(true)
    setUnderstandingError("")
    try {
      const result = await api.createUnderstandingPreview({
        sourceBrief: script,
        visualSeedInput: visualSeedInput.trim() || null,
        targetDurationSec,
        keyframeCount,
        keepCharacterConsistent: true,
      })
      setUnderstandingPreview(result.understandingPreview)
      setExecutionBrief(result.executionBrief)
      setFloatingToast({
        tone: "success",
        message: "已生成中英预览，正式生成会使用英文画面提示词。",
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成理解预览失败"
      setUnderstandingError(message)
      setFloatingToast({ tone: "error", message })
    } finally {
      setUnderstandingLoading(false)
    }
  }

  async function handleCreateTask() {
    if (!validateRequiredFields()) {
      setConfirmOpen(false)
      return
    }

    setSubmitting(true);
    setError("");
    setNotice("");
    setCreatedTask(null);
    try {
      const nextModelOverrides = toCreateTaskOverrides(modelOverrides)
      const result = await api.createTask({
        title,
        script,
        projectId,
        modeId: DEFAULT_LAUNCH_MODE_ID,
        terminalPresetId,
        targetDurationSec,
        visualSeedInput: visualSeedInput.trim() || null,
        keepCharacterConsistent: true,
        keyframeGenerationMode,
        keyframeCount,
        understandingPreview,
        executionBrief,
        audioStrategy,
        subtitleStrategy,
        ...(nextModelOverrides ? { modelOverrides: nextModelOverrides } : {}),
      });
      setTasks((current) => [result.task, ...current]);
      const successMessage = getCreateTaskNotice(result.task);
      setNotice(successMessage);
      setCreatedTask(result.task);
      setFloatingToast({
        tone: "success",
        message: successMessage,
      });
      setTitle("");
      setScript("");
      setVisualSeedInput("");
      setUnderstandingPreview(null);
      setExecutionBrief(null);
      setUnderstandingError("");
      setKeyframeGenerationMode("batch");
      setModelOverrides({});
      setFieldErrors({});
      setConfirmOpen(false);
      setDraftRestored(false);
      try {
        window.localStorage.removeItem(draftStorageKey)
      } catch {}
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "创建任务失败";
      const infrastructureError = /queue|redis|worker/i.test(errorMessage) || errorMessage.includes("队列")
      const friendlyMessage =
        infrastructureError
          ? "任务排队服务暂不可用，请先去生产看板检查生成服务后再提交。"
          : errorMessage
      setError(friendlyMessage);
      setFloatingToast({
        tone: "error",
        message: friendlyMessage,
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="empty-state">GENERGI 正在加载工作台...</div>;
  }

  return (
    <>
      <header className="topbar launch-topbar">
        <div>
          <div className="eyebrow">GENERGI Command Center</div>
          <h1>新建生产任务</h1>
          <p>
            按 3 步新建任务：先确认项目和输出规格，再写清视频内容，可选补充画面参考，最后检查风险后提交。
          </p>
        </div>
        <div className="topbar-actions">
          <span className="pill">英文成片</span>
          <span className="pill">单一路径</span>
          <span className="pill">TikTok 默认</span>
          <span className="pill pill--accent">审核优先</span>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}
      {draftRestored ? (
        <section className="planning-summary-card launch-draft-card">
          <strong>已恢复未提交草稿</strong>
          <span>已恢复当前账号在这台设备上的草稿。提交成功后会自动清理。</span>
          <button className="ghost-button ghost-button--compact" onClick={() => setDraftRestored(false)} type="button">
            知道了
          </button>
        </section>
      ) : null}
      {notice && createdTask ? (
        <section className="planning-summary-card launch-success-card">
          <strong>已提交，等待审核</strong>
          <span>{notice}</span>
          <div className="launch-path">
            <span>已入队</span>
            <span>生成方案和关键画面准备中</span>
            <span>进入任务审核</span>
            <span>审核通过后继续成片</span>
          </div>
          <div className="planning-summary-tags">
            <a className="primary-button" href={buildBatchDashboardUrl(createdTask.id)}>
              去看板跟进
            </a>
            <a className="ghost-button" href={buildTaskReviewUrl(createdTask)}>
              进入任务审核
            </a>
            <a className="ghost-button" href={buildAssetCenterUrl(createdTask.id)}>
              查看素材文件
            </a>
          </div>
          <span>项目、时长、音频和字幕策略已保留，方便继续创建同类任务。</span>
        </section>
      ) : null}

      <div className="workspace-grid launch-grid">
        <form className="card card--main launch-form" id="launch-form" onSubmit={handleSubmitRequest}>
          <section className="launch-step">
            <div className="launch-step__header">
              <span className="launch-step__index">1</span>
              <div>
                <h2>项目与输出</h2>
              <p className="section-note">先确认这条任务属于哪个项目、默认渠道和最终画幅，避免后续内容归错项目。</p>
              </div>
            </div>

            <label className="field-label" htmlFor="launch-project">所属项目</label>
            <select
              autoComplete="off"
              className="input"
              id="launch-project"
              name="projectId"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <div className="launch-project-preview">
              <strong>{selectedProject?.name ?? "未选择项目"}</strong>
              <span>默认渠道：{channelLabel} · 输出语言：English · 模式：{MODEL_CONTROL_MODE_LABELS[DEFAULT_LAUNCH_MODE_ID]}</span>
              <span>{selectedProject?.brandDirection ?? "暂无品牌方向"} · {(selectedProject?.reusableStyleConstraints ?? []).join(" / ") || "暂无固定风格要求"}</span>
            </div>

            <label className="field-label" htmlFor="launch-terminal">终端预设</label>
            <select
              autoComplete="off"
              className="input"
              id="launch-terminal"
              name="terminalPresetId"
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

            <fieldset className="launch-fieldset">
              <legend className="field-label">正片总时长</legend>
              <div className="segmented-control" role="radiogroup" aria-label="正片总时长">
                {bootstrap?.durationOptions.map((duration) => (
                  <button
                    key={duration}
                    className={duration === targetDurationSec ? "segment segment--active" : "segment"}
                    onClick={() => setTargetDurationSec(duration)}
                    type="button"
                    role="radio"
                    aria-checked={duration === targetDurationSec}
                  >
                    {duration}s
                  </button>
                ))}
              </div>
            </fieldset>

          </section>

          <section className="launch-step">
            <div className="launch-step__header">
              <span className="launch-step__index">2</span>
              <div>
                <h2>视频内容</h2>
                <p className="section-note" id="launch-script-help">
                  写你想表达的内容、卖点、情绪、目标人群和 CTA。系统会自动拆成口播、分镜和画面提示词。
                </p>
              </div>
            </div>

            <label className="field-label" htmlFor="launch-title">任务名称（必填）</label>
            <input
              aria-describedby={fieldErrors.title ? "launch-title-error" : undefined}
              aria-invalid={Boolean(fieldErrors.title)}
              autoComplete="off"
              className={fieldErrors.title ? "input input--invalid" : "input"}
              id="launch-title"
              name="title"
              ref={titleInputRef}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                setFieldErrors((current) => ({ ...current, title: undefined }))
              }}
              placeholder="例如：夏季新品种草短视频"
            />
            {fieldErrors.title ? <div className="field-error" id="launch-title-error">{fieldErrors.title}</div> : null}

            <div className="template-row" aria-label="视频内容模板">
              {SCRIPT_TEMPLATES.map((template) => (
                <button className="ghost-button ghost-button--compact" key={template.id} onClick={() => applyScriptTemplate(template.body)} type="button">
                  套用{template.label}
                </button>
              ))}
            </div>

            <label className="field-label" htmlFor="launch-script">视频内容（必填）</label>
            <textarea
              aria-describedby={fieldErrors.script ? "launch-script-error launch-script-help" : "launch-script-help"}
              aria-invalid={Boolean(fieldErrors.script)}
              autoComplete="off"
              className={fieldErrors.script ? "textarea input--invalid" : "textarea"}
              id="launch-script"
              name="script"
              ref={scriptInputRef}
              value={script}
              onChange={(event) => {
                setScript(event.target.value)
                setFieldErrors((current) => ({ ...current, script: undefined }))
              }}
              placeholder="直接写你想表达的内容、卖点、情绪、目标人群和转化目标，不需要写专业参数。"
            />
            {fieldErrors.script ? <div className="field-error" id="launch-script-error">{fieldErrors.script}</div> : null}

            <div className="visual-brief-panel">
              <div className="visual-brief-panel__header">
                <div>
                  <label className="field-label" htmlFor="launch-visual-seed">画面参考（可选）</label>
                  <p className="section-note">
                    不填写也可以，系统会根据视频内容自动补全画面方向。填写后只作为角色、场景、风格和一致性参考，不会替代视频内容。
                  </p>
                </div>
                <div className="visual-brief-panel__actions">
                  <button
                    className="ghost-button ghost-button--compact"
                    disabled={understandingLoading || !script.trim()}
                    onClick={handleGenerateUnderstandingPreview}
                    type="button"
                  >
                    {understandingLoading ? "理解中..." : "生成理解预览"}
                  </button>
                  <span className="pill pill--sm">{targetDurationSec}s 自动生成 {keyframeCount} 张关键画面</span>
                </div>
              </div>
              <textarea
                autoComplete="off"
                className="textarea textarea--compact"
                id="launch-visual-seed"
                name="visualSeedInput"
                value={visualSeedInput}
                onChange={(event) => setVisualSeedInput(event.target.value)}
                placeholder={"可选填写：\n主角：例如 28 岁亚洲女性，疲惫但专业\n场景：例如 深夜办公室、桌面凌乱\n风格：例如 柔和电影感、动画插画、真实摄影\n情绪：例如 压抑、反思、逐渐看到希望\n禁止项：例如 不要文字水印、不要夸张表情\n角色一致：例如 全片保持同一位主角"}
              />
              {understandingError ? (
                <div className="alert alert--error">{understandingError}</div>
              ) : null}
              {understandingPreview && executionBrief ? (
                <div className="visual-understanding-card">
                  <div className="visual-understanding-card__header">
                    <div>
                      <strong>系统理解预览</strong>
                      <span>中英对照给运营确认，正式给图片和视频模型的内容只使用英文执行提示词。</span>
                    </div>
                    <span className="pill pill--sm">英文执行</span>
                  </div>
                  <div className="visual-understanding-grid">
                    <div>
                      <span>主题</span>
                      <strong>{understandingPreview.topic.zh}</strong>
                      <em>{understandingPreview.topic.en}</em>
                    </div>
                    <div>
                      <span>主角</span>
                      <strong>{understandingPreview.visualBrief.subject.zh}</strong>
                      <em>{understandingPreview.visualBrief.subject.en}</em>
                    </div>
                    <div>
                      <span>场景</span>
                      <strong>{understandingPreview.visualBrief.setting.zh}</strong>
                      <em>{understandingPreview.visualBrief.setting.en}</em>
                    </div>
                    <div>
                      <span>情绪</span>
                      <strong>{understandingPreview.emotionalArc.zh}</strong>
                      <em>{understandingPreview.emotionalArc.en}</em>
                    </div>
                  </div>
                  <div className="visual-understanding-prompts">
                    <span>执行提示词预览</span>
                    <strong>{executionBrief.keyframePlan.length} 张关键画面 · {executionBrief.finalPromptLanguage.toUpperCase()}</strong>
                    <p>{executionBrief.keyframePlan[0]?.imagePrompt}</p>
                  </div>
                </div>
              ) : null}
              <div className="segmented-control segmented-control--compact" role="radiogroup" aria-label="关键画面生成方式">
                <button
                  className={keyframeGenerationMode === "batch" ? "segment segment--active" : "segment"}
                  onClick={() => setKeyframeGenerationMode("batch")}
                  type="button"
                  role="radio"
                  aria-checked={keyframeGenerationMode === "batch"}
                >
                  批量生成
                </button>
                <button
                  className={keyframeGenerationMode === "single" ? "segment segment--active" : "segment"}
                  onClick={() => setKeyframeGenerationMode("single")}
                  type="button"
                  role="radio"
                  aria-checked={keyframeGenerationMode === "single"}
                >
                  单张生成
                </button>
              </div>
              <div className="visual-brief-panel__meta">
                <span>按 {targetDurationSec}s 自动规划 {keyframeCount} 张分镜关键画面。</span>
                <span>{keyframeGenerationMode === "batch" ? "支持批量的生图模型会一次请求整组画面。" : "逐张生成，适合单张微调或供应商不支持批量时使用。"}</span>
              </div>
            </div>

            <div className={`launch-preflight launch-preflight--${launchReadiness.level}`}>
              <div>
                <strong>视频内容检查</strong>
                <span>{launchReadiness.summary}</span>
              </div>
              <span className="pill pill--sm">{readyCheckCount}/{launchReadiness.checks.length} 已通过</span>
            </div>
            <div className="launch-check-grid">
              {launchReadiness.checks.map((check) => (
                <div className={`launch-check launch-check--${check.status}`} key={check.key}>
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="launch-step">
            <div className="launch-step__header">
              <span className="launch-step__index">3</span>
              <div>
                <h2>启动前确认</h2>
                <p className="section-note">确认输出设置、预算粗估、相似任务和审核流程，再提交排队。</p>
              </div>
            </div>

            <div className="planning-strip launch-confirm-strip">
              <div className="planning-chip">
                <span className="planning-chip__label">视频结构</span>
                <strong>{productionEstimate.routeLabel}</strong>
                <span>{routePreviewDetail}</span>
              </div>
              <div className="planning-chip">
                <span className="planning-chip__label">镜头数与预算粗估</span>
                <strong>{productionEstimate.budgetLabel}</strong>
                <span>目标 {targetDurationSec}s · 先审后生成 · 预算仅用于提交前判断。</span>
              </div>
              <div className="planning-chip">
                <span className="planning-chip__label">默认渠道</span>
                <strong>{channelLabel}</strong>
                <span>输出 English，发布文案会按默认渠道进入交付检查。</span>
              </div>
              <div className="planning-chip">
                <span className="planning-chip__label">审核流程</span>
                <strong>{selectedExecutionModeLabel}</strong>
                <span>{planningSummary}</span>
              </div>
            </div>

            <div className={`model-route-preview model-route-preview--${modelRoutePreviewTone}`}>
              <div className="model-route-preview__header">
                <div>
                  <h3>本次会用到的 AI 服务</h3>
                  <p>
                    {modelRouteSummary ??
                      (modelRoutePreviewError
                        ? "AI 服务组合暂时没有加载成功，请先确认模型设置可用。"
                        : "正在确认本次会使用的 AI 服务。")}
                  </p>
                </div>
                <span className={modelRouteWarningCount ? "pill pill--sm pill--warning" : "pill pill--sm"}>
                  {modelOverrideCount
                    ? `已覆盖 ${modelOverrideCount}`
                    : modelRouteWarningCount
                      ? `需要确认 ${modelRouteWarningCount}`
                      : "配置可用"}
                </span>
              </div>
              {modelRoutePreviewError ? (
                <div className="alert alert--warning">
                  <strong>AI 服务组合加载失败</strong>
                  <span>{modelRoutePreviewError}</span>
                </div>
              ) : null}
              <div className="model-route-preview__grid">
                {MODEL_CONTROL_SLOT_ORDER.map((slot) => {
                  const previewSlot = getRoutePreviewSlot(modelRoutePreview, slot)
                  const overrideOption = getOverrideOption(modelPools, slot, modelOverrides[slot])
                  const displayName = overrideOption?.displayName ?? previewSlot?.displayName ?? "确认中"
                  const providerName = overrideOption?.providerDisplayName ?? previewSlot?.provider ?? "接入方待确认"
                  const fallbackCount = overrideOption ? 0 : previewSlot?.fallbackCandidates.length ?? 0
                  return (
                    <div className="model-route-slot" key={slot}>
                      <div className="model-route-slot__header">
                        <span>{MODEL_CONTROL_SLOT_LABELS[slot]}</span>
                        <strong>{displayName}</strong>
                      </div>
                      <div className="model-route-slot__meta">
                        <span>{providerName}</span>
                        <span>{overrideOption ? "本次手动指定" : normalizeLaunchModelRouteCopy(previewSlot?.routingStrategy) || "默认组合"}</span>
                      </div>
                      <p>
                        {overrideOption
                          ? "这次任务会优先使用这个模型，不跟随默认策略自动变化。"
                          : normalizeLaunchModelRouteCopy(previewSlot?.selectionReason) || "正在读取模型设置里的当前配置。"}
                      </p>
                      <div className="model-route-slot__footer">
                        <span className={fallbackCount ? "info-chip info-chip--accent" : "info-chip"}>
                          {overrideOption ? "手动覆盖" : fallbackCount ? `备用 ${fallbackCount}` : "暂无备用"}
                        </span>
                        {overrideOption ? (
                          <span className="status-text--success">提交后会固定到本任务</span>
                        ) : previewSlot?.warnings.length ? (
                          <span className="status-text--warning">{previewSlot.warnings[0]}</span>
                        ) : (
                          <span className="status-text--success">当前没有明显配置风险</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {similarTasks.matches.length ? (
              <div className="alert alert--warning">
                <strong>{similarTasks.summary}</strong>
                {similarTasks.matches.map((match) => (
                  <span key={match.task.id}>
                    {match.task.title} · {getTaskStatusLabel(match.task)} · {match.reason}
                  </span>
                ))}
              </div>
            ) : (
              <div className="launch-preflight launch-preflight--ready">
                <strong>重复任务检查</strong>
                <span>{similarTasks.summary}</span>
              </div>
            )}

            <details className="advanced-settings" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
              <summary>更多设置：音频、字幕和本次任务固定配置</summary>
              <div className="mode-grid" role="radiogroup" aria-label="音频策略">
                {AUDIO_STRATEGY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={option.id === audioStrategy ? "mode-card mode-card--active" : "mode-card"}
                    onClick={() => setAudioStrategy(option.id)}
                    type="button"
                    role="radio"
                    aria-checked={option.id === audioStrategy}
                  >
                    <div className="mode-title">{option.label}</div>
                    <span className={option.id === "tts_only" ? "status-text--success" : "status-text--warning"}>
                      {option.id === "tts_only" ? "稳定推荐" : "谨慎使用"}
                    </span>
                    <div className="mode-description">{option.description}</div>
                  </button>
                ))}
              </div>
              <div className="mode-grid" role="radiogroup" aria-label="字幕策略">
                {SUBTITLE_STRATEGY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={option.id === subtitleStrategy ? "mode-card mode-card--active" : "mode-card"}
                    onClick={() => setSubtitleStrategy(option.id)}
                    type="button"
                    role="radio"
                    aria-checked={option.id === subtitleStrategy}
                  >
                    <div className="mode-title">{option.label}</div>
                    <span className={option.id === "tts_aligned" ? "status-text--success" : "status-text--warning"}>
                      {option.id === "tts_aligned" ? "稳定推荐" : "适合保留原声"}
                    </span>
                    <div className="mode-description">{option.description}</div>
                  </button>
                ))}
              </div>
              <div className="model-override-panel">
                <div className="section-header">
                  <div>
                    <h3>本次指定 AI 服务</h3>
                    <p className="section-note">
                      默认使用模型设置里的{MODEL_CONTROL_MODE_LABELS[DEFAULT_LAUNCH_MODE_ID]}组合。只有排查质量问题或临时试模型时，才需要单独指定。
                    </p>
                  </div>
                  {modelOverrideCount ? (
                    <button className="ghost-button ghost-button--compact" onClick={() => setModelOverrides({})} type="button">
                      清空覆盖
                    </button>
                  ) : null}
                </div>
                <div className="model-override-grid">
                  {MODEL_CONTROL_SLOT_ORDER.map((slot) => {
                    const pool = modelPools?.pools?.[slot]
                    const effectiveOption = pool?.options.find((option) => option.recordId === pool.effectiveId)
                    const overrideOption = pool?.options.find((option) => option.recordId === modelOverrides[slot])
                    return (
                      <label className={modelOverrides[slot] ? "slot-override-card slot-override-card--overridden" : "slot-override-card"} key={slot}>
                        <div className="slot-override-card__header">
                          <strong>{MODEL_CONTROL_SLOT_LABELS[slot]}</strong>
                          <span className={modelOverrides[slot] ? "info-chip info-chip--accent" : "info-chip"}>
                            {modelOverrides[slot] ? "本次覆盖" : "使用默认"}
                          </span>
                        </div>
                        <select
                          className="input"
                          value={modelOverrides[slot] ?? ""}
                          onChange={(event) =>
                            setModelOverrides((current) => ({
                              ...current,
                              [slot]: event.target.value || undefined,
                            }))
                          }
                        >
                          <option value="">使用默认：{describeSelectableModel(effectiveOption)}</option>
                          {(pool?.options ?? []).map((option) => (
                            <option key={option.recordId} value={option.recordId}>
                              {describeSelectableModel(option)}
                            </option>
                          ))}
                        </select>
                        <div className="slot-override-card__summary">
                          <span>当前生效：{describeSelectableModel(overrideOption ?? effectiveOption)}</span>
                          <span>可选模型：{pool?.options.length ?? 0}</span>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            </details>
          </section>
        </form>

        <aside className="side-panel launch-side-panel">
          <section className="card card--compact launch-check-panel">
            <h3>启动前检查</h3>
            <div className={`launch-ready-badge launch-ready-badge--${launchReadiness.level}`}>
              {launchReadiness.level === "risk"
                ? "不可提交"
                : launchReadiness.level === "suggestion"
                  ? "建议补充后提交"
                  : "可提交"}
            </div>
            <div className="metric-row"><span>项目</span><strong>{selectedProject?.name ?? "未选择"}</strong></div>
            <div className="metric-row"><span>默认渠道</span><strong>{channelLabel}</strong></div>
            <div className="metric-row"><span>目标时长</span><strong>{targetDurationSec}s</strong></div>
            <div className="metric-row"><span>关键画面</span><strong>{keyframeCount} 张 / {keyframeGenerationMode === "batch" ? "批量" : "单张"}</strong></div>
            <div className="metric-row"><span>输出规格</span><strong>{renderSpec.width} × {renderSpec.height}</strong></div>
            <div className="metric-row"><span>画面比例</span><strong>{renderSpec.aspectRatio}</strong></div>
            <div className="metric-row"><span>成片组织</span><strong>{productionEstimate.routeLabel}</strong></div>
            <div className="metric-row"><span>预计预算</span><strong>¥{productionEstimate.estimatedBudgetCny.toFixed(2)}</strong></div>
            <div className="metric-row"><span>音频/字幕</span><strong>{selectedAudioStrategy.label} / {getSubtitleStrategyLabel(subtitleStrategy)}</strong></div>
            <div className="metric-row"><span>AI 服务</span><strong>{modelOverrideCount ? modelOverrideLabels.join("、") : "使用默认组合"}</strong></div>
            <div className="metric-row">
              <span>AI 服务</span>
              <strong>
                {modelOverrideCount
                  ? `覆盖 ${modelOverrideCount} 个环节`
                  : modelRouteWarningCount
                    ? `${modelRouteWarningCount} 项需确认`
                    : "默认组合可用"}
              </strong>
            </div>
            <div className="metric-row"><span>审核流程</span><strong>生成方案与关键画面先审</strong></div>
            <div className="launch-risk-summary">
              <span>风险 {riskyCheckCount}</span>
              <span>建议 {suggestionCheckCount}</span>
              <span>相似任务 {similarTasks.matches.length}</span>
            </div>
          </section>

          <section className="card card--compact">
            <h3>我的最近任务</h3>
            <div className="planning-summary-tags compact-list">
              <span className="pill pill--sm">生成中 {taskStatusSummary.runningCount}</span>
              <span className="pill pill--sm">已完成 {taskStatusSummary.completedCount}</span>
              {taskStatusSummary.failedCount ? <span className="pill pill--sm pill--danger">异常 {taskStatusSummary.failedCount}</span> : null}
            </div>
            {taskStatusSummary.failedCount ? (
              <div className="alert alert--warning">
                <strong>当前有异常任务</strong>
                <span>建议先去生产看板处理失败或卡住的任务，再追加同类内容，避免重复占用队列。</span>
                <a className="ghost-button ghost-button--compact" href="/batch-dashboard">
                  查看全部异常任务
                </a>
              </div>
            ) : null}
            <div className="muted">最近刷新：{tasksUpdatedAt || "刚刚进入页面"}</div>
            <div className="task-list compact-list">
              {recentTasks.length ? (
                recentTasks.map((task) => (
                  <div key={task.id} className={task.status === "running" ? "task-item task-item--running" : task.status === "failed" ? "task-item task-item--blocked" : "task-item"}>
                    <strong>{task.status === "running" ? <span className="status-dot status-dot--running" /> : null}{task.title}</strong>
                    <span>{task.targetDurationSec}s · {getTaskStatusLabel(task)} · {task.actualDurationSec ? `实际 ${task.actualDurationSec.toFixed(1)}s` : "等待成片"}</span>
                    <div className="task-item__actions">
                      <a className="ghost-button ghost-button--compact" href={buildBatchDashboardUrl(task.id)}>看生产看板</a>
                      <a className="ghost-button ghost-button--compact" href={buildTaskReviewUrl(task)}>去审核</a>
                    </div>
                  </div>
                ))
              ) : (
                <div className="task-item"><strong>暂无最近任务</strong><span>提交后会在这里显示进度。</span></div>
              )}
            </div>
          </section>
        </aside>
      </div>

      <div className="sticky-action-bar">
        <button className="ghost-button" onClick={handleClearDraft} type="button">
          清空草稿
        </button>
        <button className="primary-button" disabled={submitting || !requiredFieldsReady} form="launch-form" type="submit">
          {submitting ? "正在提交…" : requiredFieldsReady ? "提交，先生成审核内容" : "补齐必填后提交"}
        </button>
      </div>

      {confirmOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="launch-confirm-title" className="modal-card launch-confirm-modal" role="dialog" aria-modal="true">
            <div className="section-header">
              <div>
                <div className="eyebrow">提交前确认</div>
                <h2 id="launch-confirm-title">将按以下配置创建任务</h2>
                <div className="muted">确认后会固定项目、时长、画幅、音频和字幕设置；提交后先生成审核内容。</div>
              </div>
              <button className="ghost-button ghost-button--compact" onClick={() => setConfirmOpen(false)} type="button">关闭</button>
            </div>
            <div className="launch-confirm-grid">
              <div className="metric-row"><span>任务名称</span><strong>{title}</strong></div>
              <div className="metric-row"><span>项目 / 渠道</span><strong>{selectedProject?.name ?? "未选择"} / {channelLabel}</strong></div>
              <div className="metric-row"><span>时长 / 画幅</span><strong>{targetDurationSec}s / {renderSpec.aspectRatio}</strong></div>
              <div className="metric-row"><span>关键画面</span><strong>{keyframeCount} 张 / {keyframeGenerationMode === "batch" ? "批量生成" : "单张生成"}</strong></div>
              <div className="metric-row"><span>镜头 / 预算</span><strong>{productionEstimate.sceneCount} 段 / ¥{productionEstimate.estimatedBudgetCny.toFixed(2)}</strong></div>
              <div className="metric-row"><span>生成流程</span><strong>先审后生成</strong></div>
              <div className="metric-row"><span>模型设置</span><strong>{modelOverrideCount ? `本次覆盖 ${modelOverrideCount} 项` : "使用默认组合"}</strong></div>
              <div className="metric-row"><span>相似任务</span><strong>{similarTasks.matches.length ? `${similarTasks.matches.length} 条需确认` : "未发现明显重复"}</strong></div>
            </div>
            <div className={`launch-preflight launch-preflight--${launchReadiness.level}`}>
              <strong>{launchReadiness.summary}</strong>
              <span>创建后先进入生成方案与关键画面审核，通过后再继续产出成片。</span>
            </div>
            <div className="action-row">
              <button className="ghost-button" onClick={() => setConfirmOpen(false)} type="button">返回修改</button>
              <button className="primary-button" disabled={submitting || !requiredFieldsReady} onClick={() => void handleCreateTask()} type="button">
                {submitting ? "正在提交…" : "确认提交，先生成审核内容"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {floatingToast ? (
        <div
          aria-live={floatingToast.tone === "success" ? "polite" : "assertive"}
          className={
            floatingToast.tone === "success"
              ? "floating-toast floating-toast--success"
              : "floating-toast floating-toast--error"
          }
          role={floatingToast.tone === "success" ? "status" : "alert"}
        >
          <strong>{floatingToast.tone === "success" ? "已提交，等待审核" : "提交失败"}</strong>
          <span>{floatingToast.message}</span>
        </div>
      ) : null}
    </>
  );
}
