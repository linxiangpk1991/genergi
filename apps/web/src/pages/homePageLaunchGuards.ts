import type { TaskSummary } from "../api"

export type LaunchReadinessLevel = "ready" | "suggestion" | "risk"

export type LaunchCheckStatus = "ready" | "suggestion" | "risk"

export type LaunchReadinessCheck = {
  key: string
  label: string
  status: LaunchCheckStatus
  detail: string
}

export type LaunchReadiness = {
  level: LaunchReadinessLevel
  summary: string
  checks: LaunchReadinessCheck[]
}

export type SimilarLaunchTaskMatch = {
  task: TaskSummary
  reason: string
  score: number
}

export type SimilarLaunchTasksResult = {
  level: "clear" | "warning"
  summary: string
  matches: SimilarLaunchTaskMatch[]
}

export type LaunchProductionEstimate = {
  sceneCount: number
  routeLabel: "单条成片" | "多段成片"
  estimatedBudgetCny: number
  budgetLabel: string
}

const TECH_PROMPT_PATTERNS = [
  /prompt/i,
  /negative prompt/i,
  /\bjson\b/i,
  /\bschema\b/i,
  /\bmarkdown\b/i,
  /\btokens?\b/i,
  /\bllm\b/i,
  /seed\s*[:=]/i,
  /camera\s*[:=]/i,
  /--ar\s+\d/i,
  /cfg\s*scale/i,
  /sampler/i,
]

const CTA_PATTERNS = [
  /call to action/i,
  /\bcta\b/i,
  /buy now/i,
  /shop now/i,
  /learn more/i,
  /sign up/i,
  /visit/i,
  /点击/,
  /购买/,
  /下单/,
  /了解/,
  /注册/,
  /咨询/,
  /关注/,
  /引导/,
  /行动/,
]

const AUDIENCE_PATTERNS = [
  /audience/i,
  /target user/i,
  /for people/i,
  /for users/i,
  /customer/i,
  /buyer/i,
  /用户/,
  /人群/,
  /受众/,
  /客户/,
  /买家/,
  /适合/,
  /面向/,
]

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(value: string) {
  return Array.from(new Set(normalizeText(value).split(" ").filter((token) => token.length >= 3)))
}

function hasMostlyChinese(value: string) {
  const chineseMatches = value.match(/\p{Script=Han}/gu)?.length ?? 0
  const latinMatches = value.match(/[A-Za-z]/g)?.length ?? 0
  return chineseMatches >= 12 && chineseMatches > latinMatches
}

function hasPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value))
}

function getHighestLevel(checks: LaunchReadinessCheck[]): LaunchReadinessLevel {
  if (checks.some((check) => check.status === "risk")) {
    return "risk"
  }
  if (checks.some((check) => check.status === "suggestion")) {
    return "suggestion"
  }
  return "ready"
}

export function getLaunchReadiness(input: {
  title: string
  script: string
  outputLanguage?: string
}): LaunchReadiness {
  const title = input.title.trim()
  const script = input.script.trim()
  const checks: LaunchReadinessCheck[] = [
    {
      key: "title",
      label: "任务名称",
      status: title ? "ready" : "risk",
      detail: title ? "已填写任务名称。" : "必须补齐任务名称，方便后续审核和排障定位。",
    },
    {
      key: "script",
      label: "视频内容",
      status: script ? "ready" : "risk",
      detail: script ? "已填写视频内容。" : "必须补齐视频内容，否则无法稳定生成正确视频。",
    },
  ]

  if (script) {
    checks.push({
      key: "script_length",
      label: "文案长度",
      status: script.length < 80 ? "suggestion" : script.length > 1600 ? "suggestion" : "ready",
      detail:
        script.length < 80
          ? "文案偏短，建议补充产品、目标人群、场景、卖点和 CTA。"
          : script.length > 1600
            ? "文案较长，系统会压缩为短视频表达，建议保留核心卖点和禁忌点。"
            : "长度适合进入短视频规划。",
    })
    checks.push({
      key: "audience",
      label: "目标人群",
      status: hasPattern(script, AUDIENCE_PATTERNS) ? "ready" : "suggestion",
      detail: hasPattern(script, AUDIENCE_PATTERNS)
        ? "已看到目标人群或使用对象线索。"
        : "建议补充目标人群或使用对象，减少画面和文案跑偏。",
    })
    checks.push({
      key: "cta",
      label: "行动引导",
      status: hasPattern(script, CTA_PATTERNS) ? "ready" : "suggestion",
      detail: hasPattern(script, CTA_PATTERNS)
        ? "已看到 CTA 或行动引导。"
        : "建议补充结尾希望用户采取的动作，例如了解、咨询、购买或访问。",
    })
    checks.push({
      key: "technical_prompt",
      label: "技术说明",
      status: hasPattern(script, TECH_PROMPT_PATTERNS) ? "suggestion" : "ready",
      detail: hasPattern(script, TECH_PROMPT_PATTERNS)
        ? "文案里疑似包含模型参数或技术指令，建议改成业务内容和画面约束。"
        : "未发现明显技术指令混入。",
    })
    checks.push({
      key: "language",
      label: "输出语言",
      status: input.outputLanguage === "English" && hasMostlyChinese(script) ? "suggestion" : "ready",
      detail:
        input.outputLanguage === "English" && hasMostlyChinese(script)
          ? "当前输出为 English，中文文案建议写清品牌名、专名和不可翻译词。"
          : "输出语言与文案风险可控。",
    })
  }

  const level = getHighestLevel(checks)
  const summary =
    level === "risk"
      ? "必须补齐关键输入后再提交。"
      : level === "suggestion"
        ? "可提交，但建议补充关键信息以减少重跑。"
        : "文案质量可进入审核优先队列。"

  return { level, summary, checks }
}

