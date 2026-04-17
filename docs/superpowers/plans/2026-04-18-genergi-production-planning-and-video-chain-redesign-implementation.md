# GENERGI Production Planning And Video Chain Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current partial script/video chain with a production-grade end-to-end planning workflow where system route selection, text planning, worker execution, review surfaces, and asset outputs all follow one consistent source of truth.

**Architecture:** The redesign introduces a capability-aware route selection layer before generation, a structured text-planning contract that outputs machine-validated JSON, and a route-aware worker that either runs a single-shot flow or a multi-scene flow. All accepted planning outputs must be persisted and then consumed consistently by narration, keyframes, video generation, review pages, and the asset center.

**Tech Stack:** TypeScript, React, Hono, BullMQ, Vitest, ffmpeg, file-based persistence

---

## File Structure

### Shared contracts and planning

- Create: `packages/shared/src/generation-route.ts`
  - Own the route enums, enhancement mode enums, capability types, and route decision helpers.
- Create: `packages/shared/src/planning-contract.ts`
  - Own the structured text-planning input/output schemas.
- Modify: `packages/shared/src/index.ts`
  - Export route and planning types; update task schemas to carry route/planning metadata.
- Modify: `packages/shared/src/task-persistence.ts`
  - Persist new route/planning fields and normalize old task records.
- Modify: `packages/shared/src/storyboard-planner.ts`
  - Keep only low-level scene timing utilities or retire functionality that is superseded by structured planning.

### Config and model capability mapping

- Modify: `packages/config/src/index.ts`
  - Define user-visible generation modes, system enhancement keyword packs, and video-model capability metadata.

### API task planning and persistence

- Modify: `apps/api/src/index.ts`
  - Expose duration options, generation modes, and capability-derived UI hints.
- Modify: `apps/api/src/lib/task-store.ts`
  - Store planning metadata and remove old pseudo-storyboard generation assumptions.

### Web task creation and downstream display

- Modify: `apps/web/src/api.ts`
  - Add typed support for generation mode, route metadata, duration options, and planning outputs.
- Modify: `apps/web/src/pages/HomePage.tsx`
  - Replace the current duration selector with the final production interaction model and generation-mode selection.
- Modify: `apps/web/src/pages/StoryboardReviewPage.tsx`
  - Display persisted planning results instead of generic placeholder assumptions.
- Modify: `apps/web/src/pages/KeyframeReviewPage.tsx`
  - Show route-aware scene data and route-aware review context.
- Modify: `apps/web/src/pages/AssetsPage.tsx`
  - Show target duration, actual duration, route, scene count, and route-consistent assets.
- Modify: `apps/web/src/pages/BatchDashboardPage.tsx`
  - Surface route/duration metadata where it helps queue scanning.
- Modify: `apps/web/src/styles.css`
  - Add any required styling for the new generation-mode and planning displays.

### Worker route-aware execution

- Modify: `apps/worker/src/index.ts`
  - Replace ad-hoc flow with route-aware execution using accepted planning output.
- Modify: `apps/worker/src/lib/providers.ts`
  - Build structured planner prompts, validate outputs, retry planning, and keep final scripts aligned with scene prompts.
- Modify: `apps/worker/src/lib/ffmpeg.ts`
  - Keep concat/mux helpers and final-duration validation helpers.

### Tests

- Create: `tests/unit/shared/generation-route.test.ts`
- Create: `tests/unit/shared/planning-contract.test.ts`
- Modify: `tests/unit/shared/storyboard-planner.test.ts`
- Modify: `tests/unit/api/task-store.test.ts`
- Create: `tests/unit/worker/planning-prompt.test.ts`
- Modify: `tests/unit/worker/providers.test.ts`

### Docs

- Modify: `docs/handover/项目完整说明.md`
  - Update production-chain description once implementation is complete.
- Optionally modify after implementation: `docs/handover/仓库交接说明.md`
  - Add route-selection and planning references if needed.

---

### Task 1: Define route selection contracts and capability metadata

