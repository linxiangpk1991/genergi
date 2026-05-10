import {
  readProjectApprovedBlueprintLibrary,
  readTaskDetail,
  readTaskBlueprintRecords,
  readTaskBlueprintReviewRecords,
  readTaskSummaries,
  upsertTaskDetail,
  writeProjectApprovedBlueprintLibrary,
  writeTaskBlueprintRecords,
  writeTaskBlueprintReviewRecords,
  writeTaskSummaries,
  type BlueprintQualityFeedbackSlot,
  type BlueprintQualityIssueCategory,
  type BlueprintReviewDecision,
  type ExecutionBlueprint,
  type PlannedExecutionBlueprint,
  type ProjectApprovedBlueprintRecord,
  type StoryboardScene,
  type TaskBlueprintRecord,
  type TaskBlueprintQualityFeedbackRecord,
  type TaskBlueprintReviewRecord,
  type TaskDetail,
  type TaskSummary,
} from "@genergi/shared"

function now() {
  return new Date().toISOString()
}

const qualityIssueLabels: Record<BlueprintQualityIssueCategory, string> = {
  script_off_track: "文案跑偏",
  image_inconsistent: "画面不一致",
  character_unstable: "人物不稳定",
  low_image_quality: "画质不够",
  poor_motion: "动作不自然",
  subtitle_issue: "字幕问题",
  voice_issue: "配音问题",
  other: "其他",
}

const qualityIssueDefaultSlots: Record<BlueprintQualityIssueCategory, BlueprintQualityFeedbackSlot | null> = {
  script_off_track: "textModel",
  image_inconsistent: "imageModel",
  character_unstable: "imageModel",
  low_image_quality: "imageModel",
  poor_motion: "videoModel",
  subtitle_issue: "ttsProvider",
  voice_issue: "ttsProvider",
  other: null,
}

const sensitiveQualityNotePattern =
  /(bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|token)=\S+)/gi

function sanitizeQualityFeedbackNote(value: string | null | undefined) {
  const normalized = value?.trim()
  if (!normalized) {
    return null
  }
  return normalized.replace(sensitiveQualityNotePattern, "[REDACTED]").slice(0, 500)
}

function buildSceneContractsFromTaskDetail(detail: TaskDetail): ExecutionBlueprint["sceneContracts"] {
  const executionBrief = detail.taskRunConfig.executionBrief
  return detail.scenes.map((scene: StoryboardScene, sceneIndex) => {
    const keyframePlan =
      executionBrief?.keyframePlan?.find((plan) => plan.index === scene.index + 1) ??
      executionBrief?.keyframePlan?.find((plan) => plan.index === scene.index) ??
      executionBrief?.keyframePlan?.[sceneIndex] ??
      null
    const visualGoal = keyframePlan?.visualGoal
    return {
      id: scene.id,
      index: scene.index,
      sceneGoal: visualGoal || scene.sceneGoal || scene.title,
      voiceoverScript: scene.voiceoverScript ?? scene.script,
      startFrameDescription: visualGoal || scene.startFrameDescription || scene.title,
      imagePrompt: keyframePlan?.imagePrompt || scene.imagePrompt,
      videoPrompt: keyframePlan?.videoPrompt || scene.videoPrompt,
      startFrameIntent: visualGoal || scene.startFrameIntent || scene.title,
      endFrameIntent: scene.endFrameIntent ?? scene.title,
      durationSec: scene.durationSec,
      transitionHint: "cut",
      continuityConstraints: scene.continuityConstraints ?? [],
    }
  })
}

export function buildInitialBlueprintFromTaskDetail(detail: TaskDetail): ExecutionBlueprint {
  const version = detail.blueprintVersion > 0 ? detail.blueprintVersion : 1
  return {
    taskId: detail.taskId,
    projectId: detail.projectId,
    version,
    createdAt: detail.updatedAt,
    executionMode: detail.taskRunConfig.executionMode,
    renderSpec: detail.taskRunConfig.renderSpecJson,
    globalTheme: detail.title,
    visualStyleGuide: detail.visualStyleGuide ?? "沿用当前任务风格基线。",
    subjectProfile: "根据任务内容母本自动推断主体。",
    productProfile: detail.ctaLine ?? "根据任务内容母本自动推断产品与转化目标。",
    backgroundConstraints: [],
    negativeConstraints: ["无字幕", "无水印", "无界面元素"],
    totalVoiceoverScript: detail.script,
    bilingualUnderstandingPreview: detail.taskRunConfig.understandingPreview,
    englishExecutionBrief: detail.taskRunConfig.executionBrief,
    sceneContracts: buildSceneContractsFromTaskDetail(detail),
  }
}

