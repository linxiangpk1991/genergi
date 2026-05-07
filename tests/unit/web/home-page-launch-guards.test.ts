import { describe, expect, it } from "vitest"

import {
  estimateLaunchProduction,
  findSimilarLaunchTasks,
  getLaunchReadiness,
} from "../../../apps/web/src/pages/homePageLaunchGuards"

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_existing",
    projectId: "project_default",
    title: "Summer Skincare Hook",
    modeId: "high_quality",
    executionMode: "review_required",
    channelId: "tiktok",
    terminalPresetId: "phone_portrait",
    renderSpecJson: null,
    targetDurationSec: 30,
    generationMode: "user_locked",
    generationRoute: "multi_scene",
    routeReason: "target duration exceeds single-shot limit",
    planningVersion: "v1",
    blueprintVersion: 1,
    blueprintStatus: "pending_generation",
    actualDurationSec: null,
    status: "running",
    progressPct: 40,
    retryCount: 0,
    estimatedCostCny: 4.25,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    ...overrides,
  }
}

describe("HomePage launch guards", () => {
  it("marks an empty launch as high risk with field-level missing checks", () => {
    const readiness = getLaunchReadiness({
      title: "",
      script: "",
      outputLanguage: "English",
    })

    expect(readiness.level).toBe("risk")
    expect(readiness.summary).toContain("必须补齐")
    expect(readiness.checks.find((check) => check.key === "title")?.status).toBe("risk")
    expect(readiness.checks.find((check) => check.key === "script")?.status).toBe("risk")
  })

  it("flags weak mother-copy before the task can waste video budget", () => {
    const readiness = getLaunchReadiness({
      title: "New product",
      script: "Show this product quickly.",
      outputLanguage: "English",
    })

    expect(readiness.level).toBe("suggestion")
    expect(readiness.summary).toContain("建议补充")
    expect(readiness.checks.map((check) => check.key)).toContain("audience")
    expect(readiness.checks.map((check) => check.key)).toContain("cta")
  })

  it("finds similar tasks in the same project and duration", () => {
    const result = findSimilarLaunchTasks({
      title: "Summer skincare hooks",
      script: "Audience: young professionals. Product: skin serum. CTA: buy now.",
      projectId: "project_default",
      targetDurationSec: 30,
      tasks: [
        createTask(),
        createTask({ id: "task_other_project", projectId: "project_other" }),
      ] as any,
    })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].task.id).toBe("task_existing")
    expect(result.level).toBe("warning")
    expect(result.summary).toContain("可能已有相似任务")
  })

  it("estimates scene count and budget from duration", () => {
    expect(estimateLaunchProduction(6)).toMatchObject({
      sceneCount: 1,
      routeLabel: "单条成片",
    })
    expect(estimateLaunchProduction(30)).toMatchObject({
      sceneCount: 4,
      routeLabel: "多段成片",
      estimatedBudgetCny: 5,
    })
  })
})
