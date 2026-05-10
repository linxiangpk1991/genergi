import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(import.meta.dirname, "..", "..", "..")
const nodeBin = process.execPath

describe("clear legacy task data script", () => {
  let dataDir = ""

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    dataDir = ""
  })

  it("refuses to clear task data in production unless explicitly confirmed", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-clear-guard-"))

    await expect(
      execFileAsync(nodeBin, ["scripts/clear-legacy-task-data.mjs"], {
        cwd: rootDir,
        env: {
          ...process.env,
          GENERGI_DATA_DIR: dataDir,
          NODE_ENV: "production",
        },
      }),
    ).rejects.toThrow(/Refusing to clear production task data/)
  })

  it("backs up task files before clearing local task data", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-clear-local-"))
    await writeFile(path.join(dataDir, "tasks.json"), JSON.stringify([{ id: "task_old" }]), "utf8")
    await writeFile(path.join(dataDir, "task-details.json"), JSON.stringify({ task_old: { taskId: "task_old" } }), "utf8")
    await writeFile(path.join(dataDir, "assets.json"), JSON.stringify({ task_old: [] }), "utf8")

    await execFileAsync(nodeBin, ["scripts/clear-legacy-task-data.mjs"], {
      cwd: rootDir,
      env: {
        ...process.env,
        GENERGI_DATA_DIR: dataDir,
        NODE_ENV: "test",
      },
    })

    expect(JSON.parse(await readFile(path.join(dataDir, "tasks.json"), "utf8"))).toEqual([])
    const files = await readdir(dataDir)
    expect(files.some((file) => /^tasks\.json\.bak\.\d{14}$/.test(file))).toBe(true)
    expect(files.some((file) => /^task-details\.json\.bak\.\d{14}$/.test(file))).toBe(true)
    expect(files.some((file) => /^assets\.json\.bak\.\d{14}$/.test(file))).toBe(true)
  })
})
