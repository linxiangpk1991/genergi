# V3.3 中英理解预览与完整视觉生产链升级计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is the iteration master plan; before coding each task, expand the selected task into file-level TDD steps and keep verification evidence in the task note.

**Goal:** 把 GENERGI 从“填写文案后生成关键画面”升级为“用户只写内容母本，系统自动理解、双语确认、英文执行、批量生成、可审核、可追踪、可恢复”的完整视频生产链。

**Architecture:** 任务启动只保留一个主要内容母本输入，AI 文本模型生成中英双语的系统理解预览和英文执行 brief；worker 只使用英文执行 brief 编译图片/视频提示词；任务审核、素材与交付、任务管理、生产看板、模型设置读取同一份冻结任务配置、视觉计划、关键画面 manifest 和模型诊断记录，避免页面各自解释导致冲突。

**Tech Stack:** React + Vite web console, Hono API, Node.js worker, BullMQ, shared Zod contracts, file-backed persistence, existing model-control routing, OpenAI-compatible Images API, Responses API probe path, ffmpeg crop/split, Playwright visual smoke.

---

## 1. 迭代边界

这次升级不是一个最小按钮或单点功能，而是一次完整生产链改造。完成后，用户不需要懂提示词结构，也不需要自己拆分分镜；他只需要写内容母本，系统负责理解、补全、规划关键画面数量、生成英文执行提示词，并把结果在审核和交付环节完整展示出来。

这次不做的事情：

- 不把任务启动页变成复杂提示词编辑器。
- 不要求用户手动填写主角、场景、风格、情绪、禁止项等多个必填字段。
- 不把图片审核放回任务启动页。
- 不让素材与交付页承担审核动作。
- 不把真实 API key、endpoint 或供应商 raw JSON 暴露到前端。

---

## 2. 核心产品原则

### 2.1 用户输入原则

任务启动页只保留一个主输入：

- **内容母本 / Content Brief**：必填。

它可以包含用户原始文案、卖点、目标人群、语气、CTA、视觉偏好、禁止项。输入框 placeholder 用结构化提示引导，但不强迫用户拆成多个字段。

额外选项全部标为可选：

- 视频时长：15s / 30s / 45s / 60s。
- 画面生成方式：批量生成 / 单张生成。
- 是否保持角色一致：默认开启。
- 视觉补充说明：折叠高级项，默认不打扰。
- 模型覆盖：仅管理员/高级运营可见。

### 2.2 中英双语原则

客户可见层是双语：

- 中文用于内部运营快速理解。
- 英文用于面向海外内容和客户校对。

执行层只用英文：

- 图片提示词必须英文。
- 视频提示词必须英文。
- TTS/字幕脚本以英文为主。
- worker 不读取中文字段生成媒体，避免中英文混用导致模型输出不稳定。

### 2.3 时长与关键画面原则

默认关键画面数量由视频时长决定：

| 视频时长 | 默认关键画面 | GPT-image2 默认策略 |
| --- | ---: | --- |
| 15s | 1 张 | 单图或 1 panel |
| 30s | 2 张 | 2 panel 或两张单图 |
| 45s | 3 张 | 3x1 多宫格后裁切，不浪费第 4 格 |
| 60s | 4 张 | 2x2 多宫格后裁切 |

默认规则：

```ts
keyframeCount = Math.ceil(targetDurationSec / 15)
```

高级覆盖可以后续开放，但必须有权限、原因和审计。

---

## 3. 目标用户流程

### 3.1 任务启动

1. 用户选择项目、终端规格、视频时长。
2. 用户在一个大输入框里填写内容母本。
3. 用户可选填写视觉补充说明，也可以完全留空。
4. 用户点击 **AI 理解母本**。
5. 系统用文本模型生成中英双语理解预览。
6. 用户确认或编辑预览。
7. 系统展示本次生成计划：时长、关键画面数量、批量/单张、预计耗时、预计成本范围、使用模型。
8. 用户点击启动任务。

### 3.2 任务审核