export async function listTaskBlueprints(taskId: string): Promise<TaskBlueprintRecord[]> {
  const records = await readTaskBlueprintRecords()
  return (records[taskId] ?? []).slice().sort((left, right) => left.version - right.version)
}

export async function getTaskBlueprintByVersion(taskId: string, version: number): Promise<TaskBlueprintRecord | null> {
  const records = await listTaskBlueprints(taskId)
  return records.find((record) => record.version === version) ?? null
}

export async function getCurrentTaskBlueprint(taskId: string): Promise<TaskBlueprintRecord | null> {
  const records = await listTaskBlueprints(taskId)
  return records.at(-1) ?? null
}

export async function listTaskBlueprintReviews(taskId: string): Promise<TaskBlueprintReviewRecord[]> {
  const records = await readTaskBlueprintReviewRecords()
  return (records[taskId] ?? []).slice().sort((left, right) => left.decidedAt.localeCompare(right.decidedAt))
}

export async function getLatestTaskBlueprintReview(
  taskId: string,
  blueprintVersion: number,
): Promise<TaskBlueprintReviewRecord | null> {
  const reviews = await listTaskBlueprintReviews(taskId)
  return reviews.filter((review) => review.blueprintVersion === blueprintVersion).at(-1) ?? null
}

async function syncTaskBlueprintSnapshot(
  taskId: string,
  version: number,
  status: TaskBlueprintRecord["status"],
  updatedAt: string,
) {
  const tasks = await readTaskSummaries()
  let nextTask: TaskSummary | null = null
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) {
      return task
    }

    nextTask = {
      ...task,
      blueprintVersion: version,
      blueprintStatus: status,
      updatedAt,
    }
    return nextTask
  })

  if (nextTask) {
    await writeTaskSummaries(nextTasks)
  }

  const detail = await readTaskDetail(taskId)
  if (!detail) {
    return nextTask
  }

  await upsertTaskDetail({
    ...detail,
    blueprintVersion: version,
    blueprintStatus: status,
    taskRunConfig: {
      ...detail.taskRunConfig,
      blueprintVersion: version,
      blueprintStatus: status,
    },
    updatedAt,
  })

  return nextTask
}

export async function upsertTaskBlueprintRecord(record: TaskBlueprintRecord): Promise<TaskBlueprintRecord> {
  const records = await readTaskBlueprintRecords()
  const current = records[record.taskId] ?? []
  const next = current.filter((item) => item.version !== record.version)
  next.push(record)
  records[record.taskId] = next.sort((left, right) => left.version - right.version)
  await writeTaskBlueprintRecords(records)
  await syncTaskBlueprintSnapshot(record.taskId, record.version, record.status, record.updatedAt)
  return record
}

export async function createInitialTaskBlueprintRecord(detail: TaskDetail): Promise<TaskBlueprintRecord> {
  const existing = await getCurrentTaskBlueprint(detail.taskId)
  if (existing) {
    return existing
  }

  const createdAt = now()
  const blueprint = buildInitialBlueprintFromTaskDetail(detail)
  const record: TaskBlueprintRecord = {
    taskId: detail.taskId,
    version: blueprint.version,
    status: detail.blueprintStatus,
    createdAt,
    updatedAt: createdAt,
    blueprint,
    keyframeManifestPath: null,
  }
  return upsertTaskBlueprintRecord(record)
}

export async function createTaskBlueprintVersion(input: {
  taskId: string
  blueprint: Omit<PlannedExecutionBlueprint, "executionMode" | "renderSpec">
  status?: TaskBlueprintRecord["status"]
  keyframeManifestPath?: string | null
}): Promise<TaskBlueprintRecord | null> {
  const tasks = await readTaskSummaries()
  const task = tasks.find((item) => item.id === input.taskId)
  if (!task) {
    return null
  }

  const current = await getCurrentTaskBlueprint(input.taskId)
  const createdAt = now()
  const version = Math.max(current?.version ?? 0, task.blueprintVersion ?? 0) + 1
  const record: TaskBlueprintRecord = {
    taskId: input.taskId,
    version,
    status: input.status ?? "ready_for_review",
    createdAt,
    updatedAt: createdAt,
    blueprint: {
      taskId: input.taskId,
      projectId: task.projectId,
      version,
      createdAt,
      executionMode: task.executionMode,
      renderSpec: task.renderSpecJson,
      ...input.blueprint,
    },
    keyframeManifestPath: input.keyframeManifestPath ?? null,
  }

  return upsertTaskBlueprintRecord(record)
}

