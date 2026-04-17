import { buildDefaultTaskRunConfig, estimateCost } from "@genergi/config"
import { readTaskAssets, readTaskDetail, readTaskSummaries, upsertTaskDetail, writeTaskSummaries } from "@genergi/shared"
import type { CreateTaskInput, StoryboardScene, TaskDetail, TaskSummary, TaskStatus } from "@genergi/shared"

function now() {
  return new Date().toISOString()
}

function buildScenes(script: string): StoryboardScene[] {
  return Array.from({ length: 4 }, (_, index) => {
    const sceneNo = index + 1
    return {
      id: `scene_${sceneNo}`,
      index,
      title: `Scene ${sceneNo}`,
      script:
        sceneNo === 1
          ? `${script} Start with an immediate hook and a highly visible problem.`
          : sceneNo === 2
            ? "Show the product in action and establish why it feels like the obvious upgrade."
            : sceneNo === 3
              ? "Layer in proof, visual trust signals, or a concrete before/after moment."
              : "Close with a direct CTA designed for short-form English social video.",
      imagePrompt: `Vertical hero frame for scene ${sceneNo}, premium product focus, social-first composition, English-speaking market aesthetic.`,
      videoPrompt: `Generate a 9:16 video for scene ${sceneNo} with strong pacing, platform-native movement, and clear product readability.`,
      durationSec: 4,
      startLabel: `00:${String(index * 4).padStart(2, "0")}`,
      endLabel: `00:${String((index + 1) * 4).padStart(2, "0")}`,
      reviewStatus: index === 0 ? "approved" : "pending",
      keyframeStatus: "pending",
    }
  })
}

export async function listTasks(): Promise<TaskSummary[]> {
  return readTaskSummaries()
}

export async function getTaskDetail(taskId: string) {
  const existing = await readTaskDetail(taskId)
  if (existing) {
    return existing
  }

  const tasks = await listTasks()
  const task = tasks.find((item) => item.id === taskId)
  if (!task) {
    return null
  }

  const taskRunConfig = buildDefaultTaskRunConfig(task.modeId, task.channelId)
  const synthesized: TaskDetail = {
    taskId: task.id,
    title: task.title,
    script: `${task.title}. Keep the tone native-English, product-forward, and optimized for short-form social video.`,
    taskRunConfig,
    scenes: buildScenes(task.title),
    updatedAt: task.updatedAt,
  }

  await upsertTaskDetail(synthesized)
  return synthesized
}

export async function getTaskAssets(taskId: string) {
  return readTaskAssets(taskId)
}

export async function createTask(input: CreateTaskInput): Promise<{ task: TaskSummary; taskRunConfig: unknown }> {
  const tasks = await listTasks()
  const estimate = estimateCost(input.modeId)
  const timestamp = now()
  const taskRunConfig = buildDefaultTaskRunConfig(input.modeId, input.channelId)
  const task: TaskSummary = {
    id: `task_${Date.now()}`,
    title: input.title,
    modeId: input.modeId,
    channelId: input.channelId,
    status: "queued" satisfies TaskStatus,
    progressPct: 0,
    retryCount: 0,
    estimatedCostCny: estimate.budgetUsagePct / 100 * taskRunConfig.budgetLimitCny,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  tasks.unshift(task)
  await writeTaskSummaries(tasks)
  const detail: TaskDetail = {
    taskId: task.id,
    title: task.title,
    script: input.script,
    taskRunConfig,
    scenes: buildScenes(input.script),
    updatedAt: timestamp,
  }
  await upsertTaskDetail(detail)

  return {
    task,
    taskRunConfig,
  }
}
