import { Queue, Worker } from "bullmq"
import { Redis } from "ioredis"
import { TASK_QUEUE_NAME, readTaskDetail, updateRuntimeStatus, updateTaskSummary, upsertTaskAssets } from "@genergi/shared"
import type { AssetRecord, TaskSummary } from "@genergi/shared"

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

async function writeTaskArtifacts(taskId: string) {
  const detail = await readTaskDetail(taskId)
  const now = new Date().toISOString()
  const assets: AssetRecord[] = [
    {
      id: `${taskId}_script`,
      taskId,
      assetType: "script",
      label: "英文脚本",
      status: "ready",
      path: `${process.env.GENERGI_DATA_DIR ?? ".data"}/exports/${taskId}/script.txt`,
      createdAt: now,
    },
    {
      id: `${taskId}_storyboard`,
      taskId,
      assetType: "storyboard",
      label: "分镜 JSON",
      status: "ready",
      path: `${process.env.GENERGI_DATA_DIR ?? ".data"}/exports/${taskId}/storyboard.json`,
      createdAt: now,
    },
    {
      id: `${taskId}_subtitles`,
      taskId,
      assetType: "subtitles",
      label: "英文字幕",
      status: "ready",
      path: `${process.env.GENERGI_DATA_DIR ?? ".data"}/exports/${taskId}/subtitles.srt`,
      createdAt: now,
    },
    {
      id: `${taskId}_audio`,
      taskId,
      assetType: "audio",
      label: `Edge TTS (${detail?.taskRunConfig.ttsProvider ?? "edge-tts"})`,
      status: "ready",
      path: `${process.env.GENERGI_DATA_DIR ?? ".data"}/exports/${taskId}/narration.mp3`,
      createdAt: now,
    },
    {
      id: `${taskId}_keyframes`,
      taskId,
      assetType: "keyframe_bundle",
      label: `${detail?.scenes.length ?? 0} 个关键帧记录`,
      status: "ready",
      path: `${process.env.GENERGI_DATA_DIR ?? ".data"}/exports/${taskId}/keyframes/`,
      createdAt: now,
    },
    {
      id: `${taskId}_video`,
      taskId,
      assetType: "video_bundle",
      label: "视频片段与成片记录",
      status: "ready",
      path: `${process.env.GENERGI_DATA_DIR ?? ".data"}/exports/${taskId}/video/`,
      createdAt: now,
    },
  ]

  await upsertTaskAssets(taskId, assets)
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

    await writeTaskArtifacts(taskId)
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