1. 审核页先展示系统理解预览和英文执行 brief。
2. 展示视觉计划：主角、场景、风格、情绪、连续性规则、禁止项、关键画面规划。
3. 展示关键画面生成结果和对应英文提示词摘要。
4. 每张关键画面显示模型追踪、生成方式、批次/宫格信息、耗时、fallback。
5. 运营可以批准、驳回、重生单张、重生整组。
6. 全部必要项通过后才允许继续生成正片。

### 3.3 素材与交付

1. 素材页显示最终成片、字幕、音频、关键画面、视觉计划、提示词摘要、模型追踪。
2. 关键画面区显示来源：GPT-image2 多宫格裁切 / API 多图 / 单张生成 / fallback。
3. 下载和预览留在素材页；审批动作跳转回审核页。

---

## 4. 数据模型升级

### 4.1 TaskRunConfig

冻结用户输入和启动时系统选择，保证历史任务可追溯。

```ts
type TaskRunConfigV33 = {
  sourceBrief: string
  visualSeedInput?: string | null
  keepCharacterConsistent: boolean
  targetDurationSec: 15 | 30 | 45 | 60
  keyframeCount: number
  keyframeGenerationMode: "batch" | "single"
  understandingPreview?: BilingualUnderstandingPreview | null
  executionBrief?: EnglishExecutionBrief | null
  executionBriefVersion: "execution-brief-v1"
}
```

### 4.2 BilingualUnderstandingPreview

客户和运营看的结构化预览，每个字段都有中英双语。

```ts
type BilingualText = {
  zh: string
  en: string
}

type BilingualUnderstandingPreview = {
  version: "understanding-preview-v1"
  generatedAt: string
  sourceBriefHash: string
  topic: BilingualText
  targetAudience: BilingualText
  corePainPoint: BilingualText
  mainPromise: BilingualText
  conversionGoal: BilingualText
  emotionalArc: BilingualText
  recommendedStructure: BilingualText
  visualBrief: {
    subject: BilingualText
    setting: BilingualText
    style: BilingualText
    mood: BilingualText
    negativeRules: BilingualText[]
    consistencyRules: BilingualText[]
  }
  riskWarnings: Array<{
    severity: "info" | "warning" | "blocking"
    message: BilingualText
    suggestedFix?: BilingualText
  }>
  status: "draft" | "confirmed" | "edited"
}
```

### 4.3 EnglishExecutionBrief

worker 和下游模型唯一使用的执行层。

```ts
type EnglishExecutionBrief = {
  version: "execution-brief-v1"
  sourceBrief: string
  topic: string
  targetAudience: string
  corePainPoint: string
  mainPromise: string
  conversionGoal: string
  emotionalArc: string
  visualBrief: {
    subject: string
    setting: string
    style: string
    mood: string
    negativeRules: string[]
    consistencyRules: string[]
  }
  narrativeStructure: string[]
  keyframePlan: Array<{
    index: number
    timestampRange: string
    narrativeRole: string
    visualGoal: string
    imagePrompt: string
    videoPrompt: string
  }>
  finalPromptLanguage: "en"
}
```

### 4.4 KeyframeManifestV3

在现有 V2 manifest 基础上补全多宫格裁切和真实模型能力追踪。

```ts
type KeyframeManifestV3 = {
  version: "keyframe-manifest-v3"
  requestedFrameCount: number
  returnedFrameCount: number
  keyframeGenerationMode: "batch" | "single" | "mixed"
  returnMode: "api_multi_image" | "composite_grid" | "single_image" | "fallback"
  promptCompilerVersion: "visual-execution-prompt-v1"
  batchGroups: Array<{
    batchId: string
    providerId: string
    modelId: string
    providerModelId: string
    wireApi: "images.generations" | "responses"
    requestPath: string
    requestedCount: number
    returnedCount: number
    compositeLayout?: "1x1" | "2x1" | "3x1" | "2x2" | "3x2" | "3x3"
    compositeSize?: string
    panelSize?: string
    elapsedMs: number
    promptHash: string
    fallbackUsed: boolean
    errorCategory?: string | null
  }>
  frames: Array<{
    sceneId: string
    sceneIndex: number
    timestampRange: string
    visualGoal: string
    promptSummary: string
    fileName: string
    filePath: string
    generationMode: "batch" | "single"
    batchId?: string | null
    modelTrace: {
      label: string
      providerId: string
      modelId: string
      providerModelId: string
      wireApi: string
      requestPath: string
    }
  }>
}
```

