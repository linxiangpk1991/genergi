import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

describe("API health metadata", () => {
  let tempDir = ""
  const originalCwd = process.cwd()

  afterEach(async () => {
    delete process.env.GENERGI_RELEASE_ID
    delete process.env.GENERGI_GIT_SHA
    delete process.env.GENERGI_DEPLOYED_AT
    process.chdir(originalCwd)
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = ""
    }
    vi.resetModules()
  })

  it("exposes release metadata for live deployment verification", async () => {
    process.env.GENERGI_RELEASE_ID = "release_20260507050102"
    process.env.GENERGI_GIT_SHA = "18320c5abc"
    process.env.GENERGI_DEPLOYED_AT = "2026-05-07T05:01:02.000Z"

    const { app } = await import("../../../apps/api/src/index")
    const response = await app.request("/api/health")

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: "ok",
      service: "genergi-api",
      version: "0.1.0",
      release: {
        id: "release_20260507050102",
        gitSha: "18320c5abc",
        deployedAt: "2026-05-07T05:01:02.000Z",
      },
    })
  })

  it("finds release metadata written at the release root when the API runs from a package directory", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "genergi-release-root-"))
    const apiCwd = path.join(tempDir, "apps", "api")
    await mkdir(apiCwd, { recursive: true })
    await writeFile(
      path.join(tempDir, "release.json"),
      JSON.stringify({
        id: "20260507045659",
        gitSha: "18320c5ec6ab",
        deployedAt: "2026-05-07T04:56:59Z",
      }),
      "utf8",
    )
    process.chdir(apiCwd)

    const { app } = await import("../../../apps/api/src/index")
    const response = await app.request("/api/health")

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      release: {
        id: "20260507045659",
        gitSha: "18320c5ec6ab",
        deployedAt: "2026-05-07T04:56:59Z",
      },
    })
  })
})
