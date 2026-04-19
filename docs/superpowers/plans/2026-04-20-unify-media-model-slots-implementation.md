# GENERGI Media Model Slot Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misleading six-slot media model system with a four-slot runtime model system that matches the current real production chain: `textModel`, `imageModel`, `videoModel`, and `ttsProvider`.

**Architecture:** Treat this as a full-stack cleanup in one pass. Update shared contracts and persistence first, then migrate the model-control API and resolver, then task creation and worker runtime, and finally the model-control UI plus help-center/operator copy. Since the operator explicitly approved clearing old tasks, remove legacy task data instead of carrying long-term compatibility baggage.

**Tech Stack:** TypeScript, React, Hono, shared Zod contracts, file-based persistence, BullMQ worker, Vitest

---

## File Structure

### Shared contracts and persistence

- Modify: `packages/shared/src/model-control.ts`
  - Replace six-slot media schema with four-slot runtime schema.
- Modify: `packages/shared/src/index.ts`
  - Update task schemas and `TaskRunConfig` to use the new slot model.
- Modify: `packages/shared/src/task-persistence.ts`
  - Migrate defaults, registry, and task snapshot normalization to the new slot system.

### Seed config and model-control backend

- Modify: `packages/config/src/index.ts`
  - Collapse media defaults to `imageModel` and `videoModel`.
- Modify: `apps/api/src/index.ts`
  - Replace obsolete slot names in request schemas, seed state, selectable pools, defaults handling, and API output.
- Modify: `apps/api/src/lib/model-control/registry-store.ts`
  - Update seeding and registry persistence for new slot names.
- Modify: `apps/api/src/lib/model-control/resolver.ts`
  - Resolve four-slot runtime snapshots only.
- Modify: `apps/api/src/lib/model-control/validation.ts`
  - Remove draft/final media assumptions from validation.
- Modify: `apps/api/src/lib/task-store.ts`
  - Freeze only four slots and stop carrying image/video draft/final duplication.

### Worker runtime

- Modify: `apps/worker/src/lib/providers.ts`
  - Consume simplified runtime snapshot only.
- Modify: `apps/worker/src/index.ts`
  - Keep worker artifact labels aligned to the simplified slot system if needed.

### Web console

- Modify: `apps/web/src/api.ts`
  - Update slot types, defaults payloads, selectable pool types, and labels.
- Modify: `apps/web/src/pages/HomePage.tsx`
  - Reduce advanced override panel from six media-related slots to four total runtime slots.
- Modify: `apps/web/src/pages/ModelControlCenterPage.tsx`
  - Update overview wording and slot summaries.
- Modify: `apps/web/src/pages/ModelRegistryPage.tsx`
  - Remove obsolete slot choices and present only `text/image/video/TTS`.
- Modify: `apps/web/src/pages/ModelDefaultsPage.tsx`
  - Render four-slot defaults center.
- Modify as needed: `apps/web/src/pages/KeyframeReviewPage.tsx`
  - Remove obsolete draft/final media terminology if it still appears in review-facing copy.
- Modify as needed: `apps/web/src/styles.css`
  - Adjust layout after slot count reduction.

### Help and operator content

- Modify: `apps/web/src/help-center/content/features.ts`
- Modify: `apps/web/src/help-center/content/workflows.ts`
- Modify: `apps/web/src/help-center/content/releases.ts`
  - Remove draft/final media wording and update explanations to the simplified model.
- Modify: `docs/handover/项目完整说明.md`
- Modify: `docs/handover/仓库交接说明.md`
- Modify: `docs/handover/模型控制面使用说明.md`

### Tests

- Modify: `tests/unit/api/model-control-registry.test.ts`
- Modify: `tests/unit/api/model-control-resolver.test.ts`
- Modify: `tests/unit/api/model-control-validation.test.ts`
- Modify: `tests/unit/api/task-store.test.ts`
- Modify: `tests/unit/worker/providers.test.ts`
- Optionally modify: `tests/unit/web/help-center-content.test.ts`

---

## Task 1: Replace shared six-slot contracts with four-slot contracts

