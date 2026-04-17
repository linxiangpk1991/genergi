import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

describe("API user store", () => {
  let dataDir = ""

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
    dataDir = ""
    vi.resetModules()
  })

  it("persists created users and updates them in place", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-users-"))
    process.env.GENERGI_DATA_DIR = dataDir

    const store = await import("../../../apps/api/src/lib/user-store")

    const created = await store.createStoredUser({
      username: "alice",
      password: "initial-pass",
      displayName: "Alice",
    })

    expect(created.username).toBe("alice")
    expect(created.status).toBe("active")
    expect(created.passwordHash).toContain("pbkdf2")

    const listed = await store.listStoredUsers()
    expect(listed).toHaveLength(1)
    expect(listed[0].username).toBe("alice")

    const renamed = await store.updateStoredUser(created.id, {
      username: "ally",
      displayName: "Ally",
      status: "disabled",
    })

    expect(renamed?.username).toBe("ally")
    expect(renamed?.displayName).toBe("Ally")
    expect(renamed?.status).toBe("disabled")

    const passwordUpdated = await store.updateStoredUserPassword(created.id, "new-pass")
    expect(passwordUpdated?.passwordHash).not.toBe(created.passwordHash)

    const reread = await store.listStoredUsers()
    expect(reread[0].username).toBe("ally")
    expect(reread[0].status).toBe("disabled")
  })

  it("includes the env fallback user in the public list", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-users-"))
    process.env.GENERGI_DATA_DIR = dataDir
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "fallback-pass"
    process.env.GENERGI_SESSION_SECRET = "secret"

    const store = await import("../../../apps/api/src/lib/user-store")

    const users = await store.listUsers()

    expect(users.map((user) => user.username)).toContain("admin")
    const envUser = users.find((user) => user.username === "admin")
    expect(envUser?.source).toBe("env")
    expect(envUser?.status).toBe("active")
  })
})
