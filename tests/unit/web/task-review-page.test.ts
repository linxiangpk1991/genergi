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
      retryTask: vi.fn(),
      updateTaskAudioStrategy: vi.fn(),
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
          keyframeCount: 2,
          keyframeGenerationMode: "batch",
          budgetLimitCny: 5,
          aspectRatio: "9:16",
          slotSnapshots: [],
        },
        scenes: [],
        modelTrace: {
          textModel: {
            slotType: "textModel",
            label: "Claude Opus 4.6",
            providerType: "anthropic-compatible",
            providerModelId: "claude-opus-4.6",
            wireApi: "messages",
            requestPath: "/v1/messages",
          },
          imageModel: {
            slotType: "imageModel",
            label: "Gemini 3 Pro Image Preview",
            providerType: "openai-compatible",
            providerModelId: "gemini-3-pro-image-preview",
            wireApi: "gemini_generate_content",
            requestPath: ":generateContent",
          },
          videoModel: {
            slotType: "videoModel",
            label: "Veo 3.1 Portrait",
            providerType: "openai-compatible",
            providerModelId: "veo3.1",
            wireApi: "video_generation",
            requestPath: "按视频适配器",
          },
          ttsProvider: {
            slotType: "ttsProvider",
            label: "Edge TTS",
            providerType: "edge-tts",
            providerModelId: "edge-tts",
            wireApi: "tts",
            requestPath: "provider",
          },
        },
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
            {
              id: "scene_2",
              index: 1,
              sceneGoal: "Reveal the dock",
              voiceoverScript: "Then the setup changes.",
              startFrameDescription: "Product reveal on the desk",
              imagePrompt: "Vertical product ad frame, dock revealed on desk",
              videoPrompt: "Slow reveal of the charging dock",
              startFrameIntent: "Reveal the solution",
              endFrameIntent: "Hold the product state",
              durationSec: 5,
              transitionHint: "match cut",
              continuityConstraints: ["same desk"],
            },
            {
              id: "scene_3",
              index: 2,
              sceneGoal: "Show the clean result",
              voiceoverScript: "Everything feels calmer.",
              startFrameDescription: "Clean desk result",
              imagePrompt: "Vertical product ad frame, clean organized desk",
              videoPrompt: "Gentle push-in over the organized desk",
              startFrameIntent: "Show the result",
              endFrameIntent: "Hold the clean state",
              durationSec: 5,
              transitionHint: "soft cut",
              continuityConstraints: ["same product"],
            },
            {
              id: "scene_4",
              index: 3,
              sceneGoal: "Close with product hero",
              voiceoverScript: "Ready for the day.",
              startFrameDescription: "Hero product close",
              imagePrompt: "Vertical product ad frame, hero charging dock close-up",
              videoPrompt: "Subtle hero close-up with soft reflections",
              startFrameIntent: "Close with CTA-ready hero",
              endFrameIntent: "Hold product hero",
              durationSec: 5,
              transitionHint: "fade",
              continuityConstraints: ["same product"],
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

    vi.mocked(api.updateTaskAudioStrategy).mockResolvedValue({
      task: {
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
        audioStrategy: "native_plus_tts_ducked",
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
          audioStrategy: "native_plus_tts_ducked",
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
    expect(text).toContain("方案 v3")
    expect(text).toContain("Show the clutter, reveal the product")
    expect(text).toContain("Hook frame with cable clutter")
    expect(text).toContain("Vertical product ad frame, cable clutter on desk")
    expect(text).toContain("Slow push-in over the clutter before the product appears")
    expect(text).toContain("1080 × 1920")
    expect(text).toContain("9:16")
    expect(text).toContain("视频内容")
    expect(text).toContain("Original source script.")
    expect(text).toContain("关键画面：4 张 · 批量生成")
    expect(text).toContain("一致性要求")
    expect(text).toContain("查看技术细节")
    expect(text).toContain("Claude Opus 4.6")
    expect(text).toContain("文案：Claude Opus 4.6")
    expect(text).toContain("图片：Gemini 3 Pro Image Preview")
    expect(text).toContain("视频：Veo 3.1 Portrait")
    expect(text).toContain("主体：Single hero product")
    expect(text).toContain("本次用了哪些模型")
    expect(text).toContain("Claude Opus 4.6")
    expect(text).toContain("Gemini 3 Pro Image Preview")
    expect(text).toContain("Veo 3.1 Portrait")
    expect(text).toContain("edge-tts")
    expect(text).toContain("第 1 张关键画面")
    expect(text).toContain("这张图表达什么")
    expect(text).toContain("使用模型")
    expect(text).toContain("生成依据 / 英文提示词")
    expect(text).toContain("状态")
    expect(text).toContain("通过这个方案")
    expect(text).toContain("重做这个方案")

    const keyframeImage = container.querySelector('img[alt="第 1 张关键画面预览"]')
    expect(keyframeImage).toBeTruthy()

    await act(async () => {
      keyframeImage?.dispatchEvent(new Event("error", { bubbles: true }))
    })

    expect(container.textContent ?? "").toContain("这张关键画面暂时打不开，请到素材页确认文件是否生成成功。")
  })

  it("shows plain-language quality reason choices for rejecting a blueprint", async () => {
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
      const text = container.textContent ?? ""
      expect(text).toContain("文案跑偏")
      expect(text).toContain("画面不一致")
      expect(text).toContain("人物不稳定")
      expect(text).toContain("配音问题")
      expect(text).toContain("可选备注")
    })
  })

  it("tells the operator what is missing when rejecting without a reason", async () => {
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
      expect(container.textContent ?? "").toContain("驳回并重做方案")
    })

    const rejectButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("驳回并重做方案"),
    ) as HTMLButtonElement | undefined
    expect(rejectButton).toBeTruthy()
    expect(rejectButton?.disabled).toBe(false)

    await act(async () => {
      rejectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("请先选择一个驳回原因")
    })
    expect(vi.mocked(api.reviewTaskBlueprint)).not.toHaveBeenCalled()
  })

  it("shows an empty filter state instead of keeping a stale review task", async () => {
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
      expect(container.textContent ?? "").toContain("Reviewable task")
    })

    const approvedFilterButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("已通过"),
    )
    expect(approvedFilterButton).toBeTruthy()

    await act(async () => {
      approvedFilterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("当前没有已通过的任务。")
      expect(text).not.toContain("生成方案总览")
      expect(container.querySelector("select")).toBeNull()
    })

    const pendingFilterButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("待审核"),
    )
    expect(pendingFilterButton).toBeTruthy()

    await act(async () => {
      pendingFilterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("生成方案总览")
      expect(container.querySelector("select")).toBeTruthy()
    })
  })

  it("shows a waiting state instead of a raw error when a pending task has no blueprint yet", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        {
          id: "task_pending",
          projectId: "project_seed_default",
          title: "Summer Product Hook Series",
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
          generationMode: "user_locked",
          generationRoute: "multi_scene",
          routeReason: "target duration exceeds single-shot limit",
          planningVersion: "v1",
          blueprintVersion: 1,
          blueprintStatus: "pending_generation",
          actualDurationSec: null,
          status: "running",
          progressPct: 35,
          retryCount: 0,
          estimatedCostCny: 5,
          createdAt: "2026-05-09T00:00:00.000Z",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
      ],
    } as any)
    vi.mocked(api.getTaskDetail).mockResolvedValue({
      detail: {
        taskId: "task_pending",
        projectId: "project_seed_default",
        title: "Summer Product Hook Series",
        script: "",
        blueprintVersion: 1,
        blueprintStatus: "pending_generation",
        taskRunConfig: {
          projectId: "project_seed_default",
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
          generationMode: "user_locked",
          generationRoute: "multi_scene",
          routeReason: "target duration exceeds single-shot limit",
          planningVersion: "v1",
          blueprintVersion: 1,
          blueprintStatus: "pending_generation",
          imageModel: { id: "image.default", label: "GPT-image2-自用生图模型", provider: "openai-compatible" },
          textModel: { id: "text.default", label: "GPT-5.5", provider: "openai-compatible" },
          videoModel: { id: "video.default", label: "Veo 3.1 Portrait", provider: "openai-compatible" },
          ttsProvider: "edge-tts",
          contentLocale: "en",
          operatorLocale: "zh-CN",
          requireStoryboardReview: true,
          requireKeyframeReview: true,
          keyframeCount: 4,
          keyframeGenerationMode: "batch",
          audioStrategy: "tts_only",
          budgetLimitCny: 5,
          aspectRatio: "9:16",
          slotSnapshots: [],
        },
        scenes: [],
        updatedAt: "2026-05-09T00:00:00.000Z",
      },
    } as any)
    vi.mocked(api.getTaskCurrentBlueprint).mockRejectedValue(new Error("TASK_BLUEPRINT_NOT_FOUND"))
    vi.mocked(api.getTaskAssets).mockResolvedValue({ assets: [] } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/task-review?taskId=task_pending"] },
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

    const text = container.textContent ?? ""
    expect(text).toContain("当前任务还在准备生成方案")
    expect(text).toContain("方案版本未生成")
    expect(text).toContain("Summer Product Hook Series")
    expect(text).not.toContain("TASK_BLUEPRINT_NOT_FOUND")
    expect(vi.mocked(api.getTaskCurrentBlueprint)).not.toHaveBeenCalled()
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

    const resumeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("继续生成正片"),
    )

    expect(container.textContent ?? "").not.toContain("审核通过")
    expect(container.textContent ?? "").not.toContain("驳回当前方案")
    expect(container.textContent ?? "").toContain("已通过")
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
      expect(container.textContent ?? "").toContain("待审核")
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
      expect(text).toContain("方案状态已通过")
      expect(text).not.toContain("方案状态待审核")
    })

    const resumeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("继续生成正片"),
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

    const approvedFilterButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("已通过"),
    )
    expect(approvedFilterButton).toBeTruthy()

    await act(async () => {
      approvedFilterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
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

  it("allows updating audio strategy during review without triggering blueprint review actions", async () => {
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
      expect(container.textContent ?? "").toContain("系统配音")
    })

    const audioButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保留环境音 + 系统配音"),
    )
    expect(audioButton).toBeTruthy()

    await act(async () => {
      audioButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.updateTaskAudioStrategy)).toHaveBeenCalledWith("task_reviewable", {
        audioStrategy: "native_plus_tts_ducked",
      })
    })

    expect(vi.mocked(api.reviewTaskBlueprint)).not.toHaveBeenCalled()
    expect(vi.mocked(api.resumeCurrentBlueprint)).not.toHaveBeenCalled()
  })

  it("defaults to pending review tasks and supports approved plus all-task filters", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        {
          id: "task_rejected",
          projectId: "project_default",
          title: "Rejected task",
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
          blueprintStatus: "rejected",
          actualDurationSec: null,
          status: "waiting_review",
          progressPct: 45,
          retryCount: 0,
          estimatedCostCny: 5,
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
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
          blueprintVersion: 1,
          blueprintStatus: "approved",
          actualDurationSec: null,
          status: "waiting_review",
          progressPct: 45,
          retryCount: 0,
          estimatedCostCny: 5,
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        {
          id: "task_pending_generation",
          projectId: "project_default",
          title: "Pending generation task",
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
          progressPct: 10,
          retryCount: 0,
          estimatedCostCny: 5,
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        {
          id: "task_ready",
          projectId: "project_default",
          title: "Ready review task",
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

    vi.mocked(api.getTaskDetail).mockImplementation(async (taskId: string) => ({
      detail: {
        taskId,
        projectId: "project_default",
        title:
          taskId === "task_ready"
            ? "Ready review task"
            : taskId === "task_approved"
              ? "Approved task"
            : taskId === "task_rejected"
              ? "Rejected task"
              : "Pending generation task",
        script: "script",
        blueprintVersion: 1,
        blueprintStatus:
          taskId === "task_ready"
            ? "ready_for_review"
            : taskId === "task_approved"
              ? "approved"
            : taskId === "task_rejected"
              ? "rejected"
              : "pending_generation",
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
          blueprintStatus:
            taskId === "task_ready"
              ? "ready_for_review"
              : taskId === "task_approved"
                ? "approved"
              : taskId === "task_rejected"
                ? "rejected"
                : "pending_generation",
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
    } as any))

    vi.mocked(api.getTaskCurrentBlueprint).mockImplementation(async (taskId: string) => ({
      blueprint: {
        taskId,
        version: 1,
        status:
          taskId === "task_ready"
            ? "ready_for_review"
            : taskId === "task_approved"
              ? "approved"
            : taskId === "task_rejected"
              ? "rejected"
              : "pending_generation",
        updatedAt: "2026-04-20T00:00:00.000Z",
        blueprint: {
          taskId,
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
          globalTheme: "Theme",
          visualStyleGuide: "Guide",
          subjectProfile: "Subject",
          productProfile: "Product",
          backgroundConstraints: [],
          negativeConstraints: [],
          totalVoiceoverScript: "Voiceover",
          sceneContracts: [],
        },
        keyframeManifestPath: null,
      },
      review: null,
      nextStage: { canResumeExecution: false, resumePath: null },
    } as any))

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
      expect(vi.mocked(api.getTaskDetail)).toHaveBeenCalledWith("task_ready")
    })

    const select = container.querySelector("select") as HTMLSelectElement | null
    expect(select).toBeTruthy()
    let optionValues = Array.from(select!.options).map((option) => option.value)
    expect(optionValues).toEqual(["task_ready"])

    const approvedFilterButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("已通过"),
    )
    expect(approvedFilterButton).toBeTruthy()

    await act(async () => {
      approvedFilterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      const nextSelect = container.querySelector("select") as HTMLSelectElement | null
      expect(nextSelect).toBeTruthy()
      optionValues = Array.from(nextSelect!.options).map((option) => option.value)
      expect(optionValues).toEqual(["task_approved"])
    })

    const showAllButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("显示全部任务"),
    )
    expect(showAllButton).toBeTruthy()

    await act(async () => {
      showAllButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      const nextSelect = container.querySelector("select") as HTMLSelectElement | null
      expect(nextSelect).toBeTruthy()
      optionValues = Array.from(nextSelect!.options).map((option) => option.value)
      expect(optionValues).toEqual(["task_rejected", "task_approved", "task_pending_generation", "task_ready"])
    })
  })
})
