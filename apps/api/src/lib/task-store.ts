import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { buildDefaultTaskRunConfig, estimateCost } from "@genergi/config"
import type { CreateTaskInput, TaskSummary, TaskStatus } from "@genergi/shared"

const dataDir = path.resolve(process.cwd(), ".data")
const tasksFile = path.join(dataDir, "tasks.json")
const tempTasksFile = path.join(dataDir, "tasks.tmp.json")

function now() {
  return new Date().toISOString()
}

function seedTasks(): TaskSummary[] {
  return [
    {
      id: "task_seed_001",
      title: "Summer Product Hook Series",
      modeId: "mass_production",
      channelId: "tiktok",
      status: "running",
      progressPct: 40,
      retryCount: 0,
      estimatedCostCny: 2.4,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "task_seed_002",
      title: "Feature Review Promo V3",
      modeId: "high_quality",
      channelId: "reels",
      status: "failed",
      progressPct: 62,
      retryCount: 2,
      estimatedCostCny: 4.5,
      createdAt: now(),
      updatedAt: now(),
    },
  ]
}

async function writeTasks(tasks: TaskSummary[]) {
  await writeFile(tempTasksFile, JSON.stringify(tasks, null, 2), "utf8")
  await rename(tempTasksFile, tasksFile)
}

async function ensureDataFile() {
  await mkdir(dataDir, { recursive: true })
  try {
    const content = await readFile(tasksFile, "utf8")
    if (!content.trim()) {
      await writeTasks(seedTasks())
    }
  } catch {
    await writeTasks(seedTasks())
  }
}

export async function listTasks(): Promise<TaskSummary[]> {
  await ensureDataFile()
  const content = await readFile(tasksFile, "utf8")
  if (!content.trim()) {
    const tasks = seedTasks()
    await writeTasks(tasks)
    return tasks
  }

  try {
    return JSON.parse(content) as TaskSummary[]
  } catch {
    const tasks = seedTasks()
    await writeTasks(tasks)
    return tasks
  }
}

export async function createTask(input: CreateTaskInput): Promise<{ task: TaskSummary; taskRunConfig: unknown }> {
  const tasks = await listTasks()
  const estimate = estimateCost(input.modeId)
  const timestamp = now()
  const task: TaskSummary = {
    id: `task_${Date.now()}`,
    title: input.title,
    modeId: input.modeId,
    channelId: input.channelId,
    status: "queued" satisfies TaskStatus,
    progressPct: 0,
    retryCount: 0,
    estimatedCostCny: estimate.budgetUsagePct / 100 * buildDefaultTaskRunConfig(input.modeId, input.channelId).budgetLimitCny,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  tasks.unshift(task)
  await writeTasks(tasks)

  return {
    task,
    taskRunConfig: buildDefaultTaskRunConfig(input.modeId, input.channelId),
  }
}
