import {
  readProjectApprovedBlueprintLibrary,
  readTaskBlueprintRecords,
  readTaskBlueprintReviewRecords,
  writeProjectApprovedBlueprintLibrary,
  writeTaskBlueprintRecords,
  writeTaskBlueprintReviewRecords,
  type BlueprintReviewDecision,
  type ExecutionBlueprint,
  type ProjectApprovedBlueprintRecord,
  type StoryboardScene,
  type TaskBlueprintRecord,
  type TaskBlueprintReviewRecord,
  type TaskDetail,
} from "@genergi/shared"

function now() {
  return new Date().toISOString()
}

function buildSceneContractsFromTaskDetail(detail: TaskDetail): ExecutionBlueprint["sceneContracts"] {
  return detail.scenes.map((scene: StoryboardScene) => ({
    id: scene.id,
    index: scene.index,
    sceneGoal: scene.sceneGoal ?? scene.title,
    voiceoverScript: scene.voiceoverScript ?? scene.script,
    startFrameDescription: scene.startFrameDescription ?? scene.title,
    imagePrompt: scene.imagePrompt,
    videoPrompt: scene.videoPrompt,
    startFrameIntent: scene.startFrameIntent ?? scene.title,
    endFrameIntent: scene.endFrameIntent ?? scene.title,
    durationSec: scene.durationSec,
    transitionHint: "cut",
    continuityConstraints: scene.continuityConstraints ?? [],
  }))
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
    sceneContracts: buildSceneContractsFromTaskDetail(detail),
  }
}

export async function listTaskBlueprints(taskId: string): Promise<TaskBlueprintRecord[]> {
  const records = await readTaskBlueprintRecords()
  return (records[taskId] ?? []).slice().sort((left, right) => left.version - right.version)
}

export async function getCurrentTaskBlueprint(taskId: string): Promise<TaskBlueprintRecord | null> {
  const records = await listTaskBlueprints(taskId)
  return records.at(-1) ?? null
}

export async function upsertTaskBlueprintRecord(record: TaskBlueprintRecord): Promise<TaskBlueprintRecord> {
  const records = await readTaskBlueprintRecords()
  const current = records[record.taskId] ?? []
  const next = current.filter((item) => item.version !== record.version)
  next.push(record)
  records[record.taskId] = next.sort((left, right) => left.version - right.version)
  await writeTaskBlueprintRecords(records)
  return record
}

export async function createInitialTaskBlueprintRecord(detail: TaskDetail): Promise<TaskBlueprintRecord> {
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

export async function recordTaskBlueprintReview(input: {
  taskId: string
  blueprintVersion: number
  decision: BlueprintReviewDecision
  note?: string
}): Promise<TaskBlueprintReviewRecord> {
  const records = await readTaskBlueprintReviewRecords()
  const nextRecord: TaskBlueprintReviewRecord = {
    taskId: input.taskId,
    blueprintVersion: input.blueprintVersion,
    decision: input.decision,
    note: input.note?.trim() || null,
    decidedAt: now(),
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
  return next.find((record) => record.version === version) ?? null
}

export async function approveTaskBlueprint(input: {
  taskId: string
  projectId: string
  blueprintVersion: number
}): Promise<ProjectApprovedBlueprintRecord | null> {
  const current = await getCurrentTaskBlueprint(input.taskId)
  if (!current || current.version !== input.blueprintVersion) {
    return null
  }

  await updateTaskBlueprintStatus(input.taskId, input.blueprintVersion, "approved")

  const library = await readProjectApprovedBlueprintLibrary()
  const entry: ProjectApprovedBlueprintRecord = {
    projectId: input.projectId,
    taskId: input.taskId,
    blueprintVersion: input.blueprintVersion,
    approvedAt: now(),
    blueprint: current.blueprint,
  }
  library[input.projectId] = [...(library[input.projectId] ?? []), entry]
  await writeProjectApprovedBlueprintLibrary(library)
  return entry
}

export async function rejectTaskBlueprint(input: {
  taskId: string
  blueprintVersion: number
}): Promise<TaskBlueprintRecord | null> {
  return updateTaskBlueprintStatus(input.taskId, input.blueprintVersion, "rejected")
}
