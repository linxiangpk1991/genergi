import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../apps/web/src/api", async () => {
  const actual = await vi.importActual<typeof import("../../../apps/web/src/api")>(
    "../../../apps/web/src/api",
  )
  return {
    ...actual,
    api: {
      ...actual.api,
      bootstrap: vi.fn(),
      listTasks: vi.fn(),
      listProjects: vi.fn(),
      createTask: vi.fn(),
    },
  }
})

import {
  api,
  type BootstrapResponse,
  type ProjectRecord,
} from "../../../apps/web/src/api"
import { HomePage } from "../../../apps/web/src/pages/HomePage"

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

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

function createBootstrapResponse(): BootstrapResponse {
  return {
    brand: {
      productName: "GENERGI 自动化视频平台",
      companyName: "Genergius",
      domain: "ai.genergius.com",
    },
    durationOptions: [15, 30, 45, 60],
  }
}

function createProjects(): ProjectRecord[] {
  return [
    {
      id: "project_default",
      name: "Default Project",
      description: "默认项目",
      brandDirection: "高转化",
      defaultChannelIds: ["tiktok"],
      reusableStyleConstraints: ["高对比"],
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
    },
    {
      id: "project_campaign",
      name: "Campaign Project",
      description: "Campaign rollout",
      brandDirection: "品牌质感",
      defaultChannelIds: ["reels"],
      reusableStyleConstraints: ["产品居中"],
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
    },
  ]
}