**Files:**
- Create: `packages/shared/src/generation-route.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/config/src/index.ts`
- Test: `tests/unit/shared/generation-route.test.ts`

- [ ] **Step 1: Write the failing route-selection tests**

```ts
import { describe, expect, it } from "vitest"

describe("generation route selection", () => {
  it("forces multi-scene when target duration exceeds model single-shot limit", async () => {
    const route = await import("../../../packages/shared/src/generation-route")

    expect(
      route.resolveGenerationRoute({
        targetDurationSec: 15,
        maxSingleShotSec: 8,
      }),
    ).toMatchObject({
      generationRoute: "multi_scene",
    })
  })

  it("allows single-shot when target duration fits model capability", async () => {
    const route = await import("../../../packages/shared/src/generation-route")

    expect(
      route.resolveGenerationRoute({
        targetDurationSec: 8,
        maxSingleShotSec: 8,
      }),
    ).toMatchObject({
      generationRoute: "single_shot",
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/shared/generation-route.test.ts`

Expected: FAIL because `generation-route.ts` does not exist yet.

- [ ] **Step 3: Implement route enums, capability metadata types, and route resolution**

Implementation requirements:
- Add:
  - `GenerationRoute`
  - `GenerationMode`
  - `EnhancementMode`
  - `VideoModelCapability`
- `resolveGenerationRoute()` must be system-owned and must not defer to text-model judgment.
- Current Veo 3.1 capability defaults should treat `8s` as the effective single-shot ceiling unless explicitly changed in config.

- [ ] **Step 4: Add config-side metadata**

Update `packages/config/src/index.ts` to expose:
- duration presets
- user-visible generation modes
- enhancement keyword packs
- video-model capability defaults

- [ ] **Step 5: Re-run route tests**

Run: `pnpm exec vitest run tests/unit/shared/generation-route.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/generation-route.ts packages/shared/src/index.ts packages/config/src/index.ts tests/unit/shared/generation-route.test.ts
git commit -m "feat: add capability-based generation routing"
```

### Task 2: Define structured text-planning input/output contracts

**Files:**
- Create: `packages/shared/src/planning-contract.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `tests/unit/shared/planning-contract.test.ts`

- [ ] **Step 1: Write the failing planning-contract tests**

```ts
import { describe, expect, it } from "vitest"

describe("planning contract", () => {
  it("defines a valid multi-scene planning output schema", async () => {
    const contract = await import("../../../packages/shared/src/planning-contract")

    const parsed = contract.textPlanningOutputSchema.parse({
      generationRoute: "multi_scene",
      targetDurationSec: 30,
      finalVoiceoverScript: "A valid final script.",
      visualStyleGuide: "Native short-video pacing.",
      ctaLine: "Link in bio.",
      scenePlan: [
        {
          sceneIndex: 0,
          scenePurpose: "Hook",
          durationSec: 6,
          script: "Hook line.",
          imagePrompt: "Hook image prompt.",
          videoPrompt: "Hook video prompt.",
          transitionHint: "hard cut",
        },
      ],
    })

    expect(parsed.generationRoute).toBe("multi_scene")
  })
})
```

- [ ] **Step 2: Run the planning-contract test and confirm it fails**

Run: `pnpm exec vitest run tests/unit/shared/planning-contract.test.ts`

Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Implement text planning input/output schemas**

Implementation requirements:
- Input schema must include:
  - original script
  - target duration
  - platform
  - generation mode
  - enhancement mode
  - route result
  - model capability context
  - optional enhancement keywords
- Output schema must include:
  - `generationRoute`
  - `targetDurationSec`
  - `finalVoiceoverScript`
  - `visualStyleGuide`
  - `ctaLine`
  - `scenePlan[]`

- [ ] **Step 4: Re-run planning-contract tests**

Run: `pnpm exec vitest run tests/unit/shared/planning-contract.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/planning-contract.ts packages/shared/src/index.ts tests/unit/shared/planning-contract.test.ts
git commit -m "feat: add structured text planning contract"
```

### Task 3: Replace task creation and persistence with route-aware planning metadata

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/task-persistence.ts`
- Modify: `apps/api/src/lib/task-store.ts`
- Test: `tests/unit/api/task-store.test.ts`

