# V3.2 视觉母本与智能关键画面系统迭代计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This document is an iteration-level plan and priority map; before coding a selected scope, expand the selected tasks into task-level checklists with concrete tests and commits.

**Goal:** Build a complete visual-director layer so operators can provide a simple visual seed or only raw script, then GENERGI plans, generates, reviews, tracks, and recovers keyframes according to video duration.

**Architecture:** Keep the user input simple while making the backend structured. The task launch page captures an optional visual seed and generation mode; the text model turns script plus seed into a structured Visual Plan; the worker compiles prompts and generates duration-matched keyframes through batch or single-image paths; review, assets, model diagnostics, templates, and permissions read the same state instead of duplicating workflow logic.

**Tech Stack:** React + Vite web console, Hono API, Node.js worker, shared Zod contracts, file-backed task/model persistence, existing model-control routing and diagnostics.

---

## Product Direction

This iteration is not a small `n=4` implementation. It upgrades the production chain from "generate some images from a script" to "turn a user visual seed into an auditable visual storyboard before video generation."

The primary user experience should stay lightweight:

- User enters raw script and optional visual seed in one large input box.
- User chooses batch keyframes or single keyframes.
- The platform automatically derives keyframe count from target duration.
- Text planning produces a Visual Plan before expensive image generation.
- Operators review and adjust the visual plan before generating images.
- Operators review generated keyframes before continuing to video.

Default keyframe mapping:

| Duration | Default Keyframes | Default Mode |
| --- | ---: | --- |
| 15s | 1 | batch or single equivalent |
| 30s | 2 | batch |
| 45s | 3 | batch |
| 60s | 4 | batch |

Default rule:

```ts
keyframeCount = Math.ceil(targetDurationSec / 15)
```

Advanced range can be enabled later in the same iteration:

| Duration | Default | Allowed Range |
| --- | ---: | ---: |
| 15s | 1 | 1-2 |
| 30s | 2 | 2-3 |
| 45s | 3 | 3-4 |
| 60s | 4 | 4-6 |

If batch mode is selected and the selected image model supports only four images per request, larger counts must be split into batches such as `4 + 2`.

---

## Menu Responsibilities

Each menu must participate without stealing another menu's job.

| Menu | Owns | Can Change | Must Not Own |
| --- | --- | --- | --- |
| 任务启动 | visual seed, generation mode, duration-derived keyframe count | collect intent | image approval, downloads, diagnostics |
| 任务审核 | visual plan approval, keyframe approval, regeneration, continue-to-video gate | content decisions | bulk task governance, delivery downloads |
| 生产看板 | stage, progress, stuck tasks, recovery jump points | status recovery | prompt editing, image approval |
| 任务管理 | filtering, bulk cancel/archive/restore/delete | operational governance | content approval |
| 素材与交付 | files, manifests, source trace, downloads | preview/download/troubleshoot | continue-video decisions |
| 模型设置 | provider/model batch capability, defaults, diagnostics | model capability and routing | task-specific content review |
| 项目模板库 | reusable default visual seed and project preference | project-level defaults | single-task review |
| 帮助中心 | SOP and operator education | docs only | production operations |
| 用户中心 | permissions, test accounts | access control | production content operations |

---

## Shared State Model

The iteration should introduce or formalize these data boundaries.

### Task Run Config

Stores user choices frozen at task creation.

```ts
type VisualTaskRunConfig = {
  visualSeedInput?: string | null
  keyframeGenerationMode: "batch" | "single"
  keyframeCount: number
}
```

### Visual Plan

Structured text-model output before image generation.

```ts
type VisualPlan = {
  version: "visual-plan-v1"
  source: "user_visual_seed" | "script_inferred" | "project_default"
  rawVisualSeedInput?: string | null
  durationSec: number
  keyframeCount: number
  generationMode: "batch" | "single"
  visualBrief: {
    subject: string
    setting: string
    style: string
    emotionArc: string
    negativeRules: string[]
    consistency: {
      enabled: boolean
      characterLock: string
      styleLock: string
      environmentLock?: string | null
    }
    confidence?: Record<string, "low" | "medium" | "high">
  }
  narrativeArc: {
    hook: string
    tension: string
    insight: string
    resolution: string
  }
  keyframes: Array<{
    index: number
    timestampRange: string
    role: string
    visualGoal: string
    sceneDescription: string
    composition?: string
    lighting?: string
    negativeRules?: string[]
  }>
  continuityRules: string[]
  riskFlags: Array<{
    severity: "info" | "warning" | "blocking"
    message: string
    resolution?: string
  }>
  reviewStatus: "pending" | "approved" | "rejected"
}
```

### Keyframe Manifest

Generated-image record that review/assets pages can consume.

