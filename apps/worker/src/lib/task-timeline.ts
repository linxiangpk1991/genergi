import { appendTaskTimelineEvent } from "@genergi/shared"
import type { TaskRuntimeTrace, TaskSummary, TaskTimelineEventInput } from "@genergi/shared"

export type TaskLifecycleTimelinePatch = {
  status?: TaskSummary["status"]
  progressPct?: number
  failureReason?: string | null
  statusDetail?: string | null
} & Partial<TaskRuntimeTrace>

export function buildLifecycleTimelineEvent(
  patch: TaskLifecycleTimelinePatch,
): TaskTimelineEventInput | null {
  if (!patch.currentStage) {
    return null
  }

  const isFailure = patch.status === "failed" || Boolean(patch.failureReason)
  const isWarning = patch.status === "canceled" || patch.currentStage.includes("fallback")

  return {
    type: isFailure ? "error" : "stage",
    stage: patch.currentStage,
    label: patch.currentStageLabel ?? patch.statusDetail ?? patch.currentStage,
    level: isFailure ? "error" : isWarning ? "warning" : "info",
    summary: patch.statusDetail ?? null,
    reason: patch.failureReason ?? null,
    metadata: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(typeof patch.progressPct === "number" ? { progressPct: patch.progressPct } : {}),
      ...(patch.currentSceneIndex !== undefined ? { currentSceneIndex: patch.currentSceneIndex } : {}),
      ...(patch.currentSceneTotal !== undefined ? { currentSceneTotal: patch.currentSceneTotal } : {}),
      ...(patch.workerId ? { workerId: patch.workerId } : {}),
      ...(patch.activeJobId ? { activeJobId: patch.activeJobId } : {}),
    },
  }
}

export async function recordTaskTimeline(taskId: string, input: TaskTimelineEventInput) {
  try {
    return await appendTaskTimelineEvent(taskId, input)
  } catch (error) {
    console.warn(
      `[worker] ${taskId} timeline append failed:`,
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}
