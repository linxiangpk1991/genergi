import { spawn } from "node:child_process";
import process from "node:process";

const defaultRemoteConfig = {
  sshPath: "C:/Program Files/Git/usr/bin/ssh.exe",
  scpPath: "C:/Program Files/Git/usr/bin/scp.exe",
  host: "ubuntu@165.154.4.149",
  sshKeyPath: "C:/Users/linxi/.ssh/ssh-key-2026-03-05 (1).key",
};

export function getRemoteSpawnEnv(extraEnv = {}) {
  return {
    ...process.env,
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    windir: process.env.windir ?? process.env.SystemRoot ?? "C:\\Windows",
    ComSpec: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
    PATHEXT:
      process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL",
    PATH: `C:/Program Files/Git/usr/bin;C:/Program Files/Git/cmd;${process.env.PATH ?? ""}`,
    ...extraEnv,
  };
}

export function resolveRemoteConfig(overrides = {}) {
  return {
    sshPath: process.env.GENERGI_REMOTE_SSH_PATH ?? overrides.sshPath ?? defaultRemoteConfig.sshPath,
    scpPath: process.env.GENERGI_REMOTE_SCP_PATH ?? overrides.scpPath ?? defaultRemoteConfig.scpPath,
    host: process.env.GENERGI_REMOTE_HOST ?? overrides.host ?? defaultRemoteConfig.host,
    sshKeyPath:
      process.env.GENERGI_REMOTE_SSH_KEY ?? overrides.sshKeyPath ?? defaultRemoteConfig.sshKeyPath,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRemoteError(message) {
  const normalized = `${message ?? ""}`.toLowerCase();
  return [
    "connection reset",
    "connection closed",
    "connection timed out",
    "could not resolve hostname",
    "broken pipe",
    "no route to host",
    "kex_exchange_identification",
    "scp: connection closed",
    "client_loop: send disconnect",
  ].some((token) => normalized.includes(token));
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? getRemoteSpawnEnv(),
      stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        if (options.echoOutput !== false) {
          process.stdout.write(chunk);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        if (options.echoOutput !== false) {
          process.stderr.write(chunk);
        }
      });
    }

    child.on("error", reject);
    const allowedExitCodes = options.allowedExitCodes ?? [0];

    child.on("close", (code) => {
      if (allowedExitCodes.includes(code ?? -1)) {
        resolve({ code: code ?? 0, stdout, stderr });
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${stdout}\n${stderr}`));
    });

    if (options.input && child.stdin) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
  });
}

async function runWithRetry(action, options = {}) {
  const attempts = options.attempts ?? 3;
  const label = options.label ?? "remote operation";
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!isRetryableRemoteError(message) || attempt >= attempts) {
        throw error;
      }

      if (options.echo !== false) {
        console.warn(`[remote retry ${attempt}/${attempts}] ${label} failed: ${message}`);
      }
      await sleep((options.baseDelayMs ?? 1500) * attempt);
    }
  }

  throw lastError ?? new Error(`${label} failed`);
}

export async function runRemoteCommand(remoteCommand, options = {}) {
  const config = resolveRemoteConfig(options);
  const args = [
    "-i",
    config.sshKeyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    ...(options.extraSshArgs ?? []),
    config.host,
    remoteCommand,
  ];

  return runWithRetry(
    () =>
      runProcess(config.sshPath, args, {
        cwd: options.cwd,
        env: getRemoteSpawnEnv(options.env),
        stdio: options.stdio,
        input: options.input,
        allowedExitCodes: options.allowedExitCodes,
        echoOutput: options.echoOutput,
      }),
    {
      attempts: options.attempts ?? 3,
      label: options.label ?? remoteCommand,
      baseDelayMs: options.baseDelayMs,
      echo: options.echoOutput,
    },
  );
}

export async function runRemoteScript(script, options = {}) {
  const config = resolveRemoteConfig(options);
  const args = [
    "-i",
    config.sshKeyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    ...(options.extraSshArgs ?? []),
    config.host,
    "bash -s",
  ];

  return runWithRetry(
    () =>
      runProcess(config.sshPath, args, {
        cwd: options.cwd,
        env: getRemoteSpawnEnv(options.env),
        stdio: options.stdio,
        input: script,
        allowedExitCodes: options.allowedExitCodes,
        echoOutput: options.echoOutput,
      }),
    {
      attempts: options.attempts ?? 3,
      label: options.label ?? "remote script",
      baseDelayMs: options.baseDelayMs,
      echo: options.echoOutput,
    },
  );
}

export async function copyFileToRemote(localPath, remotePath, options = {}) {
  const config = resolveRemoteConfig(options);
  const args = [
    "-i",
    config.sshKeyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    ...(options.extraScpArgs ?? []),
    localPath,
    `${config.host}:${remotePath}`,
  ];

  return runWithRetry(
    () =>
      runProcess(config.scpPath, args, {
        cwd: options.cwd,
        env: getRemoteSpawnEnv(options.env),
        stdio: options.stdio,
        allowedExitCodes: options.allowedExitCodes,
        echoOutput: options.echoOutput,
      }),
    {
      attempts: options.attempts ?? 3,
      label: options.label ?? `scp ${localPath}`,
      baseDelayMs: options.baseDelayMs,
      echo: options.echoOutput,
    },
  );
}

export async function probeRemote(options = {}) {
  return runRemoteCommand("hostname", {
    ...options,
    label: options.label ?? "remote probe",
  });
}