```ts
type KeyframeManifestV2 = {
  version: "keyframe-manifest-v2"
  generationMode: "batch" | "single" | "mixed"
  promptCompilerVersion: "batch-keyframe-prompt-v1" | "single-keyframe-prompt-v1"
  requestedFrameCount: number
  returnedFrameCount: number
  batchGroups: Array<{
    batchId: string
    requestedCount: number
    returnedCount: number
    elapsedMs: number
    providerId: string
    modelId: string
    providerModelId: string
    promptHash: string
    frameIndexes: number[]
    fallbackUsed: boolean
  }>
  frames: Array<{
    sceneId: string
    sceneIndex: number
    timestampRange: string
    title: string
    visualGoal: string
    promptSummary: string
    fileName: string
    filePath: string
    generationMode: "batch" | "single"
    batchId?: string | null
    batchIndex?: number | null
    modelTrace?: unknown
  }>
  fallbackEvents: Array<{
    at: string
    reason: string
    from: "batch"
    to: "single"
    affectedFrameIndexes: number[]
  }>
}
```

### Diagnostics

Model diagnostics should record image-batch capability without exposing secrets or raw responses.

```ts
type ImageBatchDiagnostic = {
  operation: "image_batch_keyframes"
  requestedCount: number
  returnedCount: number
  elapsedMs: number
  status: "success" | "failed" | "skipped"
  errorCategory?: string | null
}
```

---

## Priority Task List

### P0 - Main Production Chain

These tasks make the feature usable end to end.

1. **Shared Contracts And Persistence**
   - Add visual seed, keyframe mode, keyframe count to task creation/run config.
   - Add Visual Plan persistence.
   - Extend keyframe manifest with batch metadata while keeping old manifests readable.
   - Verification: old tasks still load; 15/30/45/60 map to 1/2/3/4.

2. **Task Launch UX**
   - Add a single optional visual seed textarea with guiding placeholder.
   - Add batch/single generation choice.
   - Display duration-derived keyframe count.
   - Keep page lightweight; do not add image review here.
   - Verification: payload contains visual choices; duration changes update the count label.

3. **Visual Plan Generation**
   - Update planning prompt/contract so text model outputs visualBrief and keyframes.
   - Preserve user visual seed when provided.
   - Infer visual brief from script when visual seed is empty.
   - Sanitize unsafe or too-specific style references into safer descriptive style language.
   - Verification: keyframe count matches duration; visual seed fields survive into plan.

4. **Visual Plan Review In Task Review**
   - Add a visual-plan review stage/section.
   - Show visual brief, continuity rules, risk flags, and keyframe plan.
   - Allow editing keyframe descriptions before image generation.
   - Add approve-to-generate action.
   - Verification: approved visual plan triggers keyframe generation; rejected plan blocks video generation.

5. **Prompt Compiler**
   - Create batch and single prompt compilers.
   - Version compiler outputs.
   - Produce prompt summaries and prompt hashes for tracking.
   - Verification: batch prompt says exactly N images, one per frame, in order, not collage; single prompt inherits visual locks.

6. **Worker Batch And Single Keyframe Generation**
   - Add OpenAI Images `n` support.
   - Parse multiple returned image references.
   - Save images to scene-indexed files.
   - Support model max batch count and split into multiple batches when needed.
   - Verification: mock n=4 returns four files; n=3 of 4 saves three and repairs missing frame.

7. **Fallback And Recovery**
   - Batch HTTP failure falls back to single generation.
   - Partial batch return saves usable frames and single-generates missing frames.
   - Single-frame failure marks only that frame failed.
   - Runtime status and timeline explain fallback.
   - Verification: failed/partial provider mocks do not kill the whole task.

8. **Keyframe Review UX**
   - Show each keyframe with its visual goal, generation mode, model, and batch metadata.
   - Support per-frame approve/reject.
   - Support edit-and-regenerate one frame.
   - Support regenerate entire group and switch generation mode.
   - Verification: review decisions persist and continue-to-video stays blocked until required keyframes are approved.

### P1 - Cross-Menu Integration

These tasks make the feature operationally clean across the platform.

9. **Production Dashboard Integration**
   - Add statuses: visual plan generating, visual plan review, keyframe generating, keyframe partial, keyframe review.
   - Show duration/keyframe count/generation mode on task cards.
   - Show long-running batch generation as expected, not stuck.
   - Verification: dashboard state labels match task stage and runtime progress.

10. **Task Management Integration**
   - Add filters for visual plan review, keyframe review, keyframe failed, batch mode, single mode.
   - Show keyframe count and generation mode in task list.
   - Keep content approval out of task-management bulk actions.
   - Verification: filters return expected tasks and bulk operations do not bypass review.

11. **Assets And Delivery Integration**
   - Separate keyframes from publish files and troubleshooting files.
   - Show source trace: batch id, model, prompt hash, elapsed time, fallback.
   - Support downloading the keyframe group.
   - Provide "go to review" links for approval actions.
   - Verification: assets page shows keyframe provenance without becoming a review page.

12. **Model Settings And Diagnostics**
   - Add batch keyframe capability fields to image models.
   - Show max batch images and latest batch smoke.
   - Add controlled batch smoke action with permission and cost warning.
   - Verification: GPT-image2 displays batch support and smoke result; diagnostics redact secrets.