---

## 5. 菜单职责与冲突规避

| 菜单 | 本轮新增 | 明确不做 |
| --- | --- | --- |
| 任务启动 | 内容母本、AI 理解母本、中英预览、英文执行 brief、生成计划确认 | 不做关键画面审批 |
| 任务审核 | 理解预览复核、视觉计划审批、关键画面审批、重生动作 | 不做批量下载和资产治理 |
| 生产看板 | 阶段、进度、异常、耗时、跳转到审核/素材 | 不编辑提示词 |
| 任务管理 | 批量治理、过滤、模型摘要、任务状态 | 不绕过审核继续生成 |
| 素材与交付 | 预览、下载、模型追踪、提示词摘要、来源诊断 | 不承担审批决策 |
| 模型设置 | 能力声明、真实 smoke、协议、尺寸、质量、错误分类 | 不编辑任务内容 |
| 项目模板库 | 项目默认母本提示、视觉偏好、禁止项、默认生成策略 | 不写单次任务结果 |
| 用户中心 | 测试账号、权限、覆盖模型权限 | 不配置模型能力 |
| 帮助中心 | SOP、异常解释、操作指南 | 不做生产操作 |

---

## 6. 模型能力策略

### 6.1 GPT-image2

当前生产探测结论要固化进模型能力配置：

- 协议：OpenAI-compatible `/v1/images/generations`。
- 适合策略：多宫格母图 + ffmpeg 裁切。
- 45s：生成 3x1，裁成 3 张。
- 60s：生成 2x2，裁成 4 张。
- 4096x4096 不作为默认，因为生产探测有失败风险。
- 推荐默认尺寸：
  - 3x1: `3072x2048`
  - 2x2: `2048x3072`

### 6.2 GPT-5.5 Responses

保留为能力探测和备用路径：

- 协议：`/v1/responses`。
- 能真实返回多张独立图片。
- 成本和耗时较高，不作为默认批量关键画面路径。
- 可在模型诊断页显示为“可用但慢”的高质量备用选项。

### 6.3 模型诊断

必须记录并展示：

- 请求协议。
- request path。
- provider/model/providerModelId。
- 请求尺寸。
- 请求数量。
- 返回数量。
- 耗时。
- 错误分类。
- 最近成功时间。
- 是否真实生成图片。
- 是否只做鉴权/路由检查。

错误分类统一为：

- `auth_error`
- `quota_error`
- `model_not_found`
- `request_schema_error`
- `timeout`
- `empty_response`
- `safety_rejected`
- `upstream_error`
- `local_processing_failed`

---

## 7. 优先级任务清单

### P0 - 必须一次性完成

1. **统一母本输入与 AI 理解预览**
   - 任务启动页移除容易冲突的双输入心智。
   - 内容母本为唯一必填。
   - 视觉说明为可选高级项。
   - 新增“AI 理解母本”动作。
   - 输出中英双语理解预览和英文执行 brief。
   - 未确认理解预览时，不允许提交正式生产任务，除非管理员显式跳过并记录原因。

2. **英文执行链闭环**
   - worker 只读取 `executionBrief` 和英文 `imagePrompt`/`videoPrompt`。
   - planning prompt 明确要求最终给图片/视频模型的字段必须英文。
   - 任务审核显示中文解释和英文执行内容，但执行以英文为准。

3. **关键画面数量与生成策略固化**
   - 15/30/45/60 自动映射 1/2/3/4。
   - GPT-image2 默认走 `composite_grid`。
   - 45s 使用 3x1，不浪费第四格。
   - 60s 使用 2x2。
   - 单张模式保持可选并可用于重生。

4. **提示词编译器升级**
   - 从 `EnglishExecutionBrief` 编译 batch prompt 和 single prompt。
   - prompt 要明确：
     - exact panel count。
     - panel order。
     - 每格独立可裁切。
     - same subject, outfit, style, lighting logic。
     - no text, captions, UI, watermark。
   - 保存 prompt hash 和摘要。

