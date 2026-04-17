# GENERGI Design System

## Overview

`GENERGI 自动化视频平台` 是一个面向中文运营团队、服务于海外英语市场内容产线的 Web 平台。  
界面不是传统扁平后台，也不是纯创意工具，而是：

- **整体结构**：专业生产中台
- **核心工作页**：更有工作台和审阅感
- **默认首页**：任务启动工作台

这个文件是全局 UI 设计契约。后续页面实现、组件扩展、视觉迭代，都必须以它为准。

## Product Identity

- 主品牌：`GENERGI`
- 产品展示名：`GENERGI 自动化视频平台`
- 公司 / 域名层：`Genergius`
- 主入口域名：`ai.genergius.com`

## Audience Model

### Operator

- 中文团队
- 桌面端高密度后台操作
- 需要清晰、稳定、少歧义的 UI

### Content Output

- 英语优先
- 海外英语国家用户
- 默认平台：TikTok / Instagram Reels / YouTube Shorts

## Visual Direction

### Tone

- 冷静
- 专业
- 可信
- 不做模板味很重的“普通 admin”
- 不做花哨但信息密度差的“展示型 SaaS”

### Composition

- 首页和批量页强调中台秩序感
- 分镜审阅和关键帧审阅强调工作台感
- 审阅页允许更强视觉聚焦，但不能牺牲信息结构

## Color System

### Primary

- `#0047AB`
- 用于品牌主色、主按钮、选中态、关键引导信息

### Primary Deep

- `#00327D`
- 用于标题、重要文本、高优先级状态强调

### Accent

- `#F2711C`
- 用于预算、提醒、强调性操作、阶段性重点信息

### Surface

- `#F7F9FC`
- 页面背景和次级区域基底

### Card

- `#FFFFFF`
- 卡片主底色

### Text

- `#1A1C1E`
- 正文主文本

### Muted

- `#667085`
- 说明文字、次级标签、辅助信息

### Border

- `#D7DEEA`
- 轻边框、表单边界、低侵入分割

### Semantic

- Success：`#16A34A`
- Danger：`#D92D20`

## Typography

### Chinese-first UI Rule

中文后台必须优先保证：

- 清晰
- 稳定
- 高密度下不发虚
- 中英混排自然

### Preferred UI Stack

中文主界面字体优先：

- `Noto Sans SC`
- `Microsoft YaHei`
- `PingFang SC`
- `sans-serif`

英文和数字可使用：

- `Manrope`
- `Inter`
- `sans-serif`

### Practical Rule

- 中文标签、菜单、表格、状态、过滤器：优先中文字体体系
- 英文内容、数字、标题辅助：可用英文 sans-serif 提升质感
- 不允许整个后台只按英文审美排字

## Radius And Density

- Card radius：`18px`
- Control radius：`12px`
- Pill radius：`999px`

整体应偏：

- 紧凑
- 清楚
- 高信息密度

不要做：

- 大面积空洞留白
- 过于玩具化的大圆角
- 过度动画化的低效率界面

## Shadow

- Ambient shadow：`0 16px 40px rgba(0, 50, 125, 0.08)`

规则：

- 阴影只用于建立层级
- 不用于炫技
- 卡片层级要克制

## Layout Rules

### Global Shell

- 左侧：主导航
- 右侧：工作区
- 顶部：工具条 / 搜索 / 操作者状态 / 通知

### Homepage

首页默认是：

- 任务启动工作台

必须包含：

- 任务创建输入
- 模式选择
- 高级参数
- 成本/预算摘要
- 渠道选择
- 最近任务

### Review Pages

#### Storyboard Review

固定结构：

- 左：Scene 列表
- 中：脚本 / prompt / 时长 / 时间轴
- 右：审阅操作

#### Keyframe Review

固定结构：

- 左：关键帧缩略图
- 中：大预览图
- 右：审阅操作

### Batch Dashboard

必须体现：

- 队列
- 预算池
- worker 状态
- 批次筛选
- 异常与高风险任务

### Asset Center

必须体现：

- 按任务查看资产
- 资产状态
- 文件元数据
- 预览 / 下载

## Component Rules

### Buttons

- 主按钮：品牌蓝渐变，视觉明确
- 次按钮：浅蓝背景，低侵入
- 危险操作：仅在明确风险场景出现

### Pills / Tags

- 适合表达模式、平台、状态、预算等级
- 不要过多颜色导致语义混乱

### Cards

- 卡片是信息组织单元
- 不允许卡片既承担页面身份又承担局部说明，避免双重标题层

### Inputs

- 背景轻浅
- 边框柔和但可见
- 高密度场景下仍要清楚

## Interaction Rules

- 创建任务应尽量减少阻力
- 审阅动作必须明显、低歧义
- 状态更新必须可感知
- 预算 / 风险信息必须及时可见

不要做：

- 把关键操作藏进不必要的二级菜单
- 让审阅页像静态展示页
- 让批量页失去可扫描性

## Canonical Screens

当前 Phase 1 的 canonical baseline screens：

1. `GENERGI 任务启动工作台 (V4)`
2. `分镜审阅工作台`
3. `关键帧审阅工作台`
4. `批量任务看板 (Batch Dashboard)`

这四张是实现基线，不是参考建议。

## Do Not

- 不要做成通用后台模板风
- 不要做成偏中文平台气质的内容产品
- 不要牺牲中文后台可读性去追求英文视觉感
- 不要让路径、状态、预算、审阅动作藏起来

## Future Rule

当 Stitch 的最终设计导出完成后：

- 用 Stitch 导出的版本校对本文件
- 继续保留本文件在仓库根目录
- 后续所有 UI 变更先更新 `DESIGN.md`，再改代码
