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
  buildProgressAssetRecords,
  buildKeyframeAssetRecords,
  buildTaskDocumentAssetRecords,
  buildWorkerRuntimeLabels,
  buildFinalVideoWithNarration,
  createFallbackKeyframeBundleFromVideos,
  createKeyframeBundle,
  createSceneVideoBundle,
  describeRuntimeGenerationConfig,
  prepareTaskBlueprint,
  resolveKeyframeGenerationTimeoutPolicy,
  resolveRuntimeGenerationConfig,
  synthesizeNarration,
  TASK_CANCELED_BY_OPERATOR,
  upsertTaskBlueprintSnapshot,
  writeTaskSourceFiles,
} from "./lib/providers.js"

const redisUrl = process.env.REDIS_URL

if (!redisUrl) {
  console.log("GENERGI worker started without REDIS_URL. Queue processing is disabled in local bootstrap mode.")
  process.exit(0)
}

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
const queue = new Queue(TASK_QUEUE_NAME, { connection })

function isTaskCanceledError(error: unknown) {
  if (error instanceof Error) {
    return error.message === TASK_CANCELED_BY_OPERATOR || error.name === "CanceledError"
  }
  return false
}

async function updateTaskLifecycleState(taskId: string, patch: {
  status?: TaskSummary["status"]
  progressPct?: number
  failureReason?: string | null
  statusDetail?: string | null
}) {
  const updatedAt = new Date().toISOString()
  await updateTaskSummary(taskId, (task: TaskSummary) => ({
    ...task,
    ...(patch.status ? { status: patch.status } : {}),
    ...(typeof patch.progressPct === "number" ? { progressPct: patch.progressPct } : {}),
    ...(patch.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
    ...(patch.statusDetail !== undefined ? { statusDetail: patch.statusDetail } : {}),
    updatedAt,
  }))

  const detail = await readTaskDetail(taskId)
  if (!detail) {
    return
  }

  await upsertTaskDetail({
    ...detail,
    ...(patch.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
    ...(patch.statusDetail !== undefined ? { statusDetail: patch.statusDetail } : {}),
    updatedAt,
  })
}

function startTaskCancellationWatcher(taskId: string, controller: AbortController) {
  const checkOnce = () =>
    void readTaskDetail(taskId)
      .then((detail) => {
        if (detail?.cancelRequestedAt && !controller.signal.aborted) {
          controller.abort(TASK_CANCELED_BY_OPERATOR)
        }
      })
      .catch(() => {})

  checkOnce()
  const timer = setInterval(checkOnce, 1500)
  timer.unref()
  return () => clearInterval(timer)
}

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

async function writeTaskArtifacts(
  taskId: string,
  options: {
    continueExecution?: boolean
    signal?: AbortSignal
  } = {},
) {
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
      scenes: mergeSceneReviewMetadata(
        detailToPersist.scenes.map((scene) => ({
          ...scene,
          sceneGoal: scene.sceneGoal ?? scene.title,
          voiceoverScript: scene.voiceoverScript ?? scene.script,
          startFrameDescription: scene.startFrameDescription ?? scene.title,
          startFrameIntent: scene.startFrameIntent ?? scene.title,
          endFrameIntent: scene.endFrameIntent ?? scene.title,
          continuityConstraints: scene.continuityConstraints ?? [],
        })),
        latestDetail.scenes,
      ),
    }
  }

  const prepared = await prepareTaskBlueprint(detail)
  const preparedDetail = await mergeLatestReviewMetadata(prepared.detail)
  const planningTrace = prepared.planningTrace
  let blueprintRecord = prepared.blueprintRecord
  const runtime = resolveRuntimeGenerationConfig(preparedDetail)
  const runtimeSummary = describeRuntimeGenerationConfig(runtime)
  const runtimeLabels = buildWorkerRuntimeLabels(runtime, {
    sceneCount: preparedDetail.scenes.length,
    targetDurationSec: preparedDetail.taskRunConfig.targetDurationSec,
    keyframeCount: preparedDetail.scenes.length,
  })

  console.log(`[worker] ${taskId} runtime snapshot => ${runtimeSummary}`)
  await upsertTaskDetail(preparedDetail)
  await writeWorkerHeartbeat(`Preparing source files for ${taskId}`)
  await updateTaskLifecycleState(taskId, {
    status: "running",
    progressPct: 20,
    failureReason: null,
    statusDetail: "准备任务源文件",
  })
  const taskDir = await writeTaskSourceFiles(preparedDetail, planningTrace)
  await upsertTaskAssets(
    taskId,
    await buildProgressAssetRecords({
      taskId,
      taskDir,
      createdAt: now,
    }),
  )

  let keyframes:
    | {
        keyframeDir: string
        manifestPath: string
        frameCount: number
      }
    | null = null
  try {
    await writeWorkerHeartbeat(`Generating keyframes for ${taskId} with ${runtime.imageModelLabel}`)
    const keyframeTimeoutPolicy = resolveKeyframeGenerationTimeoutPolicy({
      detail: preparedDetail,
      continueExecution: options.continueExecution,
    })
    keyframes = await Promise.race([
      createKeyframeBundle({
        taskId,
        detail: preparedDetail,
        model: runtime.imageModelId,
        signal: options.signal,
        onSceneStart: async (scene, totalScenes) => {
          await updateTaskLifecycleState(taskId, {
            status: "running",
            progressPct: 40,
            failureReason: null,
            statusDetail: `关键画面生成中 ${scene.index + 1}/${totalScenes}`,
          })
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(keyframeTimeoutPolicy.onTimeoutMessage)), keyframeTimeoutPolicy.timeoutMs),
      ),
    ])
  } catch (error) {
    console.warn(`[worker] ${taskId} image keyframe generation failed:`, error instanceof Error ? error.message : String(error))
    if (preparedDetail.taskRunConfig.executionMode === "review_required" && !options.continueExecution) {
      throw error
    }
    await writeWorkerHeartbeat(`Image generation failed, will continue with prompt-only video path for ${taskId}`, "degraded")
    await updateTaskLifecycleState(taskId, {
      status: "running",
      progressPct: 55,
      failureReason: null,
      statusDetail: "关键画面超时，正在转视频导出关键帧",
    })
    keyframes = null
  }

  blueprintRecord = await upsertTaskBlueprintSnapshot({
    detail: preparedDetail,
    blueprint: {
      executionMode: blueprintRecord.blueprint.executionMode,
      renderSpec: blueprintRecord.blueprint.renderSpec,
      globalTheme: blueprintRecord.blueprint.globalTheme,
      visualStyleGuide: blueprintRecord.blueprint.visualStyleGuide,
      subjectProfile: blueprintRecord.blueprint.subjectProfile,
      productProfile: blueprintRecord.blueprint.productProfile,
      backgroundConstraints: blueprintRecord.blueprint.backgroundConstraints,
      negativeConstraints: blueprintRecord.blueprint.negativeConstraints,
      totalVoiceoverScript: blueprintRecord.blueprint.totalVoiceoverScript,
      sceneContracts: blueprintRecord.blueprint.sceneContracts,
    },
    status:
      preparedDetail.taskRunConfig.executionMode === "review_required" && !options.continueExecution
        ? "pending_generation"
        : "queued_for_video",
    keyframeManifestPath: keyframes?.manifestPath ?? blueprintRecord.keyframeManifestPath ?? null,
  })

  const blueprintAwareDetail = await mergeLatestReviewMetadata({
    ...preparedDetail,
    blueprintVersion: blueprintRecord.version,
    blueprintStatus: blueprintRecord.status,
    taskRunConfig: {
      ...preparedDetail.taskRunConfig,
      blueprintVersion: blueprintRecord.version,
      blueprintStatus: blueprintRecord.status,
    },
  })
  await upsertTaskDetail(blueprintAwareDetail)
  await upsertTaskAssets(
    taskId,
    await buildProgressAssetRecords({
      taskId,
      taskDir,
      createdAt: now,
      keyframeManifestPath: keyframes?.manifestPath ?? null,
      keyframeLabel: keyframes ? runtimeLabels.keyframes : null,
    }),
  )

  if (preparedDetail.taskRunConfig.executionMode === "review_required" && !options.continueExecution) {
    const previewAssets: AssetRecord[] = [
      ...await buildTaskDocumentAssetRecords({
        taskId,
        taskDir,
        createdAt: now,
      }),
      ...(keyframes
        ? await buildKeyframeAssetRecords({
            taskId,
            manifestPath: keyframes.manifestPath,
            label: buildWorkerRuntimeLabels(runtime, {
              sceneCount: preparedDetail.scenes.length,
              targetDurationSec: preparedDetail.taskRunConfig.targetDurationSec,
              keyframeCount: keyframes.frameCount,
            }).keyframes,
            createdAt: now,
          })
        : []),
    ]

    await upsertTaskAssets(taskId, previewAssets)
    blueprintRecord = await upsertTaskBlueprintSnapshot({
      detail: blueprintAwareDetail,
      blueprint: {
        executionMode: blueprintRecord.blueprint.executionMode,
        renderSpec: blueprintRecord.blueprint.renderSpec,
        globalTheme: blueprintRecord.blueprint.globalTheme,
        visualStyleGuide: blueprintRecord.blueprint.visualStyleGuide,
        subjectProfile: blueprintRecord.blueprint.subjectProfile,
        productProfile: blueprintRecord.blueprint.productProfile,
        backgroundConstraints: blueprintRecord.blueprint.backgroundConstraints,
        negativeConstraints: blueprintRecord.blueprint.negativeConstraints,
        totalVoiceoverScript: blueprintRecord.blueprint.totalVoiceoverScript,
        sceneContracts: blueprintRecord.blueprint.sceneContracts,
      },
      status: "ready_for_review",
      keyframeManifestPath: keyframes?.manifestPath ?? blueprintRecord.keyframeManifestPath ?? null,
    })
    await updateTaskSummary(taskId, (task: TaskSummary) => ({
      ...task,
      status: "waiting_review",
      progressPct: 45,
      statusDetail: "等待审核",
      blueprintVersion: blueprintRecord.version,
      blueprintStatus: blueprintRecord.status,
      updatedAt: new Date().toISOString(),
    }))
    await upsertTaskDetail({
      ...blueprintAwareDetail,
      statusDetail: "等待审核",
      updatedAt: new Date().toISOString(),
    })
    await writeWorkerHeartbeat(`Blueprint and keyframes ready for review for ${taskId}`)
    return { phase: "review_ready" as const }
  }

  await writeWorkerHeartbeat(`Creating scene videos for ${taskId} with ${runtime.videoModelLabel}`)
  const sceneVideos = await createSceneVideoBundle({
    taskId,
    detail: blueprintAwareDetail,
    model: runtime.videoModelId,
    blueprintRecord,
    onSceneStart: async (scene, totalScenes) => {
      await writeWorkerHeartbeat(`Generating scene ${scene.index + 1}/${totalScenes} for ${taskId}`)
      await updateTaskLifecycleState(taskId, {
        status: "running",
        progressPct: 72,
        failureReason: null,
        statusDetail: `正在生成 scene ${scene.index + 1}/${totalScenes}`,
      })
    },
    signal: options.signal,
  })

  if (!keyframes) {
    await writeWorkerHeartbeat(`Creating fallback keyframes from video outputs for ${taskId}`, "degraded")
    await updateTaskLifecycleState(taskId, {
      status: "running",
      progressPct: 82,
      failureReason: null,
      statusDetail: "关键画面超时，正在转视频导出关键帧",
    })
    keyframes = await createFallbackKeyframeBundleFromVideos({
      taskId,
      scenes: blueprintAwareDetail.scenes,
      sceneVideos,
    })
    blueprintRecord = await upsertTaskBlueprintSnapshot({
      detail: blueprintAwareDetail,
      blueprint: {
        executionMode: blueprintRecord.blueprint.executionMode,
        renderSpec: blueprintRecord.blueprint.renderSpec,
        globalTheme: blueprintRecord.blueprint.globalTheme,
        visualStyleGuide: blueprintRecord.blueprint.visualStyleGuide,
        subjectProfile: blueprintRecord.blueprint.subjectProfile,
        productProfile: blueprintRecord.blueprint.productProfile,
        backgroundConstraints: blueprintRecord.blueprint.backgroundConstraints,
        negativeConstraints: blueprintRecord.blueprint.negativeConstraints,
        totalVoiceoverScript: blueprintRecord.blueprint.totalVoiceoverScript,
        sceneContracts: blueprintRecord.blueprint.sceneContracts,
      },
      status: "queued_for_video",
      keyframeManifestPath: keyframes.manifestPath,
    })
  }

  await writeWorkerHeartbeat(`Synthesizing narration for ${taskId} with ${runtime.ttsLabel}`)
  await updateTaskLifecycleState(taskId, {
    status: "running",
    progressPct: 88,
    failureReason: null,
    statusDetail: "正在合成英文配音",
  })
  const narration = await synthesizeNarration(blueprintAwareDetail)
  await writeWorkerHeartbeat(`Muxing final video for ${taskId}`)
  await updateTaskLifecycleState(taskId, {
    status: "running",
    progressPct: 94,
    failureReason: null,
    statusDetail: "正在合成最终视频",
  })
  const finalVideo = await buildFinalVideoWithNarration({
    taskId,
    sourceVideoPaths: sceneVideos.map((sceneVideo) => sceneVideo.videoPath),
    narrationPath: narration.audioPath,
    subtitlesPath: narration.srtPath,
    renderSpec: preparedDetail.taskRunConfig.renderSpecJson,
    targetDurationSec: preparedDetail.taskRunConfig.targetDurationSec,
  })
  await upsertTaskDetail(
    await mergeLatestReviewMetadata({
      ...blueprintAwareDetail,
      actualDurationSec: finalVideo.actualDurationSec,
      blueprintStatus: "completed",
      taskRunConfig: {
        ...blueprintAwareDetail.taskRunConfig,
        blueprintStatus: "completed",
      },
    }),
  )
  await updateTaskSummary(taskId, (task: TaskSummary) => ({
    ...task,
    actualDurationSec: finalVideo.actualDurationSec,
    blueprintStatus: "completed",
  }))

  const assets: AssetRecord[] = [
    ...await buildTaskDocumentAssetRecords({
      taskId,
      taskDir,
      createdAt: now,
    }),
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
      label: runtimeLabels.audio,
      status: "ready",
      path: narration.audioPath,
      createdAt: now,
    },
    ...await buildKeyframeAssetRecords({
      taskId,
      manifestPath: keyframes.manifestPath,
      label: buildWorkerRuntimeLabels(runtime, {
        sceneCount: sceneVideos.length,
        targetDurationSec: preparedDetail.taskRunConfig.targetDurationSec,
        keyframeCount: keyframes.frameCount,
      }).keyframes,
      createdAt: now,
    }),
    {
      id: `${taskId}_video`,
      taskId,
      assetType: "video_bundle",
      label: buildWorkerRuntimeLabels(runtime, {
        sceneCount: sceneVideos.length,
        targetDurationSec: preparedDetail.taskRunConfig.targetDurationSec,
        keyframeCount: keyframes.frameCount,
      }).video,
      status: "ready",
      path: finalVideo.outputPath,
      createdAt: now,
    },
  ]

  await upsertTaskAssets(taskId, assets)
  return { phase: "completed" as const }
}