5. **任务审核完整展示**
   - 展示中英理解预览。
   - 展示英文执行 brief。
   - 展示视觉计划。
   - 展示每张关键画面、提示词摘要、模型追踪、批次信息。
   - 支持重生单张、重生整组、切换单张重生。

6. **素材与交付完整追踪**
   - 关键画面、母图、裁切后图片、提示词摘要、视觉计划、规划 raw response 全部作为资产可见。
   - 对普通运营隐藏敏感 raw 内容，只显示脱敏摘要。
   - 每个素材显示阶段、模型、协议、request path、耗时。

7. **模型配置检查修复与真实 smoke**
   - 修复历史遗留的 provider 校验逻辑，避免 TTS 规则误套到非 TTS provider。
   - 文本模型做极短结构化 smoke。
   - 图片模型支持鉴权/路由检查和真实低成本 smoke。
   - GPT-image2 smoke 记录尺寸、数量、返回模式。
   - 配音模型验证命令或生成 1 秒音频。

8. **日志、错误分类、诊断面板**
   - 所有模型调用写入诊断记录。
   - 任务失败原因带模型路由信息。
   - 模型设置页能看最近调用、最近成功、失败分类。
   - 敏感字段脱敏。

9. **权限与审计**
   - 模型覆盖、真实 smoke、跳过理解预览、查看完整 prompt 需要权限。
   - 覆盖模型必须填写原因。
   - 审计记录：谁、何时、改了什么、为什么。

10. **生产测试账号与部署回归**
    - 支持临时测试运营账号。
    - 自动过期或一键禁用。
    - 部署后可用浏览器登录跑主链路。
    - 部署验证必须覆盖任务启动、任务审核、素材与交付、模型设置。

### P1 - 同轮完成，避免功能债

11. **生产看板状态升级**
    - 增加状态：理解预览中、视觉计划中、关键画面生成中、关键画面待审核、关键画面部分失败。
    - 长耗时图片生成要显示为正常等待，不误判卡死。

12. **任务管理列表升级**
    - 显示关键画面数量、生成方式、文本/图片/视频/TTS 模型。
    - 增加过滤：待理解确认、待关键画面审核、图片失败、批量模式、单张模式。

13. **项目模板库升级**
    - 项目可配置默认母本引导、默认视觉偏好、默认禁止项、默认生成模式。
    - 任务启动选择项目后自动注入 placeholder/默认值，但不覆盖用户已写内容。

14. **帮助中心 SOP**
    - 新增“如何写内容母本”。
    - 新增“为什么系统会生成中英理解预览”。
    - 新增“批量生成和单张生成怎么选”。
    - 新增“模型检查失败怎么看”。

15. **成本与耗时预估**
    - 启动前显示预计关键画面数量、图片请求数、可能耗时。
    - GPT-image2 多宫格提示预计 1-5 分钟区间。

### P2 - 完整体验增强，可同轮收尾

16. **理解预览编辑体验**
    - 中文编辑后可一键重新生成英文执行层。
    - 英文编辑时提示“英文为执行准则”。
    - 风险项有“采用建议修复”按钮。

17. **视觉质量检查**
    - 审核页增加一致性检查项：
      - 主角一致。
      - 风格一致。
      - 构图可裁切。
      - 无字幕/水印/乱码文字。
      - 情绪符合脚本。

18. **模型能力矩阵**
    - 图片模型显示：
      - 是否支持 API 多图。
      - 是否支持多宫格。
      - 推荐尺寸。
      - 最高已测尺寸。
      - 最近 smoke 结果。

19. **自动化视觉回归**
    - Playwright 截图：
      - 登录页。
      - 任务启动页。
      - 理解预览卡片。
      - 任务审核页。
      - 素材与交付页。
      - 模型设置页。
    - 校验 logo/favicon、关键按钮、关键文案、图片预览不为空。

20. **低成本端到端测试任务**
    - 测试项目。
    - 60s 内容母本。
    - AI 理解预览。
    - 4 张关键画面。
    - 审核通过。
    - mock 或低成本视频阶段。
    - 交付页可见完整素材和模型追踪。

---

## 8. 推荐实施切片

