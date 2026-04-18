import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("API auth", () => {
  let dataDir = ""

  beforeEach(() => {
    process.env.NODE_ENV = "test"
  })

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    delete process.env.GENERGI_DATA_DIR
    delete process.env.GENERGI_ADMIN_USERNAME
    delete process.env.GENERGI_ADMIN_PASSWORD
    delete process.env.GENERGI_SESSION_SECRET
    process.env.NODE_ENV = "test"
    dataDir = ""
    vi.resetModules()
  })

  it("accepts persisted users and invalidates disabled sessions", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-auth-"))
    process.env.GENERGI_DATA_DIR = dataDir
    process.env.GENERGI_SESSION_SECRET = "secret"

    const store = await import("../../../apps/api/src/lib/user-store")
    const auth = await import("../../../apps/api/src/lib/auth")

    const created = await store.createStoredUser({
      username: "alice",
      password: "initial-pass",
    })

    const login = await auth.resolveLoginCredentials("alice", "initial-pass")
    expect(login.ok).toBe(true)
    if (!login.ok) {
      throw new Error(login.reason)
    }

    const sessionUser = await auth.getSessionUserFromCookieValue(
      auth.buildSessionValue(login.user.username, "secret"),
    )
    expect(sessionUser?.username).toBe("alice")

    await store.setStoredUserEnabled(created.id, false)

    const disabledSessionUser = await auth.getSessionUserFromCookieValue(
      auth.buildSessionValue("alice", "secret"),
    )
    expect(disabledSessionUser).toBeNull()
  })

  it("falls back to the env admin when no file user matches", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-auth-"))
    process.env.GENERGI_DATA_DIR = dataDir
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "fallback-pass"
    process.env.GENERGI_SESSION_SECRET = "secret"

    const auth = await import("../../../apps/api/src/lib/auth")

    const login = await auth.resolveLoginCredentials("admin", "fallback-pass")
    expect(login.ok).toBe(true)
    if (!login.ok) {
      throw new Error(login.reason)
    }

    expect(login.user.source).toBe("env")
    const sessionUser = await auth.getSessionUserFromCookieValue(
      auth.buildSessionValue("admin", "secret"),
    )
    expect(sessionUser?.username).toBe("admin")
    expect(sessionUser?.source).toBe("env")
  })

  it("keeps local http login cookies usable without the secure flag", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-auth-"))
    process.env.GENERGI_DATA_DIR = dataDir
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
    process.env.GENERGI_SESSION_SECRET = "secret"

    const { app } = await import("../../../apps/api/src/index")

    const response = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "password" }),
      headers: {
        "Content-Type": "application/json",
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).not.toContain("Secure")
  })

  it("sets secure session cookies for https logins", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-auth-"))
    process.env.GENERGI_DATA_DIR = dataDir
    process.env.GENERGI_ADMIN_USERNAME = "admin"
    process.env.GENERGI_ADMIN_PASSWORD = "password"
    process.env.GENERGI_SESSION_SECRET = "secret"

    const { app } = await import("../../../apps/api/src/index")

    const response = await app.request("https://ai.genergius.com/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "password" }),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "https",
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain("Secure")
  })
})
