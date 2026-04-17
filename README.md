# GENERGI 自动化视频平台

GENERGI 是一个面向自动化批量社媒视频生产的云端工作平台，当前聚焦 TikTok、Instagram Reels、YouTube Shorts 的英文内容生产。

## 项目目标

- Web 控制台优先，不做桌面软件形态
- 支持批量生成、审阅、资产管理与持续迭代
- 模式驱动、预算可控、provider 可替换
- 内部操作语言中文优先，内容输出英文优先

## 当前能力

- 登录页与用户中心
- 任务启动工作台
- 分镜审阅与关键帧审阅
- 批量任务看板
- 资产中心（预览 / 下载）
- Edge TTS 音频与字幕产出
- 视频生成与最终成片拼接
- Web / API / Worker 一体化 monorepo

## 仓库结构

- `apps/web`：React + Vite 控制台前端
- `apps/api`：Hono API 服务
- `apps/worker`：Node.js + BullMQ 任务执行引擎
- `packages/shared`：共享 contracts、任务与用户持久化
- `packages/ui`：GENERGI 设计系统组件
- `packages/config`：品牌、渠道、模式与模型配置
- `docs/architecture`：架构与部署文档
- `docs/handover`：交接与协作说明

## 本地开发

### 前置要求

- Node.js `>= 24`
- pnpm `>= 10.12.4`
- Windows PowerShell 或兼容 shell
- Redis（仅当你需要本地跑真实队列时）

### 安装依赖

```bash
pnpm install
```

### 环境变量

复制示例配置并按需填充：

```bash
cp .env.example .env
```

开发期最小建议：

- `GENERGI_SESSION_SECRET`：本地会话签名密钥
- `GENERGI_DATA_DIR`：本地任务 / 用户 / 资产元数据目录，可不填，默认写入 `.data`
- `REDIS_URL`：需要本地队列消费时再配置

说明：

- 未配置 `REDIS_URL` 时，worker 会以“本地 bootstrap 模式”退出，不处理真实队列。
- 生产环境禁止依赖开发兜底账号，必须显式注入真实环境变量。
- 真实 provider key、私有 endpoint、服务器密钥不得提交到仓库。

### 常用命令

```bash
pnpm dev
pnpm dev:web
pnpm dev:api
pnpm dev:worker
pnpm test
pnpm typecheck
pnpm build
```

默认开发端口：

- Web：Vite 默认端口
- API：`http://localhost:8787`

## 部署

正式环境采用稳定的 release 切换模型，而不是把 Docker Compose 当主运行平台：

- 正式发布：`pnpm deploy:production`
- 热补丁发布：`pnpm deploy:hotfix`

更多说明见：

- [生产部署模型](/E:/genergi/docs/architecture/生产部署模型.md)
- [稳定部署能力说明](/E:/genergi/docs/architecture/稳定部署能力说明.md)
- [部署基线](/E:/genergi/docs/architecture/deployment-baseline.md)

## 团队协作入口

首次接手仓库时建议按这个顺序阅读：

1. [仓库交接说明](/E:/genergi/docs/handover/仓库交接说明.md)
2. [项目完整说明](/E:/genergi/docs/handover/项目完整说明.md)
3. [CONTRIBUTING](/E:/genergi/CONTRIBUTING.md)
4. [AGENTS.md](/E:/genergi/AGENTS.md)
5. [线程迁移记忆](/E:/genergi/docs/architecture/线程迁移记忆.md)
6. [DESIGN.md](/E:/genergi/DESIGN.md)

## 公开仓库纪律

- 不提交真实密钥、密码、token、服务器私有地址
- 不把运行期数据放进 release 目录
- 对外公开仓库只保留模板与说明，不保留线上私有接入信息
- `main` 只通过 PR 合并，不直接推送生产改动