**Files:**
- Modify: `packages/shared/src/model-control.ts`
- Modify: `packages/shared/src/index.ts`
- Test: update `tests/unit/api/model-control-registry.test.ts`

- [ ] **Step 1: Write failing shared/registry expectations for four runtime slots**

Cover:
- slot enum contains only `textModel`, `imageModel`, `videoModel`, `ttsProvider`
- defaults schemas no longer expose draft/final media slots
- task override schema no longer exposes draft/final media slots

- [ ] **Step 2: Run the focused registry test to confirm failure**

Run:
`pnpm exec vitest run tests/unit/api/model-control-registry.test.ts --testTimeout=15000`

Expected:
- FAIL because current registry contracts still use six slots

- [ ] **Step 3: Update shared model-control schemas**

Implement:
- new slot enum
- new defaults shapes
- new selectable option schema
- new snapshot schema if field names need simplification

- [ ] **Step 4: Update shared task schemas**

Ensure:
- `TaskRunConfig`
- `CreateTaskInput`
- related shared exports
all point to the four-slot system.

- [ ] **Step 5: Re-run the focused registry test**

Run:
`pnpm exec vitest run tests/unit/api/model-control-registry.test.ts --testTimeout=15000`

Expected:
- PASS or fail later in API code for migration reasons, not shared contract mismatch

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/model-control.ts packages/shared/src/index.ts tests/unit/api/model-control-registry.test.ts
git commit -m "refactor: collapse media model slots in shared contracts"
```

## Task 2: Migrate persistence and seed defaults to the new slot system

**Files:**
- Modify: `packages/shared/src/task-persistence.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `apps/api/src/lib/model-control/registry-store.ts`
- Test: `tests/unit/api/model-control-registry.test.ts`

- [ ] **Step 1: Write failing persistence expectations**

Cover:
- defaults persist as `text/image/video/TTS`
- seed defaults collapse draft/final media into one image and one video slot
- old defaults can be normalized into the new shape using final-first precedence

- [ ] **Step 2: Run registry test to confirm failure in persistence/seed layer**

Run:
`pnpm exec vitest run tests/unit/api/model-control-registry.test.ts --testTimeout=15000`

Expected:
- FAIL because persistence or seed logic still emits six-slot defaults

- [ ] **Step 3: Update normalization and migration logic**

Rules:
- old `imageFinalModel` -> new `imageModel` preferred
- fallback to old `imageDraftModel` only if final missing
- old `videoFinalModel` -> new `videoModel` preferred
- fallback to old `videoDraftModel` only if final missing

- [ ] **Step 4: Update config seed data**

Replace media defaults in `MODE_MODELS` / default task config to use unified image/video slots.

- [ ] **Step 5: Update registry seed builder**

Seed only four runtime slots, not six.

- [ ] **Step 6: Re-run registry test**

Run:
`pnpm exec vitest run tests/unit/api/model-control-registry.test.ts --testTimeout=15000`

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/task-persistence.ts packages/config/src/index.ts apps/api/src/lib/model-control/registry-store.ts tests/unit/api/model-control-registry.test.ts
git commit -m "refactor: migrate defaults and seeds to unified media slots"
```

## Task 3: Update model-control API and resolver to four slots

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/lib/model-control/resolver.ts`
- Modify: `apps/api/src/lib/model-control/validation.ts`
- Test: `tests/unit/api/model-control-resolver.test.ts`
- Test: `tests/unit/api/model-control-validation.test.ts`

- [ ] **Step 1: Write failing resolver/validation expectations**

Cover:
- selectable pools expose only four slots
- model creation/updates only allow `textModel`, `imageModel`, `videoModel`, `ttsProvider`
- defaults endpoints accept only four slots
- resolver freezes only four slots

- [ ] **Step 2: Run the focused API tests to confirm failure**

Run:
`pnpm exec vitest run tests/unit/api/model-control-validation.test.ts tests/unit/api/model-control-resolver.test.ts --testTimeout=15000`

Expected:
- FAIL because API and resolver still reference draft/final media slots

- [ ] **Step 3: Update model-control route schemas and selectable pool generation**

