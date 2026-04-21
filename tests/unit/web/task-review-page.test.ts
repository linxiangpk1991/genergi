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
      getTaskAssets: vi.fn(),
      reviewTaskBlueprint: vi.fn(),
      resumeCurrentBlueprint: vi.fn(),
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

    vi.mocked(api.getTaskAssets).mockResolvedValue({
      assets: [
        {
          id: "task_reviewable_source",
          taskId: "task_reviewable",
          assetType: "source_script",
          label: "任务母本",
          status: "ready",
          path: "/tmp/source-script.txt",
          createdAt: "2026-04-20T00:00:00.000Z",
          fileName: "source-script.txt",
          directoryName: "/tmp",
          displayPath: "/tmp/source-script.txt",
          extension: ".txt",
          mimeType: "text/plain; charset=utf-8",
          sizeBytes: 30,
          sizeLabel: "30 B",
          exists: true,
          isDirectory: false,
          previewable: true,
          previewKind: "text",
          modifiedAt: "2026-04-20T00:00:00.000Z",
          downloadFileName: "source-script.txt",
        },
      ],
    } as any)

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "Original source script.",
    } as any)

    vi.mocked(api.reviewTaskBlueprint).mockResolvedValue({
      blueprint: {
        taskId: "task_reviewable",
        version: 3,
        status: "approved",
        updatedAt: "2026-04-20T00:05:00.000Z",
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
      review: {
        taskId: "task_reviewable",
        version: 3,
        decision: "approved",
        note: null,
        decidedAt: "2026-04-20T00:05:00.000Z",
      },
      projectLibraryEntry: null,
      nextStage: { canResumeExecution: true, resumePath: "/task-review?taskId=task_reviewable" },
    } as any)

    vi.mocked(api.resumeCurrentBlueprint).mockResolvedValue({
      blueprint: {
        taskId: "task_reviewable",
        version: 3,
        status: "approved",
        updatedAt: "2026-04-20T00:06:00.000Z",
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
      queue: {
        queued: true,
        reason: "resume_blueprint_execution",
        continueExecution: true,
      },
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
    expect(text).toContain("母本原文")
    expect(text).toContain("Original source script.")
    expect(text).toContain("一致性契约")
    expect(text).toContain("主体：Single hero product")
  })

  it("prefers actionable review tasks even when the blueprint is already approved", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        {
          id: "task_approved",
          projectId: "project_default",
          title: "Approved task",
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
          blueprintVersion: 2,
          blueprintStatus: "approved",
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
        taskId: "task_approved",
        projectId: "project_default",
        title: "Approved task",
        script: "Approved script",
        blueprintVersion: 2,
        blueprintStatus: "approved",
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
          blueprintVersion: 2,
          blueprintStatus: "approved",
          imageModel: { id: "image.default", label: "Gemini 3 Pro Image Preview", provider: "openai-compatible" },
          textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
          videoModel: { id: "video.default", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
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
        taskId: "task_approved",
        version: 2,
        status: "approved",
        updatedAt: "2026-04-20T00:00:00.000Z",
        blueprint: {
          taskId: "task_approved",
          projectId: "project_default",
          version: 2,
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
          totalVoiceoverScript: "Approved voiceover.",
          sceneContracts: [],
        },
        keyframeManifestPath: null,
      },
      review: {
        taskId: "task_approved",
        version: 2,
        decision: "approved",
        note: null,
        decidedAt: "2026-04-20T00:00:00.000Z",
      },
      nextStage: { canResumeExecution: true, resumePath: "/task-review?taskId=task_approved" },
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/task-review"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/task-review", element: createElement(TaskReviewPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(vi.mocked(api.getTaskDetail)).toHaveBeenCalledWith("task_approved")
    })

    const approveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("审核通过") || button.textContent?.includes("已审核通过"),
    )
    const resumeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("继续完整视频生成"),
    )

    expect(approveButton).toBeTruthy()
    expect((approveButton as HTMLButtonElement | undefined)?.disabled).toBe(true)
    expect(container.textContent ?? "").toContain("approved")
    expect((resumeButton as HTMLButtonElement | undefined)?.disabled).toBe(false)
  })

  it("syncs the visible blueprint status after approval and allows resume", async () => {
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
      expect(container.textContent ?? "").toContain("ready_for_review")
    })

    const approveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("审核通过"),
    )
    expect(approveButton).toBeTruthy()

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.reviewTaskBlueprint)).toHaveBeenCalledWith(
        "task_reviewable",
        3,
        { decision: "approved" },
      )
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("approved")
      expect(text).not.toContain("ready_for_review")
    })

    const resumeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("继续完整视频生成"),
    )
    expect(resumeButton).toBeTruthy()
    expect(resumeButton?.getAttribute("disabled")).toBeNull()

    await act(async () => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.resumeCurrentBlueprint)).toHaveBeenCalledWith("task_reviewable")
    })
  })

  it("lets operators switch between multiple actionable review tasks", async () => {
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
        {
          id: "task_second",
          projectId: "project_campaign",
          title: "Second review task",
          modeId: "high_quality",
          executionMode: "review_required",
          channelId: "reels",
          terminalPresetId: "tablet_landscape",
          renderSpecJson: {
            terminalPresetId: "tablet_landscape",
            width: 2048,
            height: 1536,
            aspectRatio: "4:3",
            safeArea: { topPct: 7, rightPct: 6, bottomPct: 7, leftPct: 6 },
            compositionGuideline: "适合横向场景展开",
            motionGuideline: "允许横向环境展开",
          },
          targetDurationSec: 15,
          generationMode: "system_enhanced",
          generationRoute: "multi_scene",
          routeReason: "target duration exceeds single-shot limit",
          planningVersion: "v1",
          blueprintVersion: 1,
          blueprintStatus: "approved",
          actualDurationSec: null,
          status: "waiting_review",
          progressPct: 45,
          retryCount: 0,
          estimatedCostCny: 4,
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    } as any)

    vi.mocked(api.getTaskDetail).mockImplementation(async (taskId: string) => {
      if (taskId === "task_second") {
        return {
          detail: {
            taskId: "task_second",
            projectId: "project_campaign",
            title: "Second review task",
            script: "Second script",
            blueprintVersion: 1,
            blueprintStatus: "approved",
            taskRunConfig: {
              projectId: "project_campaign",
              modeId: "high_quality",
              executionMode: "review_required",
              channelId: "reels",
              terminalPresetId: "tablet_landscape",
              renderSpecJson: {
                terminalPresetId: "tablet_landscape",
                width: 2048,
                height: 1536,
                aspectRatio: "4:3",
                safeArea: { topPct: 7, rightPct: 6, bottomPct: 7, leftPct: 6 },
                compositionGuideline: "适合横向场景展开",
                motionGuideline: "允许横向环境展开",
              },
              targetDurationSec: 15,
              generationMode: "system_enhanced",
              generationRoute: "multi_scene",
              routeReason: "target duration exceeds single-shot limit",
              planningVersion: "v1",
              blueprintVersion: 1,
              blueprintStatus: "approved",
              imageModel: { id: "image.default", label: "Gemini 3 Pro Image Preview", provider: "openai-compatible" },
              textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
              videoModel: { id: "video.default", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
              ttsProvider: "edge-tts",
              contentLocale: "en",
              operatorLocale: "zh-CN",
              requireStoryboardReview: true,
              requireKeyframeReview: true,
              budgetLimitCny: 5,
              aspectRatio: "4:3",
              slotSnapshots: [],
            },
            scenes: [],
            updatedAt: "2026-04-20T00:00:00.000Z",
          },
        } as any
      }

      return {
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
            imageModel: { id: "image.default", label: "Gemini 3 Pro Image Preview", provider: "openai-compatible" },
            textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
            videoModel: { id: "video.default", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
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
      } as any
    })

    vi.mocked(api.getTaskCurrentBlueprint).mockImplementation(async (taskId: string) => {
      if (taskId === "task_second") {
        return {
          blueprint: {
            taskId: "task_second",
            version: 1,
            status: "approved",
            updatedAt: "2026-04-20T00:00:00.000Z",
            blueprint: {
              taskId: "task_second",
              projectId: "project_campaign",
              version: 1,
              createdAt: "2026-04-20T00:00:00.000Z",
              executionMode: "review_required",
              renderSpec: {
                terminalPresetId: "tablet_landscape",
                width: 2048,
                height: 1536,
                aspectRatio: "4:3",
                safeArea: { topPct: 7, rightPct: 6, bottomPct: 7, leftPct: 6 },
                compositionGuideline: "适合横向场景展开",
                motionGuideline: "允许横向环境展开",
              },
              globalTheme: "Campaign task",
              visualStyleGuide: "Warm retail setup",
              subjectProfile: "Product set",
              productProfile: "Charging dock",
              backgroundConstraints: ["clean shelf"],
              negativeConstraints: ["no subtitles"],
              totalVoiceoverScript: "Second task voiceover.",
              sceneContracts: [],
            },
            keyframeManifestPath: null,
          },
          review: {
            taskId: "task_second",
            version: 1,
            decision: "approved",
            note: null,
            decidedAt: "2026-04-20T00:00:00.000Z",
          },
          nextStage: { canResumeExecution: true, resumePath: "/task-review?taskId=task_second" },
        } as any
      }

      return {
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
            visualStyleGuide: "Premium silver",
            subjectProfile: "Single hero product",
            productProfile: "Fast charging dock",
            backgroundConstraints: ["clean desk"],
            negativeConstraints: ["no subtitles"],
            totalVoiceoverScript: "First task voiceover.",
            sceneContracts: [],
          },
          keyframeManifestPath: null,
        },
        review: null,
        nextStage: { canResumeExecution: false, resumePath: null },
      } as any
    })

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/task-review"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/task-review", element: createElement(TaskReviewPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(vi.mocked(api.getTaskDetail)).toHaveBeenCalledWith("task_reviewable")
    })

    const select = container.querySelector("select") as HTMLSelectElement | null
    expect(select).toBeTruthy()

    await act(async () => {
      select!.value = "task_second"
      select!.dispatchEvent(new Event("change", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.getTaskDetail)).toHaveBeenCalledWith("task_second")
      expect(vi.mocked(api.getTaskCurrentBlueprint)).toHaveBeenCalledWith("task_second")
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("Second review task")
      expect(text).toContain("Second task voiceover.")
    })
  })

  it("auto-refreshes the task list so newly actionable tasks can be selected", async () => {
    let intervalCallback: (() => void) | null = null
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler) => {
      intervalCallback = handler as () => void
      return 1 as unknown as number
    }) as typeof window.setInterval)
    vi.spyOn(window, "clearInterval").mockImplementation(() => {})

    vi.mocked(api.listTasks).mockReset()
    vi.mocked(api.getTaskDetail).mockReset()
    vi.mocked(api.getTaskCurrentBlueprint).mockReset()

    vi.mocked(api.listTasks)
      .mockResolvedValueOnce({
        tasks: [
          {
            id: "task_pending",
            projectId: "project_default",
            title: "Pending task",
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
            blueprintVersion: 1,
            blueprintStatus: "pending_generation",
            actualDurationSec: null,
            status: "running",
            progressPct: 65,
            retryCount: 0,
            estimatedCostCny: 5,
            createdAt: "2026-04-20T00:00:00.000Z",
            updatedAt: "2026-04-20T00:00:00.000Z",
          },
        ],
      } as any)
      .mockResolvedValue({
        tasks: [
          {
            id: "task_pending",
            projectId: "project_default",
            title: "Pending task",
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
            blueprintVersion: 1,
            blueprintStatus: "pending_generation",
            actualDurationSec: null,
            status: "running",
            progressPct: 65,
            retryCount: 0,
            estimatedCostCny: 5,
            createdAt: "2026-04-20T00:00:00.000Z",
            updatedAt: "2026-04-20T00:00:00.000Z",
          },
          {
            id: "task_late_review",
            projectId: "project_default",
            title: "Late review task",
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
            blueprintVersion: 2,
            blueprintStatus: "ready_for_review",
            actualDurationSec: null,
            status: "waiting_review",
            progressPct: 45,
            retryCount: 0,
            estimatedCostCny: 5,
            createdAt: "2026-04-20T00:00:00.000Z",
            updatedAt: "2026-04-20T00:00:00.000Z",
          },
        ],
      } as any)

    vi.mocked(api.getTaskDetail).mockImplementation(async (taskId: string) => {
      if (taskId === "task_late_review") {
        return {
          detail: {
            taskId: "task_late_review",
            projectId: "project_default",
            title: "Late review task",
            script: "Late review voiceover.",
            blueprintVersion: 2,
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
              blueprintVersion: 2,
              blueprintStatus: "ready_for_review",
              imageModel: { id: "image.default", label: "Gemini 3 Pro Image Preview", provider: "openai-compatible" },
              textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
              videoModel: { id: "video.default", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
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
        } as any
      }

      return {
        detail: {
          taskId: "task_pending",
          projectId: "project_default",
          title: "Pending task",
          script: "Pending task script.",
          blueprintVersion: 1,
          blueprintStatus: "pending_generation",
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
            blueprintVersion: 1,
            blueprintStatus: "pending_generation",
            imageModel: { id: "image.default", label: "Gemini 3 Pro Image Preview", provider: "openai-compatible" },
            textModel: { id: "text.default", label: "Claude Opus 4.6", provider: "anthropic-compatible" },
            videoModel: { id: "video.default", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
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
      } as any
    })

    vi.mocked(api.getTaskCurrentBlueprint).mockImplementation(async (taskId: string) => {
      if (taskId === "task_late_review") {
        return {
          blueprint: {
            taskId: "task_late_review",
            version: 2,
            status: "ready_for_review",
            updatedAt: "2026-04-20T00:00:00.000Z",
            blueprint: {
              taskId: "task_late_review",
              projectId: "project_default",
              version: 2,
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
              globalTheme: "Late review task",
              visualStyleGuide: "Warm retail setup",
              subjectProfile: "Product set",
              productProfile: "Charging dock",
              backgroundConstraints: ["clean shelf"],
              negativeConstraints: ["no subtitles"],
              totalVoiceoverScript: "Late review voiceover.",
              sceneContracts: [],
            },
            keyframeManifestPath: null,
          },
          review: null,
          nextStage: { canResumeExecution: false, resumePath: null },
        } as any
      }

      return {
        blueprint: {
          taskId: "task_pending",
          version: 1,
          status: "pending_generation",
          updatedAt: "2026-04-20T00:00:00.000Z",
          blueprint: {
            taskId: "task_pending",
            projectId: "project_default",
            version: 1,
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
            globalTheme: "Pending task",
            visualStyleGuide: "Pending visual guide",
            subjectProfile: "Single hero product",
            productProfile: "Fast charging dock",
            backgroundConstraints: ["clean desk"],
            negativeConstraints: ["no subtitles"],
            totalVoiceoverScript: "Pending task voiceover.",
            sceneContracts: [],
          },
          keyframeManifestPath: null,
        },
        review: null,
        nextStage: { canResumeExecution: false, resumePath: null },
      } as any
    })

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/task-review"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/task-review", element: createElement(TaskReviewPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(vi.mocked(api.getTaskDetail)).toHaveBeenCalledWith("task_pending")
    })

    expect(intervalCallback).toBeTruthy()

    await act(async () => {
      intervalCallback?.()
      await Promise.resolve()
    })

    await waitFor(() => {
      const select = container.querySelector("select") as HTMLSelectElement | null
      expect(select).toBeTruthy()
      const optionValues = Array.from(select!.options).map((option) => option.value)
      expect(optionValues).toContain("task_late_review")
    })

    setIntervalSpy.mockRestore()
  })
})