- [ ] **Step 1: Extend the failing task-store tests**

Add assertions for:
- generation mode persistence
- route persistence
- planning metadata presence
- old task normalization

- [ ] **Step 2: Run task-store tests and confirm new expectations fail**

Run: `pnpm exec vitest run tests/unit/api/task-store.test.ts`

Expected: FAIL on missing route/planning metadata.

- [ ] **Step 3: Add new shared task fields**

Update schemas to persist:
- `generationMode`
- `generationRoute`
- `routeReason`
- `planningVersion`
- `actualDurationSec` as nullable runtime metadata if useful

- [ ] **Step 4: Normalize old task data**

`task-persistence.ts` must upgrade missing fields for old records without breaking existing tasks.

- [ ] **Step 5: Update task-store creation/detail synthesis**

Implementation requirements:
- stop synthesizing fake scene plans as the primary source of truth
- preserve raw user script
- persist selected generation mode and target duration
- prepare task detail to hold planned output once the planner runs

- [ ] **Step 6: Re-run task-store tests**

Run: `pnpm exec vitest run tests/unit/api/task-store.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/task-persistence.ts apps/api/src/lib/task-store.ts tests/unit/api/task-store.test.ts
git commit -m "feat: persist route-aware task planning metadata"
```

### Task 4: Update the task-creation UI to reflect the final content-first interaction model

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add failing UI expectations if practical, otherwise document explicit manual checks in the task notes**

Minimum manual checks to satisfy later:
- duration options visible
- generation mode visible
- no raw technical route labels exposed as the main control

- [ ] **Step 2: Update bootstrap API**

Expose:
- duration options
- generation modes
- user-facing descriptions
- optional non-technical route hint text

- [ ] **Step 3: Update web API typing**

Add:
- `generationMode`
- route hint metadata if exposed

- [ ] **Step 4: Update HomePage interaction**

Replace the current partial duration control with:
- total duration presets
- `忠于原脚本`
- `启用系统增强`
- optional content-facing enhancement toggles only if they can ship complete

- [ ] **Step 5: Ensure createTask submits the full route-planning inputs**

Must submit:
- title
- script
- mode
- platform
- aspect ratio
- duration
- generation mode

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts apps/web/src/api.ts apps/web/src/pages/HomePage.tsx apps/web/src/styles.css
git commit -m "feat: add content-first generation controls"
```

### Task 5: Implement route-aware text planning, validation, and retry

**Files:**
- Modify: `apps/worker/src/lib/providers.ts`
- Test: `tests/unit/worker/planning-prompt.test.ts`
- Modify: `tests/unit/worker/providers.test.ts`

- [ ] **Step 1: Write failing tests for planning prompt construction and output validation**

Include tests for:
- `user_locked` prompt path
- `system_enhanced` prompt path
- invalid commentary output rejection
- route mismatch rejection

- [ ] **Step 2: Run worker planning tests and confirm failures**

Run: `pnpm exec vitest run tests/unit/worker/planning-prompt.test.ts tests/unit/worker/providers.test.ts`

Expected: FAIL for missing planner prompt/validation helpers.

- [ ] **Step 3: Implement planning prompt builder**

Implementation requirements:
- send full user content source
- send system route decision
- send capability context
- send enhancement keyword pack only for `system_enhanced`
- explicitly forbid commentary output

- [ ] **Step 4: Implement structured output validation**

Hard failures must include:
- route mismatch
- empty prompt/script fields
- missing scene data
- commentary contamination
- duration total mismatch

- [ ] **Step 5: Implement auto retry**

Retry count:
- 1 to 2 retries max
- include validation failure reason in retry instructions

- [ ] **Step 6: Replace the current rewrite-only logic**

The worker should stop behaving like a freeform text rewriter and instead produce an accepted structured plan.

- [ ] **Step 7: Re-run worker planning tests**

Run: `pnpm exec vitest run tests/unit/worker/planning-prompt.test.ts tests/unit/worker/providers.test.ts`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/lib/providers.ts tests/unit/worker/planning-prompt.test.ts tests/unit/worker/providers.test.ts
git commit -m "feat: add structured planner validation and retry"
```

