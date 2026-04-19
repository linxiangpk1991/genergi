import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

function resolveDataDir() {
  return process.env.GENERGI_DATA_DIR
    ? path.resolve(process.env.GENERGI_DATA_DIR)
    : path.resolve(process.cwd(), ".data")
}

function now() {
  return new Date().toISOString()
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8")
}

async function main() {
  const dataDir = resolveDataDir()
  const exportsDir = path.join(dataDir, "exports")

  await mkdir(dataDir, { recursive: true })
  await writeJson(path.join(dataDir, "tasks.json"), [])
  await writeJson(path.join(dataDir, "task-details.json"), {})
  await writeJson(path.join(dataDir, "assets.json"), {})
  await writeJson(path.join(dataDir, "runtime-status.json"), {
    api: {
      name: "api",
      status: "healthy",
      updatedAt: now(),
      message: "API online",
    },
    worker: {
      name: "worker",
      status: "degraded",
      updatedAt: now(),
      message: "Worker heartbeat unavailable",
    },
    redis: {
      name: "redis",
      status: "healthy",
      updatedAt: now(),
      message: "Redis configured",
    },
  })
  await rm(exportsDir, { recursive: true, force: true })
  await mkdir(exportsDir, { recursive: true })

  console.log(`[cleanup:legacy-tasks] cleared task data in ${dataDir}`)
}

await main()