describe("HomePage project and terminal preset flow", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.clear()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(api.bootstrap).mockResolvedValue(createBootstrapResponse())
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] })
    vi.mocked(api.listProjects).mockResolvedValue({ projects: createProjects() })
    vi.mocked(api.createTask).mockResolvedValue({
      task: {
        id: "task_created",
        projectId: "project_campaign",
        title: "Campaign launch",
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
        targetDurationSec: 30,
        generationMode: "user_locked",
        audioStrategy: "native_plus_tts_ducked",
        generationRoute: "multi_scene",
        routeReason: "target duration exceeds single-shot limit",
        planningVersion: "v1",
        blueprintVersion: 1,
        blueprintStatus: "pending_generation",
        actualDurationSec: null,
        status: "queued",
        progressPct: 0,
        retryCount: 0,
        estimatedCostCny: 5,
        createdAt: "2026-04-20T00:00:00.000Z",
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

  it("creates a task with projectId and terminalPresetId while showing execution mode and render spec summary", async () => {
    await act(async () => {
      root.render(createElement(HomePage))
    })

    await waitFor(() => {
      expect(vi.mocked(api.listProjects)).toHaveBeenCalledTimes(1)
    })

    const titleInput = container.querySelector('input[placeholder*="夏季新品种草短视频"]') as HTMLInputElement | null
    const scriptInput = container.querySelector('textarea[placeholder*="直接写要表达的内容"]') as HTMLTextAreaElement | null
    expect(titleInput).toBeTruthy()
    expect(scriptInput).toBeTruthy()

    await act(async () => {
      setInputValue(titleInput!, "Campaign launch")
      setInputValue(
        scriptInput!,
        "Lead with the problem, show the product, end on a direct CTA.",
      )
    })

    const selects = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[]
    const projectSelect = selects.find((select) => Array.from(select.options).some((option) => option.value === "project_campaign"))
    const terminalPresetSelect = selects.find((select) => Array.from(select.options).some((option) => option.value === "tablet_landscape"))

    expect(projectSelect).toBeTruthy()
    expect(terminalPresetSelect).toBeTruthy()

    await act(async () => {
      projectSelect!.value = "project_campaign"
      projectSelect!.dispatchEvent(new Event("change", { bubbles: true }))
      terminalPresetSelect!.value = "tablet_landscape"
      terminalPresetSelect!.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const mixedAudioButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保留环境音 + 系统配音"),
    )
    expect(mixedAudioButton).toBeTruthy()
    const whisperSubtitleButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("从成片音频识别字幕"),
    )
    expect(whisperSubtitleButton).toBeTruthy()

    await act(async () => {
      mixedAudioButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      whisperSubtitleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("审核优先")
      expect(text).toContain("2048 × 1536")
      expect(text).toContain("4:3")
      expect(text).toContain("审核优先")
      expect(text).toContain("单一路径")
      expect(text).toContain("从成片音频识别字幕")
    })

    const submitButton = Array.from(container.querySelectorAll("button")).find((button) =>
      /提交，先生成审核内容/.test(button.textContent ?? ""),
    )
    expect(submitButton).toBeTruthy()

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const confirmButton = findHomeButton(container, /确认提交/)
    expect(confirmButton).toBeTruthy()

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.createTask)).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("已提交，等待审核")
      expect(text).toContain("任务“Campaign launch”已提交。")
      expect(text).toContain("去看板跟进")
      expect(text).toContain("查看素材文件")
    })

    await waitFor(() => {
      const toast = container.querySelector('[role="status"]')
      expect(toast?.textContent ?? "").toContain("任务“Campaign launch”已提交。")
    })

    const payload = vi.mocked(api.createTask).mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      title: "Campaign launch",
      projectId: "project_campaign",
      terminalPresetId: "tablet_landscape",
      targetDurationSec: 30,
      audioStrategy: "native_plus_tts_ducked",
      subtitleStrategy: "whisper_cpp",
    })
    expect(payload).not.toHaveProperty("aspectRatio")
    expect(payload).not.toHaveProperty("modeId")
    expect(payload).not.toHaveProperty("channelId")
    expect(payload).not.toHaveProperty("generationMode")
    expect(payload).not.toHaveProperty("modelOverrides")
  })

  it("shows a floating error toast when queue submission fails", async () => {
    vi.mocked(api.createTask).mockRejectedValueOnce(new Error("REDIS_URL missing"))

    await act(async () => {
      root.render(createElement(HomePage))
    })

    await waitFor(() => {
      expect(vi.mocked(api.listProjects)).toHaveBeenCalledTimes(1)
    })

    const titleInput = container.querySelector('input[placeholder*="夏季新品种草短视频"]') as HTMLInputElement | null
    const scriptInput = container.querySelector('textarea[placeholder*="直接写要表达的内容"]') as HTMLTextAreaElement | null
    expect(titleInput).toBeTruthy()
    expect(scriptInput).toBeTruthy()

    await act(async () => {
      setInputValue(titleInput!, "Failed launch")
      setInputValue(scriptInput!, "Need a visible failure message.")
    })

    const submitButton = Array.from(container.querySelectorAll("button")).find((button) =>
      /提交，先生成审核内容/.test(button.textContent ?? ""),
    )
    expect(submitButton).toBeTruthy()

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const confirmButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("确认提交"),
    )
    expect(confirmButton).toBeTruthy()

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      const toast = container.querySelector('[role="alert"]')
      expect(toast?.textContent ?? "").toContain("任务排队服务暂不可用")
    })
  })
})

function createRecentHomeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_recent",
    projectId: "project_default",
    title: "Recent launch",
    modeId: "high_quality",
    executionMode: "review_required",
    channelId: "tiktok",
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
    audioStrategy: "tts_only",
    subtitleStrategy: "tts_aligned",
    generationRoute: "multi_scene",
    routeReason: "target duration exceeds single-shot limit",
    planningVersion: "v1",
    blueprintVersion: 1,
    blueprintStatus: "pending_generation",
    actualDurationSec: null,
    status: "running",
    progressPct: 40,
    retryCount: 0,
    estimatedCostCny: 5,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  }
}

function findHomeButton(container: HTMLElement, pattern: RegExp) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    pattern.test(button.textContent ?? ""),
  )
}

