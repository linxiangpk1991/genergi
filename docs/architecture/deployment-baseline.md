# Deployment Baseline

## Primary Entry
- ai.genergius.com

## Shared Host Strategy
- Reuse the existing production host used by `anhe_automation`.
- Keep GENERGI isolated under `/opt/genergi/`.

## Recommended Layout
- `/opt/genergi/releases/<timestamp>`
- `/opt/genergi/current`
- `/opt/genergi/shared/`

## Packaged ABI
- 当前仓库的交付基线是 `apps/web` 静态构建产物与 `apps/api` / `apps/worker` 的 Node.js 构建产物。
- 任何影响部署产物结构、Node 运行时版本、systemd 启动入口、或前端静态资源输出路径的变更，都应视为 Packaged ABI 变更。
- 发生 Packaged ABI 变更时，必须同步更新部署文档、脚本与回滚说明。
- 当前最小 ABI gate 由 `scripts/check-packaged-abi.ps1` 提供，至少检查：
  - `apps/web/dist/index.html`
  - `apps/web/dist/assets/*`
  - `apps/api/dist/apps/api/src/index.js`
  - `apps/worker/dist/apps/worker/src/index.js`

若这些构建入口不存在，发布不得继续。
