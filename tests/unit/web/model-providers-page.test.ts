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
      listModelProviders: vi.fn(),
      validateModelProvider: vi.fn(),
      updateModelProvider: vi.fn(),
      createModelProvider: vi.fn(),
    },
  }
})

import { api } from "../../../apps/web/src/api"
import { ModelProvidersPage } from "../../../apps/web/src/pages/ModelProvidersPage"

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

describe("ModelProvidersPage", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(api.listModelProviders).mockResolvedValue({
      providers: [
        {
          id: "provider_missing_endpoint",
          providerKey: "openai-missing-endpoint",
          providerType: "openai-compatible",
          displayName: "OpenAI Missing Endpoint",
          endpointUrl: "",
          authType: "bearer_token",
          hasSecret: true,
          maskedSecret: "************",
          status: "draft",
          lastValidatedAt: null,
          lastValidationError: null,
        },
      ],
    } as any)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it("blocks provider validation when a non-TTS endpoint is missing", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center/providers"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center/providers", element: createElement(ModelProvidersPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("OpenAI Missing Endpoint")
    })

    const checkButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "检查配置",
    )
    expect(checkButton).toBeTruthy()

    await act(async () => {
      checkButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("接口地址未配置")
      expect(container.textContent ?? "").toContain("载入编辑")
      expect(vi.mocked(api.validateModelProvider)).not.toHaveBeenCalled()
    })
  })

  it("translates legacy English validation errors and blocks invalid endpoint strings", async () => {
    vi.mocked(api.listModelProviders).mockResolvedValue({
      providers: [
        {
          id: "provider_bad_endpoint",
          providerKey: "openai-bad-endpoint",
          providerType: "openai-compatible",
          displayName: "OpenAI Bad Endpoint",
          endpointUrl: "linxiang",
          authType: "bearer_token",
          hasSecret: true,
          maskedSecret: "************",
          status: "invalid",
          lastValidatedAt: "2026-05-09T00:57:32.000Z",
          lastValidationError: "endpointUrl is required for non-TTS providers",
        },
      ],
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center/providers"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center/providers", element: createElement(ModelProvidersPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      const text = container.textContent ?? ""
      expect(text).toContain("OpenAI Bad Endpoint")
      expect(text).toContain("接口地址未配置")
      expect(text).not.toContain("endpointUrl is required")
    })

    const checkButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "检查配置",
    )
    await act(async () => {
      checkButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("接口地址格式不正确")
      expect(vi.mocked(api.validateModelProvider)).not.toHaveBeenCalled()
    })
  })

  it("requires saving the edited provider before checking the table record", async () => {
    vi.mocked(api.listModelProviders).mockResolvedValue({
      providers: [
        {
          id: "provider_missing_endpoint",
          providerKey: "openai-missing-endpoint",
          providerType: "openai-compatible",
          displayName: "OpenAI Missing Endpoint",
          endpointUrl: "",
          authType: "bearer_token",
          hasSecret: true,
          maskedSecret: "************",
          status: "draft",
          lastValidatedAt: null,
          lastValidationError: null,
        },
      ],
    } as any)

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/model-control-center/providers"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/model-control-center/providers", element: createElement(ModelProvidersPage) }),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("OpenAI Missing Endpoint")
    })

    const editButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "载入编辑",
    )
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const endpointInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "例如：https://api.example.com/v1",
    )
    await act(async () => {
      if (endpointInput) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          endpointInput,
          "https://api.example.com/v1",
        )
        endpointInput.dispatchEvent(new Event("input", { bubbles: true }))
      }
    })

    const checkButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "检查配置",
    )
    await act(async () => {
      checkButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("当前接入方有未保存改动")
      expect(vi.mocked(api.validateModelProvider)).not.toHaveBeenCalled()
    })
  })
})