describe("HomePage P0-P2 launch console behavior", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.clear()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(api.bootstrap).mockResolvedValue(createBootstrapResponse())
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] })
    vi.mocked(api.listProjects).mockResolvedValue({ projects: createProjects() })
    vi.mocked(api.createTask).mockResolvedValue({
      task: createRecentHomeTask({
        id: "task_created",
        title: "Campaign launch",
        status: "running",
        blueprintStatus: "pending_generation",
      }),
    } as any)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  async function renderHomePage() {
    await act(async () => {
      root.render(createElement(HomePage))
    })

    await waitFor(() => {
      expect(vi.mocked(api.listProjects)).toHaveBeenCalledTimes(1)
    })
  }

  it("shows the three-step launch flow and preflight check copy", async () => {
    await renderHomePage()

    const text = container.textContent ?? ""
    expect(text).toContain("项目与输出")
    expect(text).toContain("原始文案")
    expect(text).toContain("启动前确认")
    expect(text).toMatch(/启动前检查|启动前确认|预检/)
  })

  it("shows field-level errors and review-blueprint submit copy for empty title and source content", async () => {
    await renderHomePage()

    const submitButton = findHomeButton(
      container,
      /提交，先生成审核内容|确认流程/,
    )
    expect(submitButton).toBeTruthy()

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toMatch(/提交，先生成审核内容|确认流程/)
      expect(text).toMatch(/任务名称.*(必填|不能为空|请填写任务名称)/)
      expect(text).toMatch(/(原始文案|文案).*(必填|不能为空|请填写原始文案)/)
    })
    expect(vi.mocked(api.createTask)).not.toHaveBeenCalled()
  })

  it("shows a preflight warning when source content is too short", async () => {
    await renderHomePage()

    const titleInput = container.querySelector('input[placeholder*="夏季新品种草短视频"]') as HTMLInputElement | null
    const scriptInput = container.querySelector('textarea[placeholder*="直接写要表达的内容"]') as HTMLTextAreaElement | null
    expect(titleInput).toBeTruthy()
    expect(scriptInput).toBeTruthy()

    await act(async () => {
      setInputValue(titleInput!, "Short source check")
      setInputValue(scriptInput!, "Buy now.")
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toMatch(/文案偏短|建议补充|原始文案.*偏短/)
    })
  })

  it("shows a review-first next-step card after the task launch succeeds", async () => {
    await renderHomePage()

    const titleInput = container.querySelector('input[placeholder*="夏季新品种草短视频"]') as HTMLInputElement | null
    const scriptInput = container.querySelector('textarea[placeholder*="直接写要表达的内容"]') as HTMLTextAreaElement | null
    expect(titleInput).toBeTruthy()
    expect(scriptInput).toBeTruthy()

    await act(async () => {
      setInputValue(titleInput!, "Campaign launch")
      setInputValue(
        scriptInput!,
        "Lead with the customer problem, show the product in context, explain the benefit, and close with a direct CTA.",
      )
    })

    const submitButton = findHomeButton(
      container,
      /提交，先生成审核内容|确认流程/,
    )
    expect(submitButton).toBeTruthy()

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const confirmButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("确认提交"),
    )
    expect(confirmButton).toBeTruthy()

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(vi.mocked(api.createTask)).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("已提交，等待审核")
      expect(text).toMatch(/生成方案和关键画面准备中/)
      expect(text).toMatch(/进入任务审核|去看板跟进/)
    })
  })

  it("renders recent task status in Chinese instead of raw status ids", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        createRecentHomeTask({ id: "task_running", title: "Running task", status: "running" }),
        createRecentHomeTask({ id: "task_failed", title: "Failed task", status: "failed" }),
        createRecentHomeTask({ id: "task_completed", title: "Completed task", status: "completed" }),
      ],
    } as any)

    await renderHomePage()

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("生成中")
      expect(text).toContain("异常")
      expect(text).toContain("已完成")
      expect(text).not.toMatch(/\b(running|failed|completed)\b/)
    })
  })
})