Ensure:
- model input schemas use new slot names
- defaults endpoints use new slot names
- selectable pool API returns only four pools

- [ ] **Step 4: Update resolver and validation**

Ensure:
- one image slot resolved
- one video slot resolved
- no draft/final branching remains in resolver

- [ ] **Step 5: Re-run focused API tests**

Run:
`pnpm exec vitest run tests/unit/api/model-control-validation.test.ts tests/unit/api/model-control-resolver.test.ts --testTimeout=15000`

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/lib/model-control/resolver.ts apps/api/src/lib/model-control/validation.ts tests/unit/api/model-control-validation.test.ts tests/unit/api/model-control-resolver.test.ts
git commit -m "refactor: simplify model control api to four runtime slots"
```

## Task 4: Simplify task creation and worker runtime to the real execution chain

**Files:**
- Modify: `apps/api/src/lib/task-store.ts`
- Modify: `apps/worker/src/lib/providers.ts`
- Modify as needed: `apps/worker/src/index.ts`
- Test: `tests/unit/api/task-store.test.ts`
- Test: `tests/unit/worker/providers.test.ts`

- [ ] **Step 1: Write failing tests for four-slot snapshot behavior**

Cover:
- new task snapshots contain only text/image/video/TTS
- worker runtime consumes only image/video single slots
- no runtime reliance on draft/final media labels remains

- [ ] **Step 2: Run task-store and worker tests to confirm failure**

Run:
`pnpm exec vitest run tests/unit/api/task-store.test.ts tests/unit/worker/providers.test.ts --testTimeout=15000`

Expected:
- FAIL because snapshot and runtime still use draft/final media slot assumptions

- [ ] **Step 3: Update task snapshot mapping**

Freeze only:
- `textModel`
- `imageModel`
- `videoModel`
- `ttsProvider`

- [ ] **Step 4: Update worker runtime consumption**

Ensure:
- keyframe/image generation reads `imageModel`
- video generation reads `videoModel`
- no lingering references to `imageFinalModel`/`videoFinalModel` as semantic stages

- [ ] **Step 5: Re-run task-store and worker tests**

Run:
`pnpm exec vitest run tests/unit/api/task-store.test.ts tests/unit/worker/providers.test.ts --testTimeout=15000`

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/task-store.ts apps/worker/src/lib/providers.ts apps/worker/src/index.ts tests/unit/api/task-store.test.ts tests/unit/worker/providers.test.ts
git commit -m "refactor: align task runtime to unified media slots"
```

## Task 5: Clear obsolete task/runtime data and rebuild model defaults

**Files:**
- Modify as needed: `packages/shared/src/task-persistence.ts`
- Possibly add/modify a cleanup script under `scripts/`
- Verify app data path behavior explicitly

- [ ] **Step 1: Add a deterministic cleanup path for old task data**

Clear:
- old task summaries
- old task details
- old task assets

because the operator explicitly approved removing all old tasks.

- [ ] **Step 2: Ensure defaults rebuild uses the new slot model**

No stale six-slot defaults should survive after cleanup.

- [ ] **Step 3: Execute the local cleanup before verification**

Actually run the cleanup path against local task summaries/details/assets so the rollout is tested against the new empty baseline, not just described on paper.

- [ ] **Step 4: Run a local smoke on a fresh task after cleanup**

Use:
- one new task creation path
- inspect frozen snapshot