13. **Project Template Library**
   - Add project default visual seed.
   - Add default generation mode and negative rules.
   - Task launch uses project defaults but lets user override.
   - Verification: selected project preloads visual seed defaults.

14. **Permissions And Audit**
   - Gate prompt viewing, model override, real batch smoke, and out-of-range keyframe count.
   - Record who changed visual plan, regenerated images, switched mode, or approved keyframes.
   - Verification: regular operator cannot run privileged actions; audit records are visible.

15. **Help Center SOP**
   - Add operator guide for visual seed writing.
   - Explain batch vs single.
   - Explain why image count follows duration.
   - Add troubleshooting: model issue vs seed issue vs prompt issue.
   - Verification: help center has direct links from task launch/review/model settings.

### P2 - Polish And Advanced Capability

These tasks make the system more powerful after the main path is stable.

16. **Advanced Keyframe Count Control**
   - Allow controlled count override within duration-based ranges.
   - Split batches automatically above model max.
   - Verification: 60s can use 5-6 frames with 4+1/4+2 batch split.

17. **Visual Consistency Tools**
   - Add visual consistency checklist for reviewers.
   - Add simple consistency notes from the plan and manifest.
   - Later: reference image upload or accepted-frame conditioning.

18. **Cost And Time Forecast**
   - Estimate keyframe generation time and cost before image generation.
   - Show expected 3-5 minute wait for batch n=4.
   - Verification: dashboard and review page set correct expectations.

19. **Visual Template Presets**
   - Add reusable style presets such as modern commercial, soft anime, product close-up, wellness education.
   - Keep presets as optional helpers, not required fields.

20. **End-To-End Visual Regression**
   - Browser smoke for task launch, visual plan review, keyframe review, assets, model diagnostics.
   - Capture desktop/mobile screenshots for key screens.

---

## Recommended Implementation Slices

For a complete feature, run the long task in four slices. They can be developed with parallel workers when write scopes are kept separate.

### Slice A - Contracts, Launch, Visual Plan

Includes P0 tasks 1-4.

Parallel candidates:

- Worker 1: shared contracts and persistence.
- Worker 2: task launch UI and API payload.
- Worker 3: visual plan generation and review API.
- Main agent: integrate state transitions and review.

Exit criteria:

- User can create a task with visual seed and generation mode.
- System produces a visual plan with duration-matched keyframes.
- Task review can approve or reject visual plan.

### Slice B - Prompt Compiler And Image Generation

Includes P0 tasks 5-7.

Parallel candidates:

- Worker 1: prompt compiler tests and implementation.
- Worker 2: OpenAI Images multi-reference parsing.
- Worker 3: worker batch/fallback flow.
- Main agent: manifest integration and runtime status.

Exit criteria:

- Batch mode can generate N keyframes.
- Partial/failed batch falls back safely.
- Manifest records generation mode and batch metadata.

### Slice C - Review, Assets, Dashboard, Task Management

Includes P0 task 8 and P1 tasks 9-11.

Parallel candidates:

- Worker 1: task review UI.
- Worker 2: assets/delivery UI.
- Worker 3: dashboard/task management labels and filters.
- Main agent: shared API shape and browser verification.

Exit criteria:

- Operators can review, regenerate, and approve keyframes.
- Other menus show status/source without duplicating review actions.

### Slice D - Model Settings, Templates, Permissions, SOP

Includes P1 tasks 12-15 and selected P2 tasks.

Parallel candidates:

- Worker 1: model capability and diagnostics UI/API.
- Worker 2: project template defaults.
- Worker 3: permissions/audit/help center.
- Main agent: final integration and deployment checks.

Exit criteria:

- Model settings explain batch support.
- Project defaults can seed visual direction.
- Privileged actions are guarded and audited.
- Help center covers the workflow.

---

## Suggested Scope Options For User Decision

### Option 1 - Complete V3.2 Core

Do P0 + P1 tasks 1-15.

Best when the goal is a polished production feature across all menus. This is my recommendation.

### Option 2 - Production Chain First

Do P0 tasks 1-8, then stop for review.

Best when we want the core workflow working before touching model settings, templates, and help center.

### Option 3 - Full Premium V3.2

Do P0 + P1 + P2 tasks 1-20.

Best when we want the feature to launch as a mature product capability, including advanced count override, cost/time forecast, presets, and visual regression.

---

## Verification Gate

Before any completion claim:

- `pnpm typecheck`
- Relevant unit tests for shared/API/worker/web
- `pnpm build`
- Browser smoke for task launch, task review, dashboard, task management, assets, model settings
- Production-like smoke using test account
- At least these scenarios:
  - 15s batch -> 1 frame
  - 30s batch -> 2 frames
  - 60s batch -> 4 frames
  - 60s single -> 4 independent frames
  - batch partial return -> saved frames plus single repair
  - batch failure -> single fallback
  - old task/manifest still loads

