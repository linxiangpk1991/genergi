import { Queue, Worker } from "bullmq"
import { Redis } from "ioredis"
import {
  TASK_QUEUE_NAME,
  mergeSceneReviewMetadata,
  readTaskAssets,
  readTaskDetail,
  updateRuntimeStatus,
  updateTaskSummary,
  upsertTaskAssets,
  upsertTaskDetail,
} from "@genergi/shared"
import type { AssetRecord, TaskRuntimeTrace, TaskSummary } from "@genergi/shared"
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
  getCurrentTaskBlueprintRecord,
  prepareExecutionSource,
  retryPartialTaskAssets,
  resolveKeyframeGenerationTimeoutPolicy,
  resolveRuntimeGenerationConfig,
  synthesizeNarration,
  TASK_CANCELED_BY_OPERATOR,
  upsertTaskBlueprintSnapshot,
  writeTaskSourceFiles,
} from "./lib/providers.js"
import { buildLifecycleTimelineEvent, recordTaskTimeline } from "./lib/task-timeline.js"

const redisUrl = process.env.REDIS_URL

if (!redisUrl) {
  console.log("GENERGI worker started without REDIS_URL. Queue processing is disabled in local bootstrap mode.")
  process.exit(0)
}

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
const queue = new Queue(TASK_QUEUE_NAME, { connection })
const workerInstanceId = `${process.pid}@${process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "worker"}`
const activeTaskIds = new Set<string>()
let shutdownRequested = false

type PartialRetryJob = {
  scope: "scene" | "keyframe" | "video"
  sceneId: string
}

function resolvePartialRetryJob(data: {
  stage?: string | null
  resumeFrom?: string | null
}): PartialRetryJob | null {
  const sceneId = data.resumeFrom?.trim()
  if (!sceneId || !/^scene_\d+$/i.test(sceneId)) {
    return null
  }

  switch (data.stage) {
    case "retry_scene":
      return { scope: "scene", sceneId }
    case "retry_keyframe":
      return { scope: "keyframe", sceneId }
    case "retry_video":
      return { scope: "video", sceneId }
    default:
      return null
  }
}

function mergeAssetRecords(existing: AssetRecord[], next: AssetRecord[]) {
  const merged = new Map<string, AssetRecord>()
  for (const asset of existing) {
    merged.set(asset.id, asset)
  }
  for (const asset of next) {
    merged.set(asset.id, asset)
  }
  return [...merged.values()]
}

function isTaskCanceledError(error: unknown) {
  if (error instanceof Error) {
    return error.message === TASK_CANCELED_BY_OPERATOR || error.name === "CanceledError"
  }
  return false
}

async function throwIfTaskCanceled(taskId: string, signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error(TASK_CANCELED_BY_OPERATOR)
  }

  const latest = await readTaskDetail(taskId)
  if (latest?.cancelRequestedAt) {
    throw new Error(TASK_CANCELED_BY_OPERATOR)
  }
}

