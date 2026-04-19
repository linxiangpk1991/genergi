import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const nodeBin = process.execPath
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

async function run(command, args) {
  const options = {
    cwd: rootDir,
    env: process.env,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8,
  }

  const result = process.platform === "win32" && command.endsWith(".cmd")
    ? await execFileAsync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command, ...args], options)
    : await execFileAsync(command, args, options)

  return result.stdout.trim()
}

await run(nodeBin, ["scripts/clear-legacy-task-data.mjs"])
await run(pnpmBin, ["--filter", "@genergi/shared", "build"])
await run(pnpmBin, ["--filter", "@genergi/config", "build"])

const smokeOutput = await run(pnpmBin, ["exec", "tsx", "scripts/validation/unified-media-slot-smoke.ts"])
process.stdout.write(smokeOutput)
