import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
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
  const productionDataDir = path.resolve("/opt/genergi/shared/data")
  const isProductionDataDir = path.resolve(dataDir) === productionDataDir
  const isProductionRuntime = process.env.NODE_ENV === "production" || isProductionDataDir
  const confirmed = process.env.GENERGI_CONFIRM_CLEAR_PRODUCTION_TASK_DATA === "I_UNDERSTAND_THIS_DELETES_PRODUCTION_TASKS"

  if (isProductionRuntime && !confirmed) {
    throw new Error(
      [
        "Refusing to clear production task data.",
        "Set GENERGI_CONFIRM_CLEAR_PRODUCTION_TASK_DATA=I_UNDERSTAND_THIS_DELETES_PRODUCTION_TASKS only for an intentional production reset.",
        `Resolved data dir: ${dataDir}`,
      ].join(" "),
    )
  }

  await mkdir(dataDir, { recursive: true })
  const backupStamp = now().replace(/[-:.TZ]/g, "").slice(0, 14)
  for (const fileName of ["tasks.json", "task-details.json", "assets.json"]) {
    const filePath = path.join(dataDir, fileName)
    if (existsSync(filePath)) {
      await copyFile(filePath, `${filePath}.bak.${backupStamp}`)
    }
  }
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