### Task 6: Replace worker media execution with route-aware flows

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/lib/ffmpeg.ts`
- Modify: `apps/worker/src/lib/providers.ts`

- [ ] **Step 1: Add route-aware execution entry**

Worker must branch on accepted route:
- `single_shot`
- `multi_scene`

- [ ] **Step 2: Implement single-shot execution**

Requirements:
- one unified script
- one scene plan
- one video generation call
- route-consistent keyframe handling

- [ ] **Step 3: Implement multi-scene execution**

Requirements:
- one video generation call per scene
- route-consistent keyframe handling
- video concatenation
- narration mux on stitched result

- [ ] **Step 4: Persist accepted planning output before media generation**

Must write the final accepted detail back so UI/assets/worker all reference the same source of truth.

- [ ] **Step 5: Add final-duration validation helpers**

Rules:
- planning duration exact
- final media duration pass if within `±2s`
- warning if `>2s` and `<=5s`
- fail/retry candidate beyond that

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/lib/ffmpeg.ts apps/worker/src/lib/providers.ts
git commit -m "feat: execute route-aware single-shot and multi-scene media flows"
```

### Task 7: Update review and asset surfaces to consume the accepted plan

**Files:**
- Modify: `apps/web/src/pages/StoryboardReviewPage.tsx`
- Modify: `apps/web/src/pages/KeyframeReviewPage.tsx`
- Modify: `apps/web/src/pages/AssetsPage.tsx`
- Modify: `apps/web/src/pages/BatchDashboardPage.tsx`
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add route-aware display fields to web API types**

- [ ] **Step 2: Update storyboard review**

Must show:
- accepted scene plan
- route-aware context
- target duration

- [ ] **Step 3: Update keyframe review**

Must align displayed prompts and scenes with accepted planning output.

- [ ] **Step 4: Update asset center**

Must display:
- target duration
- actual duration if present
- route
- scene count
- route-consistent output labels

- [ ] **Step 5: Update batch dashboard**

Expose useful route/duration metadata in queue scanning without clutter.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/StoryboardReviewPage.tsx apps/web/src/pages/KeyframeReviewPage.tsx apps/web/src/pages/AssetsPage.tsx apps/web/src/pages/BatchDashboardPage.tsx apps/web/src/api.ts
git commit -m "feat: align review and asset surfaces with accepted planning output"
```

### Task 8: Run full verification and real-task validation

**Files:**
- Modify: `docs/handover/项目完整说明.md`
- Optionally modify: `docs/handover/仓库交接说明.md`

- [ ] **Step 1: Run all automated verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected:
- all pass

- [ ] **Step 2: Run one real single-shot validation task if the current video model capability allows it**

Expected:
- accepted route is `single_shot`
- final output completes successfully

- [ ] **Step 3: Run one real multi-scene validation task**

Expected:
- accepted route is `multi_scene`
- final output completes successfully
- final duration is within tolerance policy

- [ ] **Step 4: Inspect persisted task detail and exported assets**

Verify:
- persisted task detail matches worker-used plan
- script export matches accepted voiceover script
- final video label and metadata match route/duration

- [ ] **Step 5: Update handoff docs**

Document:
- new generation modes
- route-selection rule
- current model duration ceiling
- tolerance policy

- [ ] **Step 6: Commit**

```bash
git add docs/handover/项目完整说明.md docs/handover/仓库交接说明.md
git commit -m "docs: document production planning and route-aware media chain"
```

## Plan Notes

- This plan intentionally treats the redesign as one full-chain replacement, not a piecemeal upgrade.
- A task is not complete if its downstream consumers still rely on the old assumptions.
- Any substitute must remain at the same product level; fallback to fixed templates or uncontrolled freeform rewrites is not acceptable.
