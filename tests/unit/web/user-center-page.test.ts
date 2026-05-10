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
      listUsers: vi.fn(),
      updateUser: vi.fn(),
      createUser: vi.fn(),
      resetUserPassword: vi.fn(),
      createTestUser: vi.fn(),
    },
  }
})

import { api } from "../../../apps/web/src/api"
import { UserCenterPage } from "../../../apps/web/src/pages/UserCenterPage"

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

describe("UserCenterPage", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(api.listUsers).mockResolvedValue({
      users: [
        {
          id: "user_current",
          username: "admin",
          displayName: "Admin",
          status: "active",
          purpose: "operator",
          expiresAt: null,
          createdAt: "2026-05-10T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
          source: "file",
        },
        {
          id: "user_other",
          username: "ops01",
          displayName: "Ops 01",
          status: "active",
          purpose: "operator",
          expiresAt: null,
          createdAt: "2026-05-10T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
          source: "file",
        },
      ],
    } as any)
    vi.mocked(api.updateUser).mockResolvedValue({ user: null } as any)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it("does not allow the current operator to disable their own account", async () => {
    await act(async () => {
      root.render(createElement(UserCenterPage, { operator: "admin" }))
    })

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("admin")
    })

    const rows = Array.from(container.querySelectorAll("tbody tr"))
    const currentRow = rows.find((row) => row.textContent?.includes("admin"))
    const otherRow = rows.find((row) => row.textContent?.includes("ops01"))
    expect(currentRow).toBeTruthy()
    expect(otherRow).toBeTruthy()

    const currentDisableButton = Array.from(currentRow!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("停用"),
    )
    const otherDisableButton = Array.from(otherRow!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("停用"),
    )

    expect(currentDisableButton?.disabled).toBe(true)
    expect(otherDisableButton?.disabled).toBe(false)
  })
})
