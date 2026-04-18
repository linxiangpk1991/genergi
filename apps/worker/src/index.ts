import { Queue, Worker } from "bullmq"
import { Redis } from "ioredis"
import {
  TASK_QUEUE_NAME,
  mergeSceneReviewMetadata,
  readTaskDetail,
  updateRuntimeStatus,
  updateTaskSummary,
  upsertTaskAssets,
  upsertTaskDetail,
} from "@genergi/shared"
import type { AssetRecord, TaskSummary } from "@genergi/shared"
import {
  buildFinalVideoWithNarration,
  createFallbackKeyframeBundleFromVideos,
  createKeyframeBundle,
  createSceneVideoBundle,
  resolveRuntimeGenerationConfig,
  rewriteTaskWithTextProvider,
  synthesizeNarration,
  writeTaskSourceFiles,
} from "./lib/providers.js"

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

  if (!detail) {
    throw new Error(`Task detail not found for ${taskId}`)
  }

  const mergeLatestReviewMetadata = async <TDetail extends typeof detail>(detailToPersist: TDetail): Promise<TDetail> => {
    const latestDetail = await readTaskDetail(taskId)
    if (!latestDetail) {
      return detailToPersist
    }

    return {
      ...detailToPersist,
      scenes: mergeSceneReviewMetadata(detailToPersist.scenes, latestDetail.scenes),
    }
  }

  const preparedDetail = await mergeLatestReviewMetadata(await rewriteTaskWithTextProvider(detail))
  const runtime = resolveRuntimeGenerationConfig(preparedDetail)
  await upsertTaskDetail(preparedDetail)
  await writeWorkerHeartbeat(`Preparing source files for ${taskId}`)
  const taskDir = await writeTaskSourceFiles(preparedDetail)
  await writeWorkerHeartbeat(`Synthesizing narration for ${taskId}`)
  const narration = await synthesizeNarration(preparedDetail)
  const firstScene = preparedDetail.scenes[0]
  await writeWorkerHeartbeat(`Creating scene videos for ${taskId}`)
  const sceneVideos = await createSceneVideoBundle({
    taskId,
    detail: preparedDetail,
    model: runtime.videoModelId,
    onSceneStart: async (scene, totalScenes) => {
      await writeWorkerHeartbeat(`Generating scene ${scene.index + 1}/${totalScenes} for ${taskId}`)
    },
  })
  let keyframes
  try {
    await writeWorkerHeartbeat(`Generating keyframes for ${taskId}`)
    keyframes = await Promise.race([
      createKeyframeBundle({
        taskId,
        detail: preparedDetail,
        model: runtime.imageModelId,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Image generation timeout, switching to video-derived keyframe")), 30000),
      ),
    ])
  } catch (error) {
    console.warn(`[worker] ${taskId} image keyframe generation failed, fallback to video frame:`, error instanceof Error ? error.message : String(error))
    await writeWorkerHeartbeat(`Falling back to video-derived keyframe for ${taskId}`, "degraded")
    keyframes = await createFallbackKeyframeBundleFromVideos({
      taskId,
      scenes: preparedDetail.scenes,
      sceneVideos,
    })
  }
  await writeWorkerHeartbeat(`Muxing final video for ${taskId}`)
  const finalVideo = await buildFinalVideoWithNarration({
    taskId,
    sourceVideoPaths: sceneVideos.map((sceneVideo) => sceneVideo.videoPath),
    narrationPath: narration.audioPath,
    targetDurationSec: preparedDetail.taskRunConfig.targetDurationSec,
  })
  await upsertTaskDetail(
    await mergeLatestReviewMetadata({
      ...preparedDetail,
      actualDurationSec: finalVideo.actualDurationSec,
    }),
  )
  await updateTaskSummary(taskId, (task: TaskSummary) => ({
    ...task,
    actualDurationSec: finalVideo.actualDurationSec,
  }))

  const assets: AssetRecord[] = [
    {
      id: `${taskId}_script`,
      taskId,
      assetType: "script",
      label: "英文脚本",
      status: "ready",
      path: `${taskDir}/script.txt`,
      createdAt: now,
    },
    {
      id: `${taskId}_storyboard`,
      taskId,
      assetType: "storyboard",
      label: "分镜 JSON",
      status: "ready",
      path: `${taskDir}/storyboard.json`,
      createdAt: now,
    },
    {
      id: `${taskId}_subtitles`,
      taskId,
      assetType: "subtitles",
      label: "英文字幕",
      status: "ready",
      path: narration.srtPath,
      createdAt: now,
    },
    {
      id: `${taskId}_audio`,
      taskId,
      assetType: "audio",
      label: `${runtime.ttsLabel} (${runtime.ttsProvider})`,
      status: "ready",
      path: narration.audioPath,
      createdAt: now,
    },
    {
      id: `${taskId}_keyframes`,
      taskId,
      assetType: "keyframe_bundle",
      label: `关键帧包 (${keyframes.frameCount} 张)`,
      status: "ready",
      path: keyframes.manifestPath,
      createdAt: now,
    },
    {
      id: `${taskId}_video`,
      taskId,
      assetType: "video_bundle",
      label: `真实视频输出 (${sceneVideos.length} scenes / ${preparedDetail.taskRunConfig.targetDurationSec}s)`,
      status: "ready",
      path: finalVideo.outputPath,
      createdAt: now,
    },
  ]

  await upsertTaskAssets(taskId, assets)
}

const worker = new Worker(
  TASK_QUEUE_NAME,
  async (job: { id?: string; data: { taskId: string } }) => {
    const taskId = job.data.taskId

    try {
      await writeWorkerHeartbeat(`Processing ${taskId}`)

      // 先把任务推进到运行态，避免前台一直停留在 queued。
      await updateTaskSummary(taskId, (task: TaskSummary) => ({
        ...task,
        status: "running",
        progressPct: 20,
        updatedAt: new Date().toISOString(),
      }))

      console.log(`[worker] ${taskId} => prepare source files + TTS`)
      await new Promise((resolve) => setTimeout(resolve, 800))

      await updateTaskSummary(taskId, (task: TaskSummary) => ({
        ...task,
        status: "running",
        progressPct: 65,
        updatedAt: new Date().toISOString(),
      }))

      console.log(`[worker] ${taskId} => generate media assets`)
      await writeTaskArtifacts(taskId)

      await updateTaskSummary(taskId, (task: TaskSummary) => ({
        ...task,
        status: "completed",
        progressPct: 100,
        updatedAt: new Date().toISOString(),
      }))

      await writeWorkerHeartbeat(`Last completed ${taskId}`)
      console.log(`[worker] ${taskId} => completed`)
      return { ok: true, taskId: job.data.taskId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await updateTaskSummary(taskId, (task: TaskSummary) => ({
        ...task,
        status: "failed",
        progressPct: Math.min(task.progressPct, 65),
        retryCount: task.retryCount + 1,
        updatedAt: new Date().toISOString(),
      }))
      await writeWorkerHeartbeat(`Last failed ${taskId}: ${message}`, "degraded")
      console.error(`[worker] ${taskId} => failed`, error)
      throw error
    }
  },
  {
    connection,
    lockDuration: 30 * 60 * 1000,
    stalledInterval: 60 * 1000,
    maxStalledCount: 1,
  },
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