function getTokenOverlap(left: string, right: string) {
  const leftTokens = tokenize(left)
  const rightTokens = new Set(tokenize(right))
  if (!leftTokens.length || !rightTokens.size) {
    return 0
  }
  return leftTokens.filter((token) => rightTokens.has(token)).length / leftTokens.length
}

export function findSimilarLaunchTasks(input: {
  title: string
  script: string
  projectId: string
  targetDurationSec: number
  tasks: TaskSummary[]
}): SimilarLaunchTasksResult {
  const title = normalizeText(input.title)
  const matches = input.tasks
    .map((task) => {
      const sameProject = task.projectId === input.projectId
      const sameDuration = task.targetDurationSec === input.targetDurationSec
      const nearDuration = Math.abs(task.targetDurationSec - input.targetDurationSec) <= 4
      const taskTitle = normalizeText(task.title)
      const titleOverlap = getTokenOverlap(title, taskTitle)
      const taskScript = getTaskSourceScript(task)
      const scriptOverlap = taskScript ? getTokenOverlap(input.script, taskScript) : 0
      const exactishTitle = Boolean(title && taskTitle && (title === taskTitle || titleOverlap >= 0.5))
      const score =
        (sameProject ? 0.35 : 0) +
        (sameDuration ? 0.2 : nearDuration ? 0.1 : 0) +
        Math.min(titleOverlap, 1) * 0.35 +
        Math.min(scriptOverlap, 1) * 0.1
      const reason = exactishTitle
        ? "任务名称相似"
        : scriptOverlap >= 0.6 && nearDuration
          ? "视频内容和目标时长相似"
        : sameProject && sameDuration
          ? "同项目和同目标时长"
          : "配置相似"
      return { task, reason, score }
    })
    .filter((match) => match.score >= 0.58)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)

  if (!matches.length) {
    return {
      level: "clear",
      summary: "最近任务里未发现明显重复项。",
      matches,
    }
  }

  return {
    level: "warning",
    summary: "可能已有相似任务，建议先确认是否需要重复创建。",
    matches,
  }
}

export function estimateLaunchProduction(targetDurationSec: number): LaunchProductionEstimate {
  const sceneCount = Math.max(1, Math.ceil(targetDurationSec / 15))
  const estimatedBudgetCny = Number((sceneCount * 1.25).toFixed(2))
  const routeLabel = sceneCount === 1 ? "单条成片" : "多段成片"
  return {
    sceneCount,
    routeLabel,
    estimatedBudgetCny,
    budgetLabel: `预计 ${sceneCount} 段，预算约 ¥${estimatedBudgetCny.toFixed(2)}`,
  }
}

function getTaskSourceScript(task: TaskSummary) {
  const planning = task.planning as { sourceScript?: unknown } | undefined
  return typeof planning?.sourceScript === "string" ? planning.sourceScript : ""
}

export type SourceQualityInput = Parameters<typeof getLaunchReadiness>[0]
export type SourceQualityResult = LaunchReadiness

export function assessSourceQuality(input: SourceQualityInput): SourceQualityResult {
  return getLaunchReadiness(input)
}

export type DuplicateTaskInput = {
  title: string
  script: string
  projectId: string
  targetDurationSec: number
}

export type DuplicateTaskMatch = SimilarLaunchTaskMatch & {
  level: "suggestion" | "risk"
  reasons: string[]
}

export type DuplicateTaskRiskResult = {
  matches: DuplicateTaskMatch[]
  highestRisk: { level: "suggestion" | "risk"; reason: string } | null
}

export function findDuplicateTaskRisks(
  input: DuplicateTaskInput,
  recentTasks: TaskSummary[],
): DuplicateTaskRiskResult {
  const similar = findSimilarLaunchTasks({ ...input, tasks: recentTasks })
  const normalizedTitle = normalizeText(input.title)
  const matches = similar.matches.map((match) => {
    const sameProject = match.task.projectId === input.projectId
    const sameTitle = normalizedTitle !== "" && normalizedTitle === normalizeText(match.task.title)
    const level: "suggestion" | "risk" = sameProject && sameTitle ? "risk" : "suggestion"
    const reasons = [sameProject && sameTitle ? "同项目同标题任务已存在" : match.reason]

    return {
      ...match,
      level,
      reasons,
    }
  })

  const highest = matches.find((match) => match.level === "risk") ?? matches[0] ?? null

  return {
    matches,
    highestRisk: highest ? { level: highest.level, reason: highest.reasons[0] } : null,
  }
}

export type LaunchBudgetEstimate = Omit<LaunchProductionEstimate, "routeLabel">

export function estimateLaunchBudget(targetDurationSec: number): LaunchBudgetEstimate {
  const { sceneCount, estimatedBudgetCny, budgetLabel } = estimateLaunchProduction(targetDurationSec)

  return { sceneCount, estimatedBudgetCny, budgetLabel }
}
