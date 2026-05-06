# GENERGI TTS 与字幕升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 GENERGI 当前视频生产链补齐可演进的 TTS / 字幕升级路径，先把字幕链从 TTS 解耦并引入 `whisper.cpp` 作为适合现有 CPU 服务器的字幕方案，再为后续接入 `HeadTTS` 预留稳定接口。

**Architecture:** 保留现有 `Edge TTS -> 音频 -> SRT/ASS -> ffmpeg 烧录` 主链作为默认稳定路径，同时把“旁白生成”和“字幕生成”拆成两个独立步骤。字幕层新增 provider/strategy 抽象，第一阶段只加 `whisper.cpp`，第二阶段再接 `HeadTTS` 作为英语高质量实验线。所有选择继续冻结到任务运行配置中，避免历史任务漂移。

**Tech Stack:** Node.js worker、Hono API、BullMQ、ffmpeg、Edge TTS、whisper.cpp、Vitest、文件持久化

---

## 文件结构与职责

### 现有核心文件

- `apps/worker/src/lib/providers.ts`
  现有 worker 编排核心。负责旁白生成、视频生成、关键画面生成、最终合成。后续需要拆出“字幕生成策略选择”和“旁白 provider 选择”。

- `apps/worker/src/lib/edge-tts.ts`
  现有默认 TTS provider。当前兼顾音频与 SRT 生成。

- `apps/worker/src/lib/ffmpeg.ts`
  现有 ffmpeg 工具层。负责 ASS 烧录、音频混音、最终成片。

- `apps/worker/src/index.ts`
  worker 主流程入口。后续需要把“旁白生成”和“字幕生成”从单一步骤拆开。

- `packages/shared/src/index.ts`
  共享 schema。后续要新增 `subtitleStrategy`，并继续冻结到任务配置。

- `packages/shared/src/task-persistence.ts`
  任务 summary/detail 持久化，后续要兼容新的 `subtitleStrategy` 字段。

- `apps/web/src/api.ts`
  前端 API 类型定义。后续要暴露 `subtitleStrategy`。

- `apps/web/src/pages/HomePage.tsx`
  任务创建页。后续若要让运营选择字幕策略，需要在这里接入；如果先不暴露，可以只保留默认值。

### 建议新增文件

- `apps/worker/src/lib/subtitle-provider.ts`
  新增字幕 provider 统一入口。负责根据 `subtitleStrategy` 选择实际实现。

- `apps/worker/src/lib/whisper-cpp.ts`
  新增 `whisper.cpp` 调用封装。负责本地 CLI 调用、SRT 输出和错误封装。

- `tests/unit/worker/subtitle-provider.test.ts`
  新增字幕 provider 单测。

- `tests/unit/worker/whisper-cpp.test.ts`
  新增 `whisper.cpp` 适配层单测。

## 分阶段实施策略

### 第一阶段：字幕链解耦并接入 whisper.cpp

目标：
- 默认仍然使用 `Edge TTS`
- 字幕不再和 TTS 强绑定
- 新增 `subtitleStrategy`
- 默认字幕策略切到 `whisper_cpp`

理由：
- 这一步对当前 4C/8G/无 GPU 服务器最友好
- 风险最小
- 后续换 TTS 时不需要重做字幕层

### 第二阶段：接入 HeadTTS 作为英语高质量实验线

目标：
- 保留 `edge-tts` 生产默认
- 增加 `headtts` provider 作为可选英语高质量旁白方案
- 保证它仍然能输出现有链路需要的旁白契约

理由：
- 不破坏现有生产链
- 给英语质量升级留接口

### 第三阶段：字幕时间轴精修

目标：
- 若 `whisper.cpp` 默认精度不够，再评估引入：
  - `stable-ts`
  - 或其他精修层

理由：
- 先把可用性做起来
- 不在第一阶段把复杂度拉高

## Task 1: 引入 subtitleStrategy 并冻结到任务配置

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/task-persistence.ts`
- Modify: `apps/api/src/lib/task-store.ts`
- Test: `tests/unit/api/task-store.test.ts`

- [ ] **Step 1: 写失败测试，证明 subtitleStrategy 会冻结到任务**

在 `tests/unit/api/task-store.test.ts` 增加断言：
- 创建任务后 `TaskSummary.subtitleStrategy` 正确
- `TaskDetail.taskRunConfig.subtitleStrategy` 正确

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
pnpm vitest run tests/unit/api/task-store.test.ts -t "freezes subtitle strategy at task creation" --maxWorkers 1
```

Expected:
- FAIL，提示 `subtitleStrategy` 缺失或不匹配

- [ ] **Step 3: 最小实现 shared schema**

在 `packages/shared/src/index.ts`：
- 新增 `subtitleStrategySchema`
- 建议第一阶段只支持：
  - `tts_aligned`
  - `whisper_cpp`
- 接入：
  - `taskRunConfigSchema`
  - `taskSummarySchema`
  - `createTaskInputSchema`

