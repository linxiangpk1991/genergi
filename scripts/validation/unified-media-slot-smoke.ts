void (async () => {
  const { createTask, getTaskDetail } = await import("../../apps/api/src/lib/task-store.ts")

  const created = await createTask({
    title: "Unified media slot rollout smoke",
    script: "Show the product. Explain the benefit. End with a CTA.",
    modeId: "high_quality",
    channelId: "reels",
    aspectRatio: "9:16",
    targetDurationSec: 30,
    generationMode: "system_enhanced",
  })

  const detail = await getTaskDetail(created.task.id)

  process.stdout.write(JSON.stringify({
    taskId: created.task.id,
    slotTypes: created.taskRunConfig.slotSnapshots.map((slot) => slot.slotType),
    detailSlotTypes: detail?.taskRunConfig.slotSnapshots.map((slot) => slot.slotType) ?? [],
  }))
})()
