# CONTRIBUTING

本文档用于统一 `GENERGI` 公开仓库的协作方式，方便团队成员在个人仓库协作模式下持续迭代。

## 协作原则

- 默认通过分支 + PR 协作，不直接推送 `main`
- 每次改动尽量聚焦单一目标，避免把无关调整混进同一个 PR
- 文档、架构说明、部署脚本变更要与代码一起更新
- 真实密钥、密码、token、私有 endpoint、服务器专有路径细节不得提交

## 分支建议

- `main`：稳定主线，始终保持可交接、可部署
- `feat/<topic>`：功能开发
- `fix/<topic>`：问题修复
- `docs/<topic>`：文档整理
- `chore/<topic>`：杂项维护

如果是较大需求，先在 issue 或设计文档里明确范围，再开分支。

## 本地启动

```bash
pnpm install
pnpm dev
```

常用单项命令：

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:worker
pnpm test
pnpm typecheck
pnpm build
```

说明：

- 不配置 `REDIS_URL` 时，worker 不会处理真实队列，这是当前仓库的允许行为。
- 本地数据默认落在 `.data`，共享或部署环境请使用显式的 `GENERGI_DATA_DIR`。

## 提交前检查

至少完成以下检查中的相关项：

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

如果某项因为环境限制无法执行，需在 PR 描述里明确说明原因与影响面。

## Pull Request 要求

PR 描述至少写清楚：

- 改了什么
- 为什么改
- 如何验证
- 是否影响部署、配置、数据结构
- 是否需要补文档或回滚预案

推荐小步提交，避免一个 PR 同时包含 UI 重构、部署改造、provider 接入和文档大改。

## 文档要求

以下场景必须同步更新文档：

- 调整部署方式
- 增加或删除环境变量
- 修改任务流、审阅流、资产流
- 引入新的 provider 或外部依赖
- 改变团队协作规则

优先更新：

- `README.md`
- `docs/handover/仓库交接说明.md`
- `docs/architecture/*`

## 发布与部署纪律

- 生产部署遵循 `/opt/genergi/releases/<timestamp>` + `current/current.prev` 切换模型
- 不把运行期状态写进 release 目录
- `apps/web/dist` 由 `nginx` 提供静态服务
- `api` / `worker` 由 `systemd` 守护

正式部署前，至少确认：

- `curl -fsS http://127.0.0.1:8787/api/health`
- `systemctl is-active genergi-worker`
- `ai.genergius.com` 的真实 DNS 与公网可访问性

## 安全规则

- 公开仓库只保留 `.env.example`、`provider.example.json`、`mode.example.json`
- 不提交 `.env`
- 不提交本地工具专用目录，例如 `.claude/`
- 发现误提交敏感信息时，先停止扩散，再立刻轮换密钥并清理历史