- [ ] **Step 4: 最小实现持久化与任务创建**

在 `packages/shared/src/task-persistence.ts`：
- summary/detail normalize 兼容 `subtitleStrategy`

在 `apps/api/src/lib/task-store.ts`：
- 创建任务时写入 `subtitleStrategy`
- 第一阶段默认值建议：
  - `whisper_cpp`

- [ ] **Step 5: 重新运行测试确认通过**

Run:
```bash
pnpm vitest run tests/unit/api/task-store.test.ts -t "freezes subtitle strategy at task creation" --maxWorkers 1
```

Expected:
- PASS

## Task 2: 把旁白生成与字幕生成从 worker 主流程中拆开

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/lib/providers.ts`
- Test: `tests/unit/worker/providers.test.ts`

- [ ] **Step 1: 写失败测试，锁定“字幕不再由 TTS 独占生成”**

在 `tests/unit/worker/providers.test.ts` 增加回归测试，目标：
- worker 可以在 narration 之后，独立调用 subtitle provider
- 最终 `buildFinalVideoWithNarration()` 仍然拿到 `subtitlesPath`

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
pnpm vitest run tests/unit/worker/providers.test.ts -t "generates subtitles through a separate subtitle strategy step" --maxWorkers 1
```

Expected:
- FAIL，说明当前 worker 仍然把字幕写死在 TTS 里

- [ ] **Step 3: 重构 providers.ts 最小边界**

目标：
- 保留 `synthesizeNarration(detail)` 负责音频
- 新增 `generateSubtitles(...)` 或等价函数负责字幕

注意：
- 不要在这一轮顺手重构其他媒体链
- 不要改图片、视频生成逻辑

- [ ] **Step 4: 在 worker 主流程接上新字幕步骤**

在 `apps/worker/src/index.ts`：
- narration 生成后
- 再独立调用字幕生成
- 仍把 `subtitlesPath` 传给最终 ffmpeg 合成

- [ ] **Step 5: 重新运行测试确认通过**

Run:
```bash
pnpm vitest run tests/unit/worker/providers.test.ts -t "generates subtitles through a separate subtitle strategy step" --maxWorkers 1
```

Expected:
- PASS

## Task 3: 接入 whisper.cpp 字幕 provider

**Files:**
- Create: `apps/worker/src/lib/subtitle-provider.ts`
- Create: `apps/worker/src/lib/whisper-cpp.ts`
- Test: `tests/unit/worker/subtitle-provider.test.ts`
- Test: `tests/unit/worker/whisper-cpp.test.ts`

- [ ] **Step 1: 写失败测试，锁定 whisper.cpp 调用契约**

测试目标：
- 输入：音频文件路径
- 输出：SRT 文件路径
- 错误时抛出清晰异常

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
pnpm vitest run tests/unit/worker/subtitle-provider.test.ts tests/unit/worker/whisper-cpp.test.ts --maxWorkers 1
```

Expected:
- FAIL，文件或导出函数不存在

- [ ] **Step 3: 最小实现 whisper-cpp 封装**

`apps/worker/src/lib/whisper-cpp.ts` 职责：
- 构造 CLI 参数
- 调用本地 `whisper.cpp`
- 输出 `SRT`
- 返回路径

建议第一阶段只做：
- 英语模型
- 本地文件输入输出
- 不做额外的精修

- [ ] **Step 4: 最小实现 subtitle provider 路由**

`apps/worker/src/lib/subtitle-provider.ts` 职责：
- 读 `detail.taskRunConfig.subtitleStrategy`
- 选择：
  - `tts_aligned`
  - `whisper_cpp`

- [ ] **Step 5: 重新运行测试确认通过**

Run:
```bash
pnpm vitest run tests/unit/worker/subtitle-provider.test.ts tests/unit/worker/whisper-cpp.test.ts --maxWorkers 1
```

Expected:
- PASS

## Task 4: 保留 tts_aligned 作为回退链

**Files:**
- Modify: `apps/worker/src/lib/providers.ts`
- Modify: `apps/worker/src/lib/edge-tts.ts`
- Test: `tests/unit/worker/providers.test.ts`

- [ ] **Step 1: 写失败测试，锁定 tts_aligned 回退仍可用**

目标：
- 当 `subtitleStrategy = tts_aligned`
- 仍然使用当前 TTS 词级时间轴产出 SRT

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
pnpm vitest run tests/unit/worker/providers.test.ts -t "keeps tts-aligned subtitles available as a fallback strategy" --maxWorkers 1
```

Expected:
- FAIL

- [ ] **Step 3: 最小实现回退兼容**

不要删掉当前 Edge TTS 的时间轴能力。  
保留它作为：
- 低风险回退链
- 无 `whisper.cpp` 环境时的保底

- [ ] **Step 4: 重新运行测试确认通过**