async function updateTaskLifecycleState(taskId: string, patch: {
  status?: TaskSummary["status"]
  progressPct?: number
  failureReason?: string | null
  statusDetail?: string | null
} & Partial<TaskRuntimeTrace>) {
  const updatedAt = new Date().toISOString()
  const runtimePatch = {
    ...(patch.currentStage !== undefined ? { currentStage: patch.currentStage } : {}),
    ...(patch.currentStageLabel !== undefined ? { currentStageLabel: patch.currentStageLabel } : {}),
    ...(patch.currentSceneIndex !== undefined ? { currentSceneIndex: patch.currentSceneIndex } : {}),
    ...(patch.currentSceneTotal !== undefined ? { currentSceneTotal: patch.currentSceneTotal } : {}),
    ...(patch.stageStartedAt !== undefined ? { stageStartedAt: patch.stageStartedAt } : {}),
    ...(patch.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: patch.lastHeartbeatAt } : { lastHeartbeatAt: updatedAt }),
    ...(patch.workerId !== undefined ? { workerId: patch.workerId } : {}),
    ...(patch.activeJobId !== undefined ? { activeJobId: patch.activeJobId } : {}),
  }
  await updateTaskSummary(taskId, (task: TaskSummary) => ({
    ...task,
    ...(patch.status ? { status: patch.status } : {}),
    ...(typeof patch.progressPct === "number" ? { progressPct: patch.progressPct } : {}),
    ...(patch.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
    ...(patch.statusDetail !== undefined ? { statusDetail: patch.statusDetail } : {}),
    ...runtimePatch,
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
    ...runtimePatch,
    updatedAt,
  })

  const timelineEvent = buildLifecycleTimelineEvent(patch)
  if (timelineEvent) {
    await recordTaskTimeline(taskId, timelineEvent)
  }
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
  try {
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
  } catch (error) {
    console.warn("[worker] runtime heartbeat write failed:", error instanceof Error ? error.message : String(error))
  }
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
      currentStage: latestDetail.currentStage ?? detailToPersist.currentStage ?? null,
      currentStageLabel: latestDetail.currentStageLabel ?? detailToPersist.currentStageLabel ?? null,
      currentSceneIndex: latestDetail.currentSceneIndex ?? detailToPersist.currentSceneIndex ?? null,
      currentSceneTotal: latestDetail.currentSceneTotal ?? detailToPersist.currentSceneTotal ?? null,
      stageStartedAt: latestDetail.stageStartedAt ?? detailToPersist.stageStartedAt ?? null,
      lastHeartbeatAt: latestDetail.lastHeartbeatAt ?? detailToPersist.lastHeartbeatAt ?? null,
      workerId: latestDetail.workerId ?? detailToPersist.workerId ?? null,
      activeJobId: latestDetail.activeJobId ?? detailToPersist.activeJobId ?? null,
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

  await updateTaskLifecycleState(taskId, {
    status: "running",
    progressPct: 15,
    failureReason: null,
    statusDetail: options.continueExecution ? "读取已审核蓝图" : "文本规划与蓝图生成中",
    currentStage: options.continueExecution ? "blueprint_reuse" : "text_planning",
    currentStageLabel: options.continueExecution ? "读取已审核蓝图" : "文本规划与蓝图生成中",
    currentSceneIndex: null,
    currentSceneTotal: null,
    stageStartedAt: new Date().toISOString(),
  })

  const prepared = await prepareExecutionSource(detail, {
    continueExecution: options.continueExecution,
  })
  await throwIfTaskCanceled(taskId, options.signal)
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
  await throwIfTaskCanceled(taskId, options.signal)
  await writeWorkerHeartbeat(`Preparing source files for ${taskId}`)
  await updateTaskLifecycleState(taskId, {
    status: "running",
    progressPct: 20,
    failureReason: null,
    statusDetail: "准备任务源文件",
    currentStage: "source_files",
    currentStageLabel: "准备任务源文件",
    currentSceneIndex: null,
    currentSceneTotal: preparedDetail.scenes.length,
    stageStartedAt: new Date().toISOString(),
  })
  const taskDir = await writeTaskSourceFiles(preparedDetail, planningTrace ?? undefined)
  await throwIfTaskCanceled(taskId, options.signal)
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
    | null = prepared.approvedKeyframes
  if (!keyframes) {
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
              currentStage: "keyframe_generation",
              currentStageLabel: `关键画面生成中 ${scene.index + 1}/${totalScenes}`,
              currentSceneIndex: scene.index,
              currentSceneTotal: totalScenes,
              stageStartedAt: new Date().toISOString(),
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
        currentStage: "keyframe_fallback",
        currentStageLabel: "关键画面超时，正在转视频导出关键帧",
        currentSceneIndex: null,
        currentSceneTotal: preparedDetail.scenes.length,
        stageStartedAt: new Date().toISOString(),
      })
      keyframes = null
    }
  } else {
    await writeWorkerHeartbeat(`Reusing approved keyframes for ${taskId}`)
    await updateTaskLifecycleState(taskId, {
      status: "running",
      progressPct: 40,
      failureReason: null,
      statusDetail: "复用已审核关键画面",
      currentStage: "keyframe_reuse",
      currentStageLabel: "复用已审核关键画面",
      currentSceneIndex: null,
      currentSceneTotal: preparedDetail.scenes.length,
      stageStartedAt: new Date().toISOString(),
    })
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
  await throwIfTaskCanceled(taskId, options.signal)
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
      currentStage: "waiting_review",
      currentStageLabel: "等待审核",
      currentSceneIndex: null,
      currentSceneTotal: preparedDetail.scenes.length,
      lastHeartbeatAt: new Date().toISOString(),
      activeJobId: null,
      blueprintVersion: blueprintRecord.version,
      blueprintStatus: blueprintRecord.status,
      updatedAt: new Date().toISOString(),
    }))
    await upsertTaskDetail({
      ...blueprintAwareDetail,
      statusDetail: "等待审核",
      currentStage: "waiting_review",
      currentStageLabel: "等待审核",
      currentSceneIndex: null,
      currentSceneTotal: preparedDetail.scenes.length,
      lastHeartbeatAt: new Date().toISOString(),
      activeJobId: null,
      updatedAt: new Date().toISOString(),
    })
    await recordTaskTimeline(taskId, {
      type: "stage",
      stage: "waiting_review",
      label: "等待审核",
      level: "info",
      summary: "蓝图和关键画面已准备好，等待人工审核。",
      metadata: {
        status: "waiting_review",
        progressPct: 45,
        blueprintVersion: blueprintRecord.version,
        blueprintStatus: blueprintRecord.status,
      },
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
        currentStage: "video_generation",
        currentStageLabel: `正在生成 scene ${scene.index + 1}/${totalScenes}`,
        currentSceneIndex: scene.index,
        currentSceneTotal: totalScenes,
        stageStartedAt: new Date().toISOString(),
      })
    },
    signal: options.signal,
  })
  await throwIfTaskCanceled(taskId, options.signal)

  if (!keyframes) {
    await writeWorkerHeartbeat(`Creating fallback keyframes from video outputs for ${taskId}`, "degraded")
    await updateTaskLifecycleState(taskId, {
      status: "running",
      progressPct: 82,
      failureReason: null,
      statusDetail: "关键画面超时，正在转视频导出关键帧",
      currentStage: "video_keyframe_fallback",
      currentStageLabel: "关键画面超时，正在转视频导出关键帧",
      currentSceneIndex: null,
      currentSceneTotal: blueprintAwareDetail.scenes.length,
      stageStartedAt: new Date().toISOString(),
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
    currentStage: "tts_generation",
    currentStageLabel: "正在合成英文配音",
    currentSceneIndex: null,
    currentSceneTotal: blueprintAwareDetail.scenes.length,
    stageStartedAt: new Date().toISOString(),
  })
  const narration = await synthesizeNarration(blueprintAwareDetail)
  await throwIfTaskCanceled(taskId, options.signal)
  await writeWorkerHeartbeat(`Muxing final video for ${taskId}`)
  await updateTaskLifecycleState(taskId, {
    status: "running",
    progressPct: 94,
    failureReason: null,
    statusDetail: "正在合成最终视频",
    currentStage: "final_mux",
    currentStageLabel: "正在合成最终视频",
    currentSceneIndex: null,
    currentSceneTotal: blueprintAwareDetail.scenes.length,
    stageStartedAt: new Date().toISOString(),
  })
  const finalVideo = await buildFinalVideoWithNarration({
    taskId,
    sourceVideoPaths: sceneVideos.map((sceneVideo) => sceneVideo.videoPath),
    narrationPath: narration.audioPath,
    subtitlesPath: narration.srtPath,
    renderSpec: preparedDetail.taskRunConfig.renderSpecJson,
    targetDurationSec: preparedDetail.taskRunConfig.targetDurationSec,
    audioStrategy: preparedDetail.taskRunConfig.audioStrategy,
  })
  await throwIfTaskCanceled(taskId, options.signal)
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
    activeTaskIds.add(taskId)

    try {
      await writeWorkerHeartbeat(`Processing ${taskId}`)
      await updateTaskLifecycleState(taskId, {
        status: "running",
        progressPct: 20,
        failureReason: null,
        statusDetail: "准备任务源文件",
        currentStage: "job_started",
        currentStageLabel: "准备任务源文件",
        currentSceneIndex: null,
        currentSceneTotal: null,
        stageStartedAt: new Date().toISOString(),
        workerId: workerInstanceId,
        activeJobId: job.id ? String(job.id) : null,
      })

      console.log(`[worker] ${taskId} => prepare source files + TTS`)
      await new Promise((resolve) => setTimeout(resolve, 800))
      if (taskAbortController.signal.aborted) {
        throw new Error(TASK_CANCELED_BY_OPERATOR)
      }

      const partialRetry = resolvePartialRetryJob(job.data)
      console.log(`[worker] ${taskId} => generate media assets${partialRetry ? ` (${partialRetry.scope} ${partialRetry.sceneId})` : ""}`)
      const result = partialRetry
        ? await (async () => {
            const detail = await readTaskDetail(taskId)
            if (!detail) {
              throw new Error(`Task detail not found for ${taskId}`)
            }
            const runtime = resolveRuntimeGenerationConfig(detail)
            const blueprintRecord = await getCurrentTaskBlueprintRecord(taskId)

            await updateTaskLifecycleState(taskId, {
              status: "running",
              progressPct: partialRetry.scope === "keyframe" ? 45 : 70,
              failureReason: null,
              statusDetail:
                partialRetry.scope === "keyframe"
                  ? `正在重试 ${partialRetry.sceneId} 关键帧`
                  : partialRetry.scope === "video"
                    ? `正在重试 ${partialRetry.sceneId} 视频段`
                    : `正在重试 ${partialRetry.sceneId} 关键帧和视频段`,
              currentStage: `partial_retry_${partialRetry.scope}`,
              currentStageLabel:
                partialRetry.scope === "keyframe"
                  ? "局部关键帧重试"
                  : partialRetry.scope === "video"
                    ? "局部视频段重试"
                    : "局部分镜重试",
              currentSceneIndex: detail.scenes.find((scene) => scene.id === partialRetry.sceneId)?.index ?? null,
              currentSceneTotal: detail.scenes.length,
              stageStartedAt: new Date().toISOString(),
            })

            const partialResult = await retryPartialTaskAssets({
              taskId,
              detail,
              scope: partialRetry.scope,
              sceneId: partialRetry.sceneId,
              imageModel: runtime.imageModelId,
              videoModel: runtime.videoModelId,
              blueprintRecord,
              signal: taskAbortController.signal,
            })
            await throwIfTaskCanceled(taskId, taskAbortController.signal)
            await upsertTaskAssets(taskId, mergeAssetRecords(await readTaskAssets(taskId), partialResult.assets))

            if (blueprintRecord && partialResult.keyframeManifestPath) {
              const nextBlueprintRecord = await upsertTaskBlueprintSnapshot({
                detail,
                blueprint: blueprintRecord.blueprint,
                status: partialResult.phase === "review_ready" ? "ready_for_review" : partialResult.phase === "completed" ? "completed" : blueprintRecord.status,
                keyframeManifestPath: partialResult.keyframeManifestPath,
              })
              await upsertTaskDetail({
                ...detail,
                actualDurationSec: partialResult.actualDurationSec ?? detail.actualDurationSec,
                blueprintStatus: nextBlueprintRecord.status,
                taskRunConfig: {
                  ...detail.taskRunConfig,
                  blueprintStatus: nextBlueprintRecord.status,
                },
                updatedAt: new Date().toISOString(),
              })
              await updateTaskSummary(taskId, (task: TaskSummary) => ({
                ...task,
                actualDurationSec: partialResult.actualDurationSec ?? task.actualDurationSec,
                blueprintStatus: nextBlueprintRecord.status,
                updatedAt: new Date().toISOString(),
              }))
            }

            if (partialResult.phase === "review_ready") {
              await updateTaskLifecycleState(taskId, {
                status: "waiting_review",
                progressPct: 45,
                failureReason: null,
                statusDetail: "局部关键帧已替换，等待审核确认",
                currentStage: "waiting_review",
                currentStageLabel: "等待审核",
                currentSceneIndex: null,
                currentSceneTotal: detail.scenes.length,
                activeJobId: null,
              })
            }

            return partialResult
          })()
        : await writeTaskArtifacts(taskId, {
            continueExecution: job.data.continueExecution ?? false,
            signal: taskAbortController.signal,
          })

      if (result.phase === "review_ready") {
        console.log(`[worker] ${taskId} => waiting for blueprint review`)
        stopCancelWatcher()
        activeTaskIds.delete(taskId)
        return { ok: true, taskId: job.data.taskId, phase: "review_ready" }
      }

      await throwIfTaskCanceled(taskId, taskAbortController.signal)
      await updateTaskLifecycleState(taskId, {
        status: "completed",
        progressPct: 100,
        failureReason: null,
        statusDetail: "已完成",
        currentStage: "completed",
        currentStageLabel: "已完成",
        currentSceneIndex: null,
        currentSceneTotal: null,
        activeJobId: null,
      })

      await writeWorkerHeartbeat(`Last completed ${taskId}`)
      console.log(`[worker] ${taskId} => completed`)
      stopCancelWatcher()
      activeTaskIds.delete(taskId)
      return { ok: true, taskId: job.data.taskId }
    } catch (error) {
      stopCancelWatcher()
      if (isTaskCanceledError(error)) {
        await updateTaskLifecycleState(taskId, {
          status: "canceled",
          failureReason: null,
          statusDetail: "任务已终止",
          currentStage: "canceled",
          currentStageLabel: "任务已终止",
          currentSceneIndex: null,
          currentSceneTotal: null,
          activeJobId: null,
        })
        await writeWorkerHeartbeat(`Last canceled ${taskId}`, "degraded")
        activeTaskIds.delete(taskId)
        return { ok: true, taskId: job.data.taskId, phase: "canceled" as const }
      }
      const message = error instanceof Error ? error.message : String(error)
      await updateTaskSummary(taskId, (task: TaskSummary) => ({
        ...task,
        status: "failed",
        failureReason: message,
        statusDetail: "任务失败",
        currentStage: task.currentStage ?? "failed",
        currentStageLabel: task.currentStageLabel ?? "任务失败",
        lastHeartbeatAt: new Date().toISOString(),
        activeJobId: null,
        progressPct: task.progressPct,
        retryCount: task.retryCount + 1,
        updatedAt: new Date().toISOString(),
      }))
      const latestDetail = await readTaskDetail(taskId)
      if (latestDetail) {
        await upsertTaskDetail({
          ...latestDetail,
          failureReason: message,
          statusDetail: "任务失败",
          currentStage: latestDetail.currentStage ?? "failed",
          currentStageLabel: latestDetail.currentStageLabel ?? "任务失败",
          lastHeartbeatAt: new Date().toISOString(),
          activeJobId: null,
          updatedAt: new Date().toISOString(),
        })
      }
      await recordTaskTimeline(taskId, {
        type: "error",
        stage: latestDetail?.currentStage ?? "failed",
        label: latestDetail?.currentStageLabel ?? "任务失败",
        level: "error",
        summary: "任务失败",
        reason: message,
        metadata: {
          status: "failed",
        },
      })
      await writeWorkerHeartbeat(`Last failed ${taskId}: ${message}`, "degraded")
      console.error(`[worker] ${taskId} => failed`, error)
      activeTaskIds.delete(taskId)
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

async function shutdownWorker(signalName: string) {
  if (shutdownRequested) {
    return
  }
  shutdownRequested = true
  clearInterval(heartbeat)
  await writeWorkerHeartbeat(`Worker draining after ${signalName}`, "degraded")
  await Promise.allSettled(
    [...activeTaskIds].map((taskId) =>
      updateTaskLifecycleState(taskId, {
        status: "running",
        statusDetail: "worker 正在安全停止，可恢复",
        currentStageLabel: "worker 正在安全停止，可恢复",
        lastHeartbeatAt: new Date().toISOString(),
        workerId: workerInstanceId,
      }),
    ),
  )
  await Promise.allSettled([worker.close(), queue.close(), connection.quit()])
  process.exit(0)
}

process.once("SIGTERM", () => {
  void shutdownWorker("SIGTERM")
})

process.once("SIGINT", () => {
  void shutdownWorker("SIGINT")
})
