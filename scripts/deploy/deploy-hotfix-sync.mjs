import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { copyFileToRemote, probeRemote, runRemoteCommand, runRemoteScript } from "../../tools/node/remote.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const remoteRoot = "/opt/genergi/current";

function normalizeRelative(relativePath) {
  return relativePath.replace(/\\/g, "/");
}

async function listChangedFiles() {
  const { stdout } = await runLocal("git", ["-C", repoRoot, "status", "--short"]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z? ]+/, "").trim())
    .filter((line) => line && line !== "genergi-release.tgz");
}

function runLocal(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function ensureRemoteDirectory(remotePath) {
  const remoteDir = path.posix.dirname(remotePath);
  await runRemoteCommand(`mkdir -p '${remoteDir}'`, {
    cwd: repoRoot,
    attempts: 4,
    label: `mkdir ${remoteDir}`,
    extraSshArgs: ["-o", "ConnectTimeout=15"],
  });
}

async function syncFile(relativePath) {
  const localPath = path.join(repoRoot, relativePath);
  const remotePath = `${remoteRoot}/${normalizeRelative(relativePath)}`;
  await ensureRemoteDirectory(remotePath);
  await copyFileToRemote(localPath, remotePath, {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    extraScpArgs: ["-o", "ConnectTimeout=15"],
    attempts: 4,
    label: `sync ${relativePath}`,
  });
}

async function runRemoteRebuild() {
  const script = `
set -euo pipefail
cd ${remoteRoot}
corepack pnpm --filter @genergi/shared build
corepack pnpm --filter @genergi/config build
corepack pnpm --filter @genergi/api build
corepack pnpm --filter @genergi/web build
corepack pnpm --filter @genergi/worker build
sudo systemctl restart genergi-api
sudo systemctl restart genergi-worker
sudo nginx -t
sudo systemctl reload nginx
curl -fsS http://127.0.0.1:8787/api/health
`;

  await runRemoteScript(script, {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    attempts: 4,
    label: "remote rebuild",
    extraSshArgs: ["-o", "ConnectTimeout=15"],
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage:
  pnpm deploy:hotfix
  pnpm deploy:hotfix -- apps/api/src/index.ts apps/web/src/pages/LoginPage.tsx

Behavior:
  - No explicit file list: sync changed files from git status
  - Explicit file list: sync only the listed files
  - Then rebuild shared/config/api/web/worker on the remote current release and restart services
`);
    return;
  }

  await probeRemote({ cwd: repoRoot, attempts: 4, extraSshArgs: ["-o", "ConnectTimeout=15"] });
  const files = args;
  const changedFiles = files.length ? files : await listChangedFiles();
  const syncable = changedFiles.filter((item) => item && item !== "genergi-release.tgz");

  if (!syncable.length) {
    console.log("No changed files to sync.");
    return;
  }

  for (const file of syncable) {
    await syncFile(file);
  }

  await runRemoteRebuild();
}

await main();