Run:
```bash
pnpm vitest run tests/unit/worker/providers.test.ts -t "keeps tts-aligned subtitles available as a fallback strategy" --maxWorkers 1
```

Expected:
- PASS

## Task 5: 接入 HeadTTS 作为实验性 TTS provider

**Files:**
- Modify: `apps/worker/src/lib/providers.ts`
- Create: `apps/worker/src/lib/headtts.ts`
- Modify: `apps/api/src/index.ts`
- Test: `tests/unit/worker/providers.test.ts`

- [ ] **Step 1: 写失败测试，锁定 providers.ts 可识别 HeadTTS**

目标：
- `ttsProvider = headtts`
- narration 生成链能成功分流
- 仍满足后续 ffmpeg 合成所需的最小契约

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
pnpm vitest run tests/unit/worker/providers.test.ts -t "supports HeadTTS as an alternate narration provider" --maxWorkers 1
```

Expected:
- FAIL

- [ ] **Step 3: 最小实现 headtts adapter**

建议只做：
- 英语语音
- 本地服务/CLI 包装
- 输出：
  - audio file
  - duration
  - 若可行再输出时间戳

- [ ] **Step 4: 保持 API registry 兼容**

如果系统已经支持 provider registry，则让：
- `headtts`
进入现有 provider 类型/配置体系

- [ ] **Step 5: 重新运行测试确认通过**

Run:
```bash
pnpm vitest run tests/unit/worker/providers.test.ts -t "supports HeadTTS as an alternate narration provider" --maxWorkers 1
```

Expected:
- PASS

## Task 6: 字幕排版与 ffmpeg 回归

**Files:**
- Modify: `apps/worker/src/lib/ffmpeg.ts`
- Test: `tests/unit/worker/ffmpeg.test.ts`

- [ ] **Step 1: 写失败测试，锁定 whisper.cpp 产出的长句字幕不会炸屏**

目标：
- 英文长句进入 `ASS` 前会被平衡成两行
- 字号、边距、WrapStyle 保持当前你们已经修好的安全值

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
pnpm vitest run tests/unit/worker/ffmpeg.test.ts --maxWorkers 1
```

Expected:
- 至少一个字幕样式/断行用例 FAIL

- [ ] **Step 3: 最小实现样式与排版修正**

保持：
- `SRT -> ASS -> ffmpeg`

不要引入新的渲染层，只增强：
- 字号
- WrapStyle
- 长句断行

- [ ] **Step 4: 重新运行测试确认通过**

Run:
```bash
pnpm vitest run tests/unit/worker/ffmpeg.test.ts --maxWorkers 1
```

Expected:
- PASS

## Task 7: 文档与运行说明

**Files:**
- Modify: `docs/handover/项目完整说明.md`
- Modify: `docs/handover/模型控制面使用说明.md`
- Add: `docs/handover/2026-04-22-TTS与字幕升级说明.md`

- [ ] **Step 1: 补充 handover 文档**

记录：
- 当前默认方案
- `subtitleStrategy`
- `whisper.cpp` 依赖
- `HeadTTS` 是实验线，不是默认生产线

- [ ] **Step 2: 写运行与回退说明**

至少说明：
- 没有 `whisper.cpp` 时如何回退到 `tts_aligned`
- 什么时候建议用 `HeadTTS`

- [ ] **Step 3: 验证文档提到的命令与路径真实存在**

Run:
```bash
rg -n "subtitleStrategy|whisper.cpp|HeadTTS" docs apps packages
```

Expected:
- 所有文档引用路径和字段都存在

## 最终验收

- [ ] **Step 1: 跑 worker 核心回归**

Run:
```bash
pnpm vitest run tests/unit/worker/providers.test.ts tests/unit/worker/ffmpeg.test.ts tests/unit/worker/subtitle-provider.test.ts tests/unit/worker/whisper-cpp.test.ts --maxWorkers 1
```

Expected:
- PASS

- [ ] **Step 2: 跑 API / shared / web 验证**

Run:
```bash
pnpm --filter @genergi/shared build
pnpm --filter @genergi/config build
pnpm --filter @genergi/api typecheck
pnpm --filter @genergi/worker typecheck
pnpm --filter @genergi/web build
```

Expected:
- 全部 PASS

- [ ] **Step 3: 真实任务验收**

至少验收三条：

1. `Edge TTS + tts_aligned`
2. `Edge TTS + whisper_cpp`
3. `HeadTTS + whisper_cpp`

检查点：
- 音频生成成功
- 字幕生成成功
- 资产中心能看到音频与字幕
- 长英文字幕不炸屏
- 失败任务仍可恢复

## 当前建议执行顺序

最推荐按这个顺序做：

1. `subtitleStrategy` 冻结
2. 字幕链从 TTS 解耦
3. 接入 `whisper.cpp`
4. 保留 `tts_aligned` 回退
5. 最后再接 `HeadTTS`

这样能保证每一步都能独立上线、独立回退，不会把现有生产链一次性推翻。