### Slice A - 共享契约、AI 理解预览、任务启动

**目标：** 用户只写内容母本，系统生成中英理解预览和英文执行 brief。

**主要文件：**

- `packages/shared/src/index.ts`
- `packages/shared/src/task-persistence.ts`
- `packages/shared/src/planning-contract.ts`
- `apps/api/src/index.ts`
- `apps/web/src/api.ts`
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/pages/homePageLaunchGuards.ts`
- `tests/unit/api/task-create-queue.test.ts`
- `tests/unit/web/home-page-launch-guards.test.ts`
- `tests/unit/web/home-page-project-and-render-spec.test.ts`

**验收：**

- 内容母本是唯一必填文案输入。
- 视觉补充是清楚标注的可选项。
- `AI 理解母本` 返回中英预览。
- 提交任务 payload 包含 `understandingPreview` 和 `executionBrief`。
- 旧草稿和旧任务兼容。

### Slice B - Worker 英文执行与提示词编译器

**目标：** 下游图片/视频模型只吃英文执行内容。

**主要文件：**

- `apps/worker/src/lib/providers.ts`
- `packages/shared/src/storyboard-planner.ts`
- `packages/shared/src/video-blueprint.ts`
- `tests/unit/worker/providers.test.ts`
- `tests/unit/worker/planning-prompt.test.ts`
- `tests/unit/shared/storyboard-planner.test.ts`

**验收：**

- planning raw response 可双语，但 `imagePrompt`/`videoPrompt` 必须英文。
- GPT-image2 多宫格 prompt 来自 `executionBrief`。
- 45s 生成 3 个 panel，60s 生成 4 个 panel。
- manifest 记录 `returnMode`、layout、panelSize、modelTrace。

### Slice C - 审核、素材、任务管理、生产看板

**目标：** 所有运营页面读同一份任务状态和模型追踪。

**主要文件：**

- `apps/web/src/pages/TaskReviewPage.tsx`
- `apps/web/src/pages/AssetsPage.tsx`
- `apps/web/src/pages/TaskManagementPage.tsx`
- `apps/web/src/pages/BatchDashboardPage.tsx`
- `apps/web/src/components/ModelUsageSummary.tsx`
- `apps/api/src/lib/task-store.ts`
- `tests/unit/web/task-review-page.test.ts`
- `tests/unit/web/assets-page-preview.test.ts`
- `tests/unit/web/task-management-page.test.ts`
- `tests/unit/api/task-list-model-usage.test.ts`

**验收：**

- 任务审核显示中英理解、英文执行、关键画面和模型追踪。
- 素材页显示关键画面来源和下载/预览。
- 任务管理显示本任务冻结模型和关键画面模式。
- 生产看板不会把长耗时图片生成误报为卡死。

### Slice D - 模型设置、诊断、权限、测试账号

**目标：** 修复历史模型配置检查问题，并让生产问题可判断、可追责、可恢复。

**主要文件：**

- `packages/shared/src/model-control.ts`
- `apps/api/src/lib/model-control/validation.ts`
- `apps/api/src/lib/model-control/registry-store.ts`
- `apps/web/src/pages/ModelProvidersPage.tsx`
- `apps/web/src/pages/ModelDiagnosticsPage.tsx`
- `apps/web/src/features/model-control/toolkit.tsx`
- `apps/api/src/lib/user-store.ts`
- `apps/web/src/pages/UserCenterPage.tsx`
- `tests/unit/api/model-control-validation.test.ts`
- `tests/unit/api/model-control-registry.test.ts`
- `tests/unit/web/model-providers-page.test.ts`

**验收：**

- 非 TTS provider 不再报 `endpointUrl is required for non-TTS providers` 这类错配校验。
- 文本/图片/视频/TTS smoke 按槽位执行。
- GPT-image2 能显示真实能力：多宫格、尺寸、最近 smoke。
- 测试账号可创建、过期、禁用。

### Slice E - 帮助中心、模板、自动化回归、生产部署

**目标：** 把升级变成可用的产品能力，而不是只靠开发记忆操作。

**主要文件：**

- `apps/web/src/help-center/content/workflows.ts`
- `apps/web/src/help-center/content/features.ts`
- `apps/web/src/help-center/content/releases.ts`
- `apps/web/src/pages/ProjectLibraryPage.tsx`
- `tests/unit/web/project-library-page.test.ts`
- `tests/e2e/production-smoke.spec.ts` or `tmp/production-smoke/*.mjs`
- `scripts/deploy/deploy-production.mjs`

**验收：**

- 帮助中心解释完整 SOP。
- 项目模板可带默认视觉偏好。
- 部署后真实站点 health 正常。
- `genergi-api` / `genergi-worker` active。
- 生产浏览器验证任务启动、审核、素材、模型设置。

---

## 9. 测试矩阵

### 单元测试

- Shared schema：旧任务兼容、新字段默认值、英文执行 brief 校验。
- API：理解预览接口、创建任务、权限、模型 smoke、诊断记录。
- Worker：规划 prompt、GPT-image2 多宫格、45s/60s 裁切、fallback。
- Web：任务启动、审核页、素材页、模型设置、任务管理。

### 集成测试

- 任务创建 -> 理解预览 -> 审核 -> 关键画面 -> 素材登记。
- GPT-image2 mock 多宫格 -> 裁切 -> manifest -> 前端展示。
- 图片失败 -> 单张 fallback -> timeline 和诊断记录。

### 生产 smoke

- `https://ai.genergius.com/api/health` release 正常。
- `genergi-api` active。
- `genergi-worker` active。
- 首页资源加载最新 hash。
- 登录生产测试账号。
- 新建 60s 测试任务。
- 任务启动显示 4 张关键画面计划。
- 任务审核显示 4 张关键画面和 GPT-image2 模型追踪。
- 素材与交付显示 4 张关键画面、prompt 摘要、模型追踪。
- 模型设置页 GPT-image2 显示最近 smoke 和能力矩阵。

---

## 10. 上线策略

1. 本地完成单元测试、typecheck、worker build。
2. 本地或 staging 跑 mock E2E。
3. 部署生产 release。
4. 检查 release/current symlink。
5. 检查 health endpoint。
6. 检查 systemd 服务。
7. 用生产测试账号做真实浏览器回归。
8. 用 GPT-image2 跑一个低成本 45s 或 60s 关键画面 smoke。
9. 若图片真实生成失败，先分类：provider、模型能力、尺寸、裁切、前端展示、资产登记。
10. 修复后重新部署并重复 smoke。

---

## 11. 完成定义

本轮不能只以“代码能跑”为完成标准。必须同时满足：

- 用户只写内容母本即可启动完整流程。
- 系统理解预览是中英双语。
- 下游执行提示词是英文。
- 15/30/45/60 自动匹配 1/2/3/4 张关键画面。
- GPT-image2 默认多宫格并能裁切出独立关键画面。
- 任务审核能看懂每张图为什么生成、由哪个模型生成。
- 素材与交付能追溯每个素材来源。
- 模型设置能真实检查并分类错误。
- 普通运营不会误操作模型覆盖或昂贵 smoke。
- 生产站点实际验证通过。

---

## 12. 推荐执行顺序

先做 P0 的 1-10，并按 Slice A -> B -> C -> D -> E 顺序推进。P1 的 11-15 应在同轮收尾完成，因为它们是避免跨页面割裂的必要补强。P2 的 16-20 可以作为同一轮的 polish 收尾，但不得阻塞 P0/P1 上线。

如果要并行开发，建议分配如下：

- Worker 1：shared/API/AI 理解预览。
- Worker 2：worker prompt compiler / GPT-image2 多宫格 / manifest。
- Worker 3：web 任务启动 / 审核 / 素材交付。
- Worker 4：模型设置 / 诊断 / 权限 / 测试账号。
- Main agent：集成、冲突处理、测试矩阵、部署、生产实测。

并行原则：

- 不同 worker 写入范围必须提前锁定。
- shared contract 改动先合入，再让 web/api/worker 对齐。
- 任何页面不得创建自己的二次状态模型。
- 所有页面都以 `TaskRunConfig + UnderstandingPreview + ExecutionBrief + VisualPlan + KeyframeManifest + ModelTrace` 为唯一数据源。
