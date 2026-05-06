# 发布检查清单

本文用于 GENERGI 的发布前后门禁检查，重点避免把「本地可用」误判为「线上已更新」。每次发布都必须分开确认本地、GitHub、服务器、线上四层状态。

## 1. 本地状态

- 确认当前目录是 `E:\genergi`，不要在旧仓库 `E:\short-video-factory` 中发布。
- 确认 `git status --short` 中没有未识别的无关改动；如有他人改动，不要覆盖。
- 执行依赖安装校验：`pnpm install --frozen-lockfile`。
- 执行类型检查：`pnpm typecheck`。
- 执行构建：`pnpm build`。
- 执行关键单测：`pnpm test`。
- 确认 `.env.example`、`provider.example.json`、`mode.example.json` 中只有示例值，没有真实 key、token、密码、私有 endpoint。

## 2. GitHub 状态

- PR 必须触发 GitHub Actions `CI` workflow。
- `CI` workflow 至少覆盖依赖安装、类型检查、构建、根目录 Vitest 单测。
- PR 合并前必须确认 GitHub 上的目标分支、提交 SHA、CI 结果都与本地准备发布的版本一致。
- `main` 分支 push 后也必须触发同一套 `CI` workflow，避免绕过 PR 后没有远端门禁。
- 如果 GitHub CI 失败，不要继续发布服务器；先按失败日志定位是依赖、类型、构建、单测还是 Linux 环境差异。

## 3. 服务器状态

- 部署目录必须保持 GENERGI 独立：`/opt/genergi/releases/<timestamp>`、`/opt/genergi/current`、`/opt/genergi/current.prev`、`/opt/genergi/shared/`。
- 不要把 GENERGI 文件混入 `/opt/anhe_automation/current`。
- 运行态数据、任务数据、上传或生成资产必须位于稳定 shared 路径，不应只存在于某个 release 目录。
- 部署后确认 `current` 指向新 release，`current.prev` 保留上一版可回滚 release。
- 确认 `systemd` 中 API / worker 服务已重启并处于运行状态。
- 确认 `nginx` 仍服务 `apps/web/dist`，并把 `/api` 代理到 `127.0.0.1:8787`。
- 如部署失败，先分层判断：TCP 连接、SSH 握手、SSH 认证、文件传输、远端构建、服务重启、线上页面验证，不要笼统归因为代码错误。

## 4. 线上状态

- 公开 DNS 验收必须检查 `ai.genergius.com`，不能只检查 `genergius.com` 或 `www.genergius.com`。
- 健康检查通过后，还必须打开真实页面确认渲染结果。
- 最小页面验收范围：主页、批量任务看板、素材资产中心、用户中心、至少一个审阅页。
- 页面验收时记录线上版本对应的 Git commit 或 release 时间戳，避免浏览器缓存或旧 release 造成误判。
- 如果线上仍显示旧页面，分别核对 GitHub SHA、服务器 `current` 指向、nginx 静态目录、浏览器缓存和 CDN / 代理缓存。

## CI 门禁说明

- 触发条件：PR 目标分支为 `main` 时触发；直接 push 到 `main` 时触发；必要时可手动 `workflow_dispatch` 触发。
- 运行环境：GitHub 执行在 `ubuntu-latest`，Node.js 固定为 `24`，pnpm 固定为 `10.12.4`，与仓库 `package.json` 中的 engines / packageManager 对齐。
- 缓存策略：使用 `actions/setup-node` 的 pnpm 缓存，缓存键由 `pnpm-lock.yaml` 决定；lockfile 变化会自动刷新依赖缓存。
- 门禁命令：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm build`、`pnpm test`。
- 服务器差异风险：CI 不包含真实生产环境变量、Redis、systemd、nginx、生产 shared 数据目录和公网 DNS；CI 通过只代表代码可安装、可类型检查、可构建、关键单测通过，不代表已经部署成功或线上页面已更新。
- Windows / Linux 差异风险：本地开发多在 Windows，CI 在 Linux；路径大小写、shell 行为、可执行文件权限、换行符、原生依赖 ABI 都可能暴露差异。遇到 CI-only 失败时优先复现对应命令，而不是跳过门禁。