export async function recordTaskBlueprintReview(input: {
  taskId: string
  blueprintVersion: number
  decision: BlueprintReviewDecision
  note?: string
  operator?: string
  qualityReasons?: Array<{
    slotType?: BlueprintQualityFeedbackSlot | null
    issueCategory: BlueprintQualityIssueCategory
    note?: string | null
  }>
}): Promise<TaskBlueprintReviewRecord> {
  const records = await readTaskBlueprintReviewRecords()
  const decidedAt = now()
  const qualityFeedback: TaskBlueprintQualityFeedbackRecord[] = input.decision === "rejected"
    ? (input.qualityReasons ?? []).map((reason) => ({
        taskId: input.taskId,
        blueprintVersion: input.blueprintVersion,
        slotType: reason.slotType ?? qualityIssueDefaultSlots[reason.issueCategory],
        issueCategory: reason.issueCategory,
        reasonLabel: qualityIssueLabels[reason.issueCategory],
        note: sanitizeQualityFeedbackNote(reason.note),
        operator: input.operator?.trim() || "system",
        createdAt: decidedAt,
      }))
    : []
  const nextRecord: TaskBlueprintReviewRecord = {
    taskId: input.taskId,
    blueprintVersion: input.blueprintVersion,
    decision: input.decision,
    note: input.note?.trim() || null,
    qualityFeedback,
    decidedAt,
  }
  records[input.taskId] = [...(records[input.taskId] ?? []), nextRecord]
  await writeTaskBlueprintReviewRecords(records)
  return nextRecord
}

export async function updateTaskBlueprintStatus(taskId: string, version: number, status: TaskBlueprintRecord["status"]) {
  const records = await readTaskBlueprintRecords()
  const next = (records[taskId] ?? []).map((record) =>
    record.version === version
      ? {
          ...record,
          status,
          updatedAt: now(),
        }
      : record,
  )
  records[taskId] = next
  await writeTaskBlueprintRecords(records)
  const updated = next.find((record) => record.version === version) ?? null
  if (updated) {
    await syncTaskBlueprintSnapshot(taskId, updated.version, updated.status, updated.updatedAt)
  }
  return updated
}

export async function approveTaskBlueprint(input: {
  taskId: string
  projectId: string
  blueprintVersion: number
}): Promise<ProjectApprovedBlueprintRecord | null> {
  const current = await getTaskBlueprintByVersion(input.taskId, input.blueprintVersion)
  if (!current) {
    return null
  }

  const approved = await updateTaskBlueprintStatus(input.taskId, input.blueprintVersion, "approved")
  if (!approved) {
    return null
  }

  const library = await readProjectApprovedBlueprintLibrary()
  const entry: ProjectApprovedBlueprintRecord = {
    projectId: input.projectId,
    taskId: input.taskId,
    blueprintVersion: input.blueprintVersion,
    approvedAt: approved.updatedAt,
    blueprint: approved.blueprint,
  }
  library[input.projectId] = [
    ...(library[input.projectId] ?? []).filter(
      (record) => !(record.taskId === input.taskId && record.blueprintVersion === input.blueprintVersion),
    ),
    entry,
  ]
  await writeProjectApprovedBlueprintLibrary(library)
  return entry
}

export async function rejectTaskBlueprint(input: {
  taskId: string
  blueprintVersion: number
}): Promise<TaskBlueprintRecord | null> {
  return updateTaskBlueprintStatus(input.taskId, input.blueprintVersion, "rejected")
}

export async function queueTaskBlueprintForVideo(input: {
  taskId: string
  blueprintVersion: number
}): Promise<TaskBlueprintRecord | null> {
  return updateTaskBlueprintStatus(input.taskId, input.blueprintVersion, "queued_for_video")
}
