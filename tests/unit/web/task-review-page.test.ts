import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../apps/web/src/api", async () => {
  const actual = await vi.importActual<typeof import("../../../apps/web/src/api")>(
    "../../../apps/web/src/api",
  )
  return {
    ...actual,
    api: {
      ...actual.api,
      listTasks: vi.fn(),
      getTaskDetail: vi.fn(),
      getTaskCurrentBlueprint: vi.fn(),
    },
  }
})

import { api } from "../../../apps/web/src/api"
import { TaskReviewPage } from "../../../apps/web/src/pages/TaskReviewPage"

async function waitFor(assertion: () => void, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
      })
    }
  }

  throw lastError instanceof Error ? lastError : new Error("waitFor timeout")
}

describe("TaskReviewPage", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        {
          id: "task_reviewable",
          projectId: "project_default",
          title: "Reviewable task",
          modeId: "high_quality",
          executionMode: "review_required",
          channelId: "reels",
          terminalPresetId: "phone_portrait",
          renderSpecJson: {
            terminalPresetId: "phone_portrait",
            width: 1080,
            height: 1920,
            aspectRatio: "9:16",
            safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
            compositionGuideline: "主体保持在竖屏中心安全区",
            motionGuideline: "优先轻推拉",
          },
          targetDurationSec: 30,
          generationMode: "system_enhanced",
          generationRoute: "multi_scene",
          routeReason: "target duration exceeds single-shot limit",
          planningVersion: "v1",
          blueprintVersion: 3,
          blueprintStatus: "ready_for_review",
          actualDurationSec: null,
          status: "waiting_review",
          progressPct: 66,
          retryCount: 0,
          estimatedCostCny: 5,
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    } as any)

    vi.mocked(api.getTaskDetail).mockResolvedValue({
      detail: {
        taskId: "task_reviewable",
        projectId: "project_default",
        title: "Reviewable task",
        script: "Full script",
        blueprintVersion: 3,
        blueprintStatus: "ready_for_review",
        taskRunConfig: {
          projectId: "project_default",
          modeId: "high_quality",
          executionMode: "review_required",
          channelId: "reels",
          terminalPresetId: "phone_portrait",
          renderSpecJson: {
            terminalPresetId: "phone_portrait",
            width: 1080,
            height: 1920,
            aspectRatio: "9:16",
            safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
            compositionGuideline: "主体保持在竖屏中心安全区",
            motionGuideline: "优先轻推拉",
          },
          targetDurationSec: 30,
          generationMode: "system_enhanced",
          generationRoute: "multi_scene",
          routeReason: "target duration exceeds single-shot limit",
          planningVersion: "v1",
          blueprintVersion: 3,
          blueprintStatus: "ready_for_review",
          imageModel: {
            id: "image.default",
            label: "Gemini 3 Pro Image Preview",
            provider: "openai-compatible",
          },
          textModel: {
            id: "text.default",
            label: "Claude Opus 4.6",
            provider: "anthropic-compatible",
          },
          videoModel: {
            id: "video.default",
            label: "Veo 3.1 Portrait",
            provider: "openai-compatible",
          },
          ttsProvider: "edge-tts",
          contentLocale: "en",
          operatorLocale: "zh-CN",
          requireStoryboardReview: true,
          requireKeyframeReview: true,
          budgetLimitCny: 5,
          aspectRatio: "9:16",
          slotSnapshots: [],
        },
        scenes: [],
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
    } as any)

    vi.mocked(api.getTaskCurrentBlueprint).mockResolvedValue({
      blueprint: {
        taskId: "task_reviewable",
        version: 3,
        status: "ready_for_review",
        updatedAt: "2026-04-20T00:00:00.000Z",
        blueprint: {
          taskId: "task_reviewable",
          projectId: "project_default",
          version: 3,
          createdAt: "2026-04-20T00:00:00.000Z",
          executionMode: "review_required",
          renderSpec: {
            terminalPresetId: "phone_portrait",
            width: 1080,
            height: 1920,
            aspectRatio: "9:16",
            safeArea: { topPct: 8, rightPct: 6, bottomPct: 10, leftPct: 6 },
            compositionGuideline: "主体保持在竖屏中心安全区",
            motionGuideline: "优先轻推拉",
          },
          globalTheme: "Desk setup refresh",
          visualStyleGuide: "Premium silver, soft daylight, crisp desk reflections",
          subjectProfile: "Single hero product",
          productProfile: "Fast charging dock",
          backgroundConstraints: ["clean desk"],
          negativeConstraints: ["no subtitles"],
          totalVoiceoverScript: "Show the clutter, reveal the product, end with the clean setup.",
          sceneContracts: [
            {
              id: "scene_1",
              index: 0,
              sceneGoal: "Open on desk clutter",
              voiceoverScript: "Your desk starts like this.",
              startFrameDescription: "Hook frame with cable clutter",
              imagePrompt: "Vertical product ad frame, cable clutter on desk",
              videoPrompt: "Slow push-in over the clutter before the product appears",
              startFrameIntent: "Introduce the problem",
              endFrameIntent: "Hold the problem state",
              durationSec: 5,
              transitionHint: "hard cut",
              continuityConstraints: ["product hidden"],
            },
          ],
        },
        keyframeManifestPath: null,
      },
      review: null,
      nextStage: { canResumeExecution: false, resumePath: null },
    } as any)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it("renders blueprint version, voiceover, scene prompts, and render spec", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/task-review?taskId=task_reviewable"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/task-review", element: createElement(TaskReviewPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(vi.mocked(api.getTaskCurrentBlueprint)).toHaveBeenCalledWith("task_reviewable")
    })

    const text = container.textContent ?? ""
    expect(text).toContain("Blueprint v3")
    expect(text).toContain("Show the clutter, reveal the product")
    expect(text).toContain("Hook frame with cable clutter")
    expect(text).toContain("Vertical product ad frame, cable clutter on desk")
    expect(text).toContain("Slow push-in over the clutter before the product appears")
    expect(text).toContain("1080 × 1920")
    expect(text).toContain("9:16")
  })
})
