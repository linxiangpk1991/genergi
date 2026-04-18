import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

function normalizeRemoteRelative(relativePath) {
  const normalized = normalizeRelative(relativePath).replace(/^\.?\//, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error(`Unsafe remote relative path: ${relativePath}`);
  }
  return normalized;
}

async function listChangedEntries() {
  const { stdout } = await runLocal("git", ["-C", repoRoot, "status", "--porcelain=v1", "-z"]);
  const rawEntries = stdout.split("\0").filter(Boolean);
  const changes = [];

  for (let index = 0; index < rawEntries.length; index += 1) {
    const entry = rawEntries[index];
    const statusCode = entry.slice(0, 2);
    const filePath = entry.slice(3).trim();
    if (!filePath || filePath === "genergi-release.tgz") {
      continue;
    }

    const status = statusCode.trim();
    if (status.startsWith("R")) {
      const renamedTo = rawEntries[index + 1]?.trim();
      if (!renamedTo) {
        continue;
      }
      changes.push({ type: "delete", path: filePath });
      if (renamedTo !== "genergi-release.tgz") {
        changes.push({ type: "sync", path: renamedTo });
      }
      index += 1;
      continue;
    }

    if (status === "D" || statusCode[0] === "D" || statusCode[1] === "D") {
      changes.push({ type: "delete", path: filePath });
      continue;
    }

    changes.push({ type: "sync", path: filePath });
  }

  return changes;
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
  const remotePath = `${remoteRoot}/${normalizeRemoteRelative(relativePath)}`;
  await ensureRemoteDirectory(remotePath);
  await copyFileToRemote(localPath, remotePath, {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    extraScpArgs: ["-o", "ConnectTimeout=15"],
    attempts: 4,
    label: `sync ${relativePath}`,
  });
}

async function deleteRemotePath(relativePath) {
  const remotePath = `${remoteRoot}/${normalizeRemoteRelative(relativePath)}`;
  await runRemoteCommand(`rm -rf '${remotePath}'`, {
    cwd: repoRoot,
    attempts: 4,
    label: `delete ${relativePath}`,
    extraSshArgs: ["-o", "ConnectTimeout=15"],
  });
}

async function runRemoteRebuild() {
  const script = `
set -euo pipefail
cd ${remoteRoot}
set -a
. /opt/genergi/shared.env
set +a
corepack pnpm --filter @genergi/shared build
corepack pnpm --filter @genergi/config build
corepack pnpm --filter @genergi/api build
corepack pnpm --filter @genergi/web build
corepack pnpm --filter @genergi/worker build
sudo systemctl restart genergi-api
sudo systemctl restart genergi-worker
sudo nginx -t
sudo systemctl reload nginx
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8787/api/health >/tmp/genergi-hotfix-health.json; then
    break
  fi
  sleep 2
done
cat /tmp/genergi-hotfix-health.json
curl -fsS -H 'Host: ai.genergius.com' http://127.0.0.1/ >/tmp/genergi-hotfix-home.html
grep -q "GENERGI" /tmp/genergi-hotfix-home.html
curl -fsS http://127.0.0.1:8787/api/bootstrap >/tmp/genergi-hotfix-bootstrap.json
if [ -n "\${GENERGI_ADMIN_USERNAME:-}" ] && [ -n "\${GENERGI_ADMIN_PASSWORD:-}" ]; then
  rm -f /tmp/genergi-hotfix-cookies.txt
  login_payload="$(node -e "console.log(JSON.stringify({ username: process.env.GENERGI_ADMIN_USERNAME, password: process.env.GENERGI_ADMIN_PASSWORD }))")"
  curl -fsS -c /tmp/genergi-hotfix-cookies.txt -H 'Content-Type: application/json' -d "$login_payload" http://127.0.0.1:8787/api/auth/login >/tmp/genergi-hotfix-login.json
  curl -fsS -b /tmp/genergi-hotfix-cookies.txt http://127.0.0.1:8787/api/tasks >/tmp/genergi-hotfix-tasks.json
fi
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
  const changedEntries = files.length
    ? files.map((file) => ({
        type: existsSync(path.join(repoRoot, file)) ? "sync" : "delete",
        path: file,
      }))
    : await listChangedEntries();
  const actionable = changedEntries.filter((item) => item.path && item.path !== "genergi-release.tgz");

  if (!actionable.length) {
    console.log("No changed files to sync.");
    return;
  }

  for (const entry of actionable) {
    if (entry.type === "delete") {
      await deleteRemotePath(entry.path);
      continue;
    }
    await syncFile(entry.path);
  }

  await runRemoteRebuild();
}

await main();
