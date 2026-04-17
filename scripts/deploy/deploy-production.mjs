import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { copyFileToRemote, getRemoteSpawnEnv, runRemoteScript } from "../../tools/node/remote.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const tarPath = "C:/Program Files/Git/usr/bin/tar.exe";

const archiveName = "genergi-release.tgz";
const archivePath = path.join(repoRoot, archiveName);
const remoteArchivePath = "/tmp/genergi-release.tgz";
const remoteRoot = "/opt/genergi";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: getRemoteSpawnEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
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
      if ((options.allowedExitCodes ?? [0]).includes(code ?? -1)) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function buildArchive() {
  if (existsSync(archivePath)) {
    rmSync(archivePath, { force: true });
  }

  await run(tarPath, [
    "--warning=no-file-changed",
    "-czf",
    archiveName,
    "--exclude=.git",
    "--exclude=.worktrees",
    "--exclude=node_modules",
    "--exclude=.turbo",
    "--exclude=dist",
    "--exclude=coverage",
    "--exclude=.tmp-*",
    "--exclude=genergi-release.tgz",
    "--exclude=apps/api/.data",
    ".",
  ], { allowedExitCodes: [0, 1] });
}

async function uploadArchive() {
  await copyFileToRemote(archiveName, remoteArchivePath, {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    extraScpArgs: ["-o", "ConnectTimeout=15"],
  });
}

function buildSharedEnvLoadScript() {
  return [
    "set -a",
    ". /opt/genergi/shared.env",
    "set +a",
  ].join("\n");
}

async function runDeploymentRemoteScript() {
  const script = `
set -euo pipefail

sudo mkdir -p ${remoteRoot}/releases
sudo mkdir -p ${remoteRoot}/shared/{env,logs,assets,tmp,data}
sudo mkdir -p ${remoteRoot}/scripts
sudo chown -R ubuntu:ubuntu ${remoteRoot}

release_id="$(date +%Y%m%d%H%M%S)"
release_dir="${remoteRoot}/releases/$release_id"
old_current_target="$(readlink -f ${remoteRoot}/current 2>/dev/null || true)"
old_prev_target="$(readlink -f ${remoteRoot}/current.prev 2>/dev/null || true)"

rm -rf "$release_dir"
mkdir -p "$release_dir"
tar -xzf ${remoteArchivePath} -C "$release_dir"
rm -f ${remoteArchivePath}

cd "$release_dir"
corepack enable
corepack pnpm install --frozen-lockfile=false
corepack pnpm build

cat > /tmp/genergi-api.service <<'SERVICE'
[Unit]
Description=GENERGI API
After=network.target redis.service redis-server.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/genergi/current
EnvironmentFile=/opt/genergi/shared.env
ExecStart=/usr/bin/env bash -lc 'cd /opt/genergi/current && corepack pnpm --filter @genergi/api start'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

cat > /tmp/genergi-worker.service <<'SERVICE'
[Unit]
Description=GENERGI Worker
After=network.target redis.service redis-server.service genergi-api.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/genergi/current
EnvironmentFile=/opt/genergi/shared.env
ExecStart=/usr/bin/env bash -lc 'cd /opt/genergi/current && corepack pnpm --filter @genergi/worker start'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

cat > /tmp/genergi-nginx.conf <<'NGINX'
server {
    listen 80;
    server_name ai.genergius.com;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ai.genergius.com;

    ssl_certificate /etc/letsencrypt/live/ai.genergius.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ai.genergius.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root /opt/genergi/current/apps/web/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

sudo mv /tmp/genergi-api.service /etc/systemd/system/genergi-api.service
sudo mv /tmp/genergi-worker.service /etc/systemd/system/genergi-worker.service
sudo mv /tmp/genergi-nginx.conf /etc/nginx/sites-available/genergi-ai
sudo ln -sfn /etc/nginx/sites-available/genergi-ai /etc/nginx/sites-enabled/genergi-ai
sudo rm -f /etc/nginx/sites-enabled/default

if [ -n "$old_current_target" ] && [ -f "$old_current_target/infra/deploy/docker-compose.yml" ]; then
  (
    cd "$old_current_target/infra/deploy"
    sudo -n docker compose down || true
  )
fi

rm -rf ${remoteRoot}/current
ln -sfn "$release_dir" ${remoteRoot}/current

rm -rf ${remoteRoot}/current.prev
if [ -n "$old_current_target" ] && [ -d "$old_current_target" ]; then
  ln -sfn "$old_current_target" ${remoteRoot}/current.prev
fi

rollback_release() {
  rm -rf ${remoteRoot}/current || true
  if [ -n "$old_current_target" ] && [ -d "$old_current_target" ]; then
    ln -sfn "$old_current_target" ${remoteRoot}/current || true
  fi

  rm -rf ${remoteRoot}/current.prev || true
  if [ -n "$old_prev_target" ] && [ -d "$old_prev_target" ]; then
    ln -sfn "$old_prev_target" ${remoteRoot}/current.prev || true
  fi

  sudo systemctl restart genergi-api || true
  sudo systemctl restart genergi-worker || true
  sudo systemctl reload nginx || true
}

${buildSharedEnvLoadScript()}
sudo systemctl daemon-reload
sudo systemctl enable genergi-api
sudo systemctl enable genergi-worker
if ! sudo systemctl restart genergi-api; then
  echo "API restart failed after release activation. Rolling back." >&2
  rollback_release
  exit 1
fi

if ! sudo systemctl restart genergi-worker; then
  echo "Worker restart failed after release activation. Rolling back." >&2
  rollback_release
  exit 1
fi

if ! sudo nginx -t; then
  echo "nginx config test failed after release activation. Rolling back." >&2
  rollback_release
  exit 1
fi

if ! sudo systemctl reload nginx; then
  echo "nginx reload failed after release activation. Rolling back." >&2
  rollback_release
  exit 1
fi

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8787/api/health >/tmp/genergi-health.json; then
    break
  fi
  sleep 2
done

cat /tmp/genergi-health.json
curl -fsS -H 'Host: ai.genergius.com' http://127.0.0.1/api/health
systemctl is-active genergi-worker
ls -ld ${remoteRoot}/current ${remoteRoot}/current.prev 2>/dev/null || true
find ${remoteRoot}/releases -maxdepth 1 -mindepth 1 -type d | sort
`;

  await runRemoteScript(script, {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    extraSshArgs: ["-o", "ConnectTimeout=15"],
  });
}

async function main() {
  await buildArchive();
  await uploadArchive();
  await runDeploymentRemoteScript();
}

await main();
