import { Queue, Worker } from "bullmq"
import { Redis } from "ioredis"
import { TASK_QUEUE_NAME, updateRuntimeStatus, updateTaskSummary } from "@genergi/shared"
import type { TaskSummary } from "@genergi/shared"

const redisUrl = process.env.REDIS_URL

if (!redisUrl) {
  console.log("GENERGI worker started without REDIS_URL. Queue processing is disabled in local bootstrap mode.")
  process.exit(0)
}

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
const queue = new Queue(TASK_QUEUE_NAME, { connection })

async function writeWorkerHeartbeat(message: string, status: "healthy" | "degraded" = "healthy") {
  await updateRuntimeStatus((current) => ({
    ...current,
    worker: {
      name: "worker",
      status,
      updatedAt: new Date().toISOString(),
      message,
    },
    redis: {
      name: "redis",
      status: "healthy",
      updatedAt: new Date().toISOString(),
      message: "Redis queue connected",
    },
  }))
}

const worker = new Worker(
  TASK_QUEUE_NAME,
  async (job: { id?: string; data: { taskId: string } }) => {
    const taskId = job.data.taskId

    await writeWorkerHeartbeat(`Processing ${taskId}`)

    // 先把任务推进到运行态，避免前台一直停留在 queued。
    await updateTaskSummary(taskId, (task: TaskSummary) => ({
      ...task,
      status: "running",
      progressPct: 20,
      updatedAt: new Date().toISOString(),
    }))

    await new Promise((resolve) => setTimeout(resolve, 800))

    await updateTaskSummary(taskId, (task: TaskSummary) => ({
      ...task,
      status: "running",
      progressPct: 65,
      updatedAt: new Date().toISOString(),
    }))

    await new Promise((resolve) => setTimeout(resolve, 800))

    await updateTaskSummary(taskId, (task: TaskSummary) => ({
      ...task,
      status: "completed",
      progressPct: 100,
      updatedAt: new Date().toISOString(),
    }))

    await writeWorkerHeartbeat(`Last completed ${taskId}`)
    console.log(`Processing task ${taskId}`)
    return { ok: true, taskId: job.data.taskId }
  },
  { connection },
)

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`)
})

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed`, error)
})

console.log(`GENERGI worker listening on queue ${TASK_QUEUE_NAME}`)
void writeWorkerHeartbeat("Worker online")
const heartbeat = setInterval(() => {
  void writeWorkerHeartbeat("Worker online")
}, 15000)
heartbeat.unref()
void queue.waitUntilReady()