const worker = new Worker(
  TASK_QUEUE_NAME,
  async (job: {
    id?: string
    data: {
      taskId: string
      continueExecution?: boolean
      reason?: string | null
      blueprintVersion?: number | null
      stage?: string | null
      resumeFrom?: string | null
    }
  }) => {
    const taskId = job.data.taskId
    const taskAbortController = new AbortController()
    const stopCancelWatcher = startTaskCancellationWatcher(taskId, taskAbortController)

    try {
      await writeWorkerHeartbeat(`Processing ${taskId}`)
      await updateTaskLifecycleState(taskId, {
        status: "running",
        progressPct: 20,
        failureReason: null,
        statusDetail: "准备任务源文件",
      })

      console.log(`[worker] ${taskId} => prepare source files + TTS`)
      await new Promise((resolve) => setTimeout(resolve, 800))
      if (taskAbortController.signal.aborted) {
        throw new Error(TASK_CANCELED_BY_OPERATOR)
      }

      console.log(`[worker] ${taskId} => generate media assets`)
      const result = await writeTaskArtifacts(taskId, {
        continueExecution: job.data.continueExecution ?? false,
        signal: taskAbortController.signal,
      })

      if (result.phase === "review_ready") {
        console.log(`[worker] ${taskId} => waiting for blueprint review`)
        stopCancelWatcher()
        return { ok: true, taskId: job.data.taskId, phase: "review_ready" }
      }

      await updateTaskLifecycleState(taskId, {
        status: "completed",
        progressPct: 100,
        failureReason: null,
        statusDetail: "已完成",
      })

      await writeWorkerHeartbeat(`Last completed ${taskId}`)
      console.log(`[worker] ${taskId} => completed`)
      stopCancelWatcher()
      return { ok: true, taskId: job.data.taskId }
    } catch (error) {
      stopCancelWatcher()
      if (isTaskCanceledError(error)) {
        await updateTaskLifecycleState(taskId, {
          status: "canceled",
          failureReason: null,
          statusDetail: "任务已终止",
        })
        await writeWorkerHeartbeat(`Last canceled ${taskId}`, "degraded")
        return { ok: true, taskId: job.data.taskId, phase: "canceled" as const }
      }
      const message = error instanceof Error ? error.message : String(error)
      await updateTaskSummary(taskId, (task: TaskSummary) => ({
        ...task,
        status: "failed",
        failureReason: message,
        statusDetail: "任务失败",
        progressPct: Math.min(task.progressPct, 65),
        retryCount: task.retryCount + 1,
        updatedAt: new Date().toISOString(),
      }))
      const latestDetail = await readTaskDetail(taskId)
      if (latestDetail) {
        await upsertTaskDetail({
          ...latestDetail,
          failureReason: message,
          statusDetail: "任务失败",
          updatedAt: new Date().toISOString(),
        })
      }
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
