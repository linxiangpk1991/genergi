# GENERGI 自动化视频平台

GENERGI 是一个面向自动化批量社媒视频生产的云端工作平台。

## 产品定位
- Web 控制台优先
- 批量自动化生成社媒视频
- 模式驱动、预算可控、可审阅、可扩展

## 当前工程结构
- `apps/web`: 控制台前端
- `apps/api`: 业务 API
- `apps/worker`: 任务执行引擎
- `packages/shared`: 共享类型与 contracts
- `packages/ui`: 设计系统组件
- `packages/config`: 模式、品牌、渠道与 provider 配置

## 入口域名
- `ai.genergius.com`

## 公开仓库约束
- 真实密钥不得进入仓库
- 生产配置通过环境变量或私有配置注入
- 示例配置放在 `.env.example` 等模板文件中