Expected:
- only four slots appear

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/task-persistence.ts scripts
git commit -m "chore: clear legacy task data for unified media slot rollout"
```

## Task 6: Rebuild the model-control UI around four runtime slots

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/ModelControlCenterPage.tsx`
- Modify: `apps/web/src/pages/ModelRegistryPage.tsx`
- Modify: `apps/web/src/pages/ModelDefaultsPage.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing assumptions for four-slot frontend types**

Make the web layer expect:
- `textModel`
- `imageModel`
- `videoModel`
- `ttsProvider`

- [ ] **Step 2: Update web API slot definitions**

Replace the six-slot labels and orders with the new four-slot system.

- [ ] **Step 3: Update Model Registry page**

Only allow registration under:
- 文本模型
- 图片模型
- 视频模型
- TTS 配音

- [ ] **Step 4: Update Defaults Center**

Render only four rows per defaults scope.

- [ ] **Step 5: Update task-level advanced overrides**

Render only four runtime slots and rewrite any explanatory copy to match the real production chain.

- [ ] **Step 6: Update model-control overview summaries**

Ensure overview copy and slot summary no longer mention draft/final media stages.

- [ ] **Step 7: Update review surfaces that still expose old media concepts**

At minimum, verify `apps/web/src/pages/KeyframeReviewPage.tsx` and any other review-facing labels no longer imply a draft/final image/video staging model that the runtime does not execute.

- [ ] **Step 8: Run web verification**

Run:
`pnpm --filter @genergi/web typecheck && pnpm --filter @genergi/web build`

Expected:
- PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/pages/ModelControlCenterPage.tsx apps/web/src/pages/ModelRegistryPage.tsx apps/web/src/pages/ModelDefaultsPage.tsx apps/web/src/pages/HomePage.tsx apps/web/src/pages/KeyframeReviewPage.tsx apps/web/src/styles.css
git commit -m "refactor: simplify model control ui to four runtime slots"
```

## Task 7: Rewrite help-center and operator copy to remove fake stage concepts

**Files:**
- Modify: `apps/web/src/help-center/content/features.ts`
- Modify: `apps/web/src/help-center/content/workflows.ts`
- Modify: `apps/web/src/help-center/content/releases.ts`
- Modify: `docs/handover/项目完整说明.md`
- Modify: `docs/handover/仓库交接说明.md`
- Modify: `docs/handover/模型控制面使用说明.md`

- [ ] **Step 1: Rewrite help-center content**

Remove wording that implies:
- draft image stage
- final image stage
- draft video stage
- final video stage

- [ ] **Step 2: Rewrite model-control docs**

Explain the simplified runtime logic:
- one text model
- one image model
- one video model
- one TTS provider

- [ ] **Step 3: Re-run help/content verification**

Run:
`pnpm exec vitest run tests/unit/web/help-center-content.test.ts`

Expected:
- PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/help-center/content docs/handover
git commit -m "docs: align operator guidance to unified media slots"
```

## Task 8: Final verification and rollout readiness

**Files:**
- Verify all touched files as needed

- [ ] **Step 1: Run full relevant verification**

Run:
`pnpm exec vitest run tests/unit/worker/providers.test.ts tests/unit/api/model-control-registry.test.ts tests/unit/api/model-control-validation.test.ts tests/unit/api/model-control-resolver.test.ts tests/unit/api/task-store.test.ts tests/unit/web/help-center-content.test.ts --testTimeout=15000`

Run:
`pnpm --filter @genergi/shared build && pnpm --filter @genergi/api typecheck && pnpm --filter @genergi/worker typecheck && pnpm --filter @genergi/web typecheck && pnpm --filter @genergi/web build`

Expected:
- PASS

- [ ] **Step 2: Manual local verification**

Check:
- model registry slot choices
- defaults center rows
- task advanced override rows
- help center wording

- [ ] **Step 3: Prepare rollout validation checklist**

Checklist must confirm:
- old tasks cleared
- new task freezes only four slots
- selectable pools expose only four slots
- UI/help-center text no longer implies fake media stages

- [ ] **Step 4: Include the cleanup action in the rollout sequence**

The rollout notes must explicitly include:
- clear old task data
- rebuild defaults
- create one fresh task
- inspect the new frozen snapshot

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: finalize unified media model slot rollout"
```

---

## Manual Acceptance Criteria

This redesign is complete only when:

- the runtime slot system contains only `textModel`, `imageModel`, `videoModel`, `ttsProvider`
- model registry no longer exposes draft/final media slot choices
- defaults center no longer exposes draft/final media slot choices
- advanced overrides no longer expose draft/final media slot choices
- worker runtime no longer relies on draft/final media distinctions
- old tasks are cleared
- help center and operator docs no longer imply non-existent media stages
- tests and builds pass
- a newly created task freezes only the new four-slot snapshot shape


