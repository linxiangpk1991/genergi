import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(import.meta.dirname, "..", "..", "..")
const nodeBin = process.execPath

describe("unified media slot rollout smoke script", () => {
  let dataDir = ""

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
    }
    dataDir = ""
  })

  it("clears legacy task data and prints unified frozen slot evidence", async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "genergi-unified-slot-rollout-"))
    await writeFile(
      path.join(dataDir, "tasks.json"),
      JSON.stringify([{ id: "legacy_task", title: "legacy" }], null, 2),
      "utf8",
    )
    await writeFile(
      path.join(dataDir, "task-details.json"),
      JSON.stringify({ legacy_task: { taskId: "legacy_task" } }, null, 2),
      "utf8",
    )
    await writeFile(
      path.join(dataDir, "assets.json"),
      JSON.stringify({ legacy_task: [{ id: "asset_legacy" }] }, null, 2),
      "utf8",
    )
    await mkdir(path.join(dataDir, "exports", "legacy_task"), { recursive: true })

    const { stdout } = await execFileAsync(
      nodeBin,
      ["scripts/validation/unified-media-slot-rollout-smoke.mjs"],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          GENERGI_DATA_DIR: dataDir,
        },
        timeout: 60000,
        maxBuffer: 1024 * 1024 * 4,
      },
    )

    const payload = JSON.parse(stdout) as {
      taskId: string
      slotTypes: string[]
      detailSlotTypes: string[]
    }

    expect(payload.taskId).toMatch(/^task_/)
    expect(payload.slotTypes).toEqual(["textModel", "imageModel", "videoModel", "ttsProvider"])
    expect(payload.detailSlotTypes).toEqual(["textModel", "imageModel", "videoModel", "ttsProvider"])

    const tasks = JSON.parse(await readFile(path.join(dataDir, "tasks.json"), "utf8")) as Array<{ title: string }>
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.title).toBe("Unified media slot rollout smoke")

    const assets = JSON.parse(await readFile(path.join(dataDir, "assets.json"), "utf8")) as Record<string, unknown>
    expect(Object.keys(assets)).toHaveLength(0)
  })
})
