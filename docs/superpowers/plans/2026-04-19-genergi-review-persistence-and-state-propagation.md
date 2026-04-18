# GENERGI Review Persistence And State Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn storyboard/keyframe review from a read-only façade into a real persisted review workflow, with truthful task-state updates, worker-safe review metadata preservation, and visible propagation into the dashboard and asset center.

**Architecture:** Keep the current generated-media chain intact, but add a persistent review-mutation layer around `TaskDetail.scenes`, `TaskSummary.status`, and the worker round-trip paths that currently rewrite scene arrays. Review pages will submit explicit decisions to new Hono mutation routes; the task store and worker/provider helpers will preserve review metadata across normalization and regeneration boundaries; and the dashboard/asset center will render canonical review summaries instead of guessing from local scene state.

**Tech Stack:** TypeScript, React, Hono, shared Zod contracts, file-based persistence, Vitest

---

## File Structure

### Shared review contracts

- Modify: `packages/shared/src/index.ts`
  - Add review-decision input/output schemas and any task-level review summary fields needed by API and UI.

### Persistence and domain logic

- Modify: `apps/api/src/lib/task-store.ts`
  - Own review mutation helpers that update scene statuses, notes, timestamps, and recompute task-level review state.
- Modify: `packages/shared/src/task-persistence.ts`
  - Normalize any newly added persisted review fields for older task/detail records.
- Modify: `packages/shared/src/storyboard-planner.ts`
  - Preserve existing review metadata when scenes are rehydrated or rebuilt where possible.

### API routes and response shaping

- Modify: `apps/api/src/index.ts`
  - Add authenticated review mutation endpoints and enrich task/detail responses with canonical review summaries.

### Web API client and pages

- Modify: `apps/web/src/api.ts`
  - Add typed review mutation helpers and new review summary fields.
- Modify: `apps/web/src/pages/StoryboardReviewPage.tsx`
  - Replace disabled placeholder actions with real submit flows and persisted feedback UX.
- Modify: `apps/web/src/pages/KeyframeReviewPage.tsx`
  - Same as storyboard review, while preserving honest missing-keyframe empty/error states.
- Modify: `apps/web/src/pages/BatchDashboardPage.tsx`
  - Surface truthful review-blocked tasks and review-stage counts.
- Modify: `apps/web/src/pages/AssetsPage.tsx`
  - Show task review stage / pending review state where it helps operators understand why assets are not ready.
- Modify: `apps/web/src/styles.css`
  - Only the minimum styling needed for pending/submitting/success/error states and review summary blocks.

### Worker and planning preservation

- Modify: `apps/worker/src/index.ts`
  - Preserve review metadata when task details are rewritten during artifact generation.
- Modify: `apps/worker/src/lib/providers.ts`
  - Ensure planning/rewrite paths round-trip scene review fields instead of dropping them.

### Tests

- Modify: `tests/unit/api/task-store.test.ts`
  - Cover review persistence, task status recomputation, and old-record normalization.
- Create: `tests/unit/api/review-routes.test.ts`
  - Cover request validation, scene-not-found behavior, and successful status transitions.
- Modify: `tests/unit/worker/providers.test.ts`
  - Cover review-metadata preservation through rewrite/planning paths.
- Optionally create if needed: `tests/unit/web/review-pages.test.tsx`
  - Only if existing test setup makes this cheap; otherwise use explicit manual verification in the task steps.

---

## Scope Boundary

This plan **does include**:

- persisted storyboard decisions
- persisted keyframe decisions
- review notes writeback
- task-level review stage / pending counts / waiting state
- dashboard + asset center reflection of persisted review state
- truthful enabling/disabling of review actions

This plan **does not include**:

- pausing the worker before media generation
- resuming failed worker jobs from review decisions
- redesigning the broader task orchestration state machine beyond truthful persisted review summaries

Those are separate projects. For this subproject, “complete” means the review surfaces become real and consistent across read/write paths.

---

### Task 1: Define canonical review write contracts and read-model fields

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `tests/unit/api/task-store.test.ts`

- [ ] **Step 1: Write failing shared-contract assertions in the existing task-store test**

Add assertions for:
- accepted review-decision payload shape
- returned detail containing updated scene status
- task summary exposing review stage metadata

Example expectation snippet:

```ts
expect(updatedDetail.scenes[0].reviewStatus).toBe("approved")
expect(updatedSummary.status).toBe("waiting_review")
expect(updatedSummary.reviewStage).toBe("storyboard_review")
expect(updatedSummary.pendingReviewCount).toBe(3)
```

- [ ] **Step 2: Run the task-store test to confirm the new expectations fail**

Run: `pnpm exec vitest run tests/unit/api/task-store.test.ts`

Expected: FAIL because review-stage fields and mutation helpers do not exist yet.

- [ ] **Step 3: Extend shared schemas**

Add:
- `reviewDecisionStageSchema`
- `reviewDecisionStatusSchema`
- `reviewDecisionInputSchema`
- `reviewSummarySchema`

Persist on `TaskSummary`:
- `reviewStage: ReviewStageId | null`
- `pendingReviewCount: number`
- `reviewUpdatedAt: string | null`

Persist on `StoryboardScene`:
- `reviewNote?: string`
- `reviewedAt?: string`
- `keyframeReviewNote?: string`
- `keyframeReviewedAt?: string`

Rules:
- Reuse the existing shared `reviewStageSchema` values (`storyboard_review | keyframe_review | auto_qa`)
- Use `null` only when there is no active/pending review stage
- Do not introduce a separate `"completed"` enum value that conflicts with existing shared contracts

- [ ] **Step 4: Re-run the task-store test to confirm schema compilation and typing are now unblocked**

Run: `pnpm exec vitest run tests/unit/api/task-store.test.ts`

Expected: Still FAIL on missing mutation logic, but no schema/type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts tests/unit/api/task-store.test.ts
git commit -m "feat: add shared review persistence contracts"
```

### Task 2: Add task-store review mutation helpers and truthful task-state recomputation

**Files:**
- Modify: `apps/api/src/lib/task-store.ts`
- Modify: `packages/shared/src/task-persistence.ts`
- Test: `tests/unit/api/task-store.test.ts`

- [ ] **Step 1: Expand task-store tests with scene-level mutation cases**

Add cases for:
- approving one storyboard scene
- rejecting one storyboard scene with note
- approving all storyboard scenes causes task review stage to advance
- rejecting/approving keyframe scenes updates keyframe stage independently
- old detail records missing review metadata are normalized

Example cases:

```ts
it("marks a storyboard scene approved and keeps remaining pending count", async () => {
  const result = await store.applySceneReviewDecision(taskId, {
    stage: "storyboard_review",
    sceneId: firstSceneId,
    decision: "approved",
    note: "opening beat works",
  })

  expect(result.detail.scenes[0].reviewStatus).toBe("approved")
  expect(result.summary.pendingReviewCount).toBe(3)
})
```

- [ ] **Step 2: Run the task-store test and confirm it fails on missing helper behavior**

Run: `pnpm exec vitest run tests/unit/api/task-store.test.ts`

Expected: FAIL because `applySceneReviewDecision` and review-state recomputation do not exist.

- [ ] **Step 3: Implement review-state helpers in task-store**

Add:
- `normalizeSceneReviewMetadata(scene)`
- `deriveReviewSummary(detail)`
- `applySceneReviewDecision(taskId, input)`

Rules:
- storyboard stage is active while any `reviewStatus === "pending"`
- keyframe stage becomes active only after storyboard stage is fully approved
- once both human stages are complete, `reviewStage` advances to `auto_qa` or `null` according to the current task status contract, but must not fork the shared enum model
- task summary uses `waiting_review` while there are pending scene reviews
- review completion is task-summary metadata; it must not falsely mark the task as media-complete if the task already failed/runs elsewhere

- [ ] **Step 4: Update persistence normalization**

Ensure old `TaskDetail` records that only have `reviewStatus/keyframeStatus` still load cleanly with missing note/timestamp fields defaulted.

- [ ] **Step 5: Update summary seeding and migration**

Implementation requirements:
- `seedTaskSummaries()` must emit explicit review summary defaults
- `readTaskSummaries()` must normalize missing `reviewStage`, `pendingReviewCount`, and `reviewUpdatedAt`
- legacy records must remain readable without frontend `undefined` drift

- [ ] **Step 6: Re-run the task-store suite**

Run: `pnpm exec vitest run tests/unit/api/task-store.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/task-store.ts packages/shared/src/task-persistence.ts tests/unit/api/task-store.test.ts
git commit -m "feat: persist scene review decisions"
```

### Task 3: Preserve review metadata across task normalization and worker rewrite paths

**Files:**
- Modify: `apps/api/src/lib/task-store.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/lib/providers.ts`
- Modify: `packages/shared/src/storyboard-planner.ts`
- Test: `tests/unit/worker/providers.test.ts`

- [ ] **Step 1: Write failing preservation tests**

Add coverage for:
- task-store normalization retaining existing scene review notes/timestamps
- provider rewrite/planning retaining scene review fields when scene identity survives
- worker write path not blanking review metadata when only script/prompt fields change

Example expectation:

```ts
expect(nextDetail.scenes[0].reviewNote).toBe("opening beat works")
expect(nextDetail.scenes[0].reviewedAt).toBe(existingReviewedAt)
```

- [ ] **Step 2: Run the provider/task-store tests and confirm the new expectations fail**

Run:
- `pnpm exec vitest run tests/unit/api/task-store.test.ts`
- `pnpm exec vitest run tests/unit/worker/providers.test.ts`

Expected: FAIL because current normalization/rewrite paths rebuild scenes without preserving custom review fields.

- [ ] **Step 3: Implement preservation helpers**

Implementation requirements:
- merge rebuilt/planned scenes with existing scene review metadata by stable key (`scene.id` first, then index fallback if needed)
- preserve review notes/timestamps/status fields whenever a scene survives a rewrite
- keep dropped scenes honest: if a scene truly disappears because planning changed, its review state may disappear too, but this must happen through deliberate merge rules, not accidental object replacement

- [ ] **Step 4: Re-run preservation tests**

Run:
- `pnpm exec vitest run tests/unit/api/task-store.test.ts`
- `pnpm exec vitest run tests/unit/worker/providers.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/task-store.ts apps/worker/src/index.ts apps/worker/src/lib/providers.ts packages/shared/src/storyboard-planner.ts tests/unit/worker/providers.test.ts tests/unit/api/task-store.test.ts
git commit -m "fix: preserve review metadata across planning rewrites"
```

### Task 4: Add authenticated review mutation routes and response shaping

**Files:**
- Modify: `apps/api/src/index.ts`
- Create: `tests/unit/api/review-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Cover:
- invalid payload returns `400`
- unknown task or scene returns `404`
- valid storyboard review returns updated summary/detail fields
- valid keyframe review returns updated summary/detail fields

Example skeleton:

```ts
it("returns 404 when scene is missing", async () => {
  const response = await app.request("/api/tasks/task_1/reviews/storyboard_review/scene_missing", {
    method: "POST",
    body: JSON.stringify({ decision: "approved", note: "ok" }),
  })

  expect(response.status).toBe(404)
})
```

- [ ] **Step 2: Run the new route test and confirm it fails**

Run: `pnpm exec vitest run tests/unit/api/review-routes.test.ts`

Expected: FAIL because the route file/test harness does not exist yet.

- [ ] **Step 3: Implement review routes**

Add authenticated routes:
- `POST /api/tasks/:taskId/reviews/storyboard_review/:sceneId`
- `POST /api/tasks/:taskId/reviews/keyframe_review/:sceneId`

Return payload:

```ts
{
  task: enrichedSummary,
  detail: enrichedDetail
}
```

Keep request body minimal:
- `decision: "approved" | "rejected"`
- `note?: string`

- [ ] **Step 4: Ensure enrichSummary/enrichDetail expose canonical review summary**

Do not make the frontend infer pending review state by guessing from scenes every time. Return canonical review stage and pending counts.

- [ ] **Step 5: Re-run route tests**

Run: `pnpm exec vitest run tests/unit/api/review-routes.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts tests/unit/api/review-routes.test.ts
git commit -m "feat: add review decision api routes"
```

### Task 5: Add web client mutation helpers and storyboard-review submission flow

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/StoryboardReviewPage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add failing/manual expectations to the task notes**

Minimum expected behavior:
- approve/reject buttons enabled only when a scene is selected
- clicking approve persists and immediately updates scene status
- clicking reject persists note and updates scene status
- loading/submitting state is visible
- no “fake success” state

- [ ] **Step 2: Add typed client helpers**

Add:
- `submitStoryboardReview(taskId, sceneId, payload)`

Payload/result types:

```ts
type ReviewDecisionPayload = {
  decision: "approved" | "rejected"
  note?: string
}
```

- [ ] **Step 3: Replace disabled placeholder buttons with real submit flow**

In `StoryboardReviewPage.tsx`:
- local state for `reviewNote`
- local `submittingDecision`
- optimistic disable while request is in-flight
- on success, replace both `tasks` and `detail` from API response
- if approved, auto-advance to the next pending scene if one exists

- [ ] **Step 4: Add honest empty/error/saving states**

Implementation requirements:
- show explicit submit error if mutation fails
- show success copy only after server confirms
- keep “高级操作” disabled if there is still no real backend implementation for merge/split

- [ ] **Step 5: Run targeted checks**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/pages/StoryboardReviewPage.tsx apps/web/src/styles.css
git commit -m "feat: persist storyboard review decisions"
```

### Task 6: Add keyframe-review submission flow and keep preview honest

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/KeyframeReviewPage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add typed client helper**

Add:
- `submitKeyframeReview(taskId, sceneId, payload)`

- [ ] **Step 2: Implement keyframe decision flow**

Requirements:
- same submit/error/success behavior as storyboard review
- note field persists through the keyframe route
- on approval, auto-advance to next pending keyframe if possible

- [ ] **Step 3: Keep preview mode honest**

Requirements:
- continue to show empty/error state if keyframe does not exist
- keep image preview `contain`, not cropped
- do not re-enable fake advanced actions that still lack backend support

- [ ] **Step 4: Run targeted checks**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/pages/KeyframeReviewPage.tsx apps/web/src/styles.css
git commit -m "feat: persist keyframe review decisions"
```

### Task 7: Propagate canonical review state into dashboard and asset center

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/BatchDashboardPage.tsx`
- Modify: `apps/web/src/pages/AssetsPage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Extend read models with review summary fields**

Add frontend types for:
- `reviewStage`
- `pendingReviewCount`
- `reviewUpdatedAt`

- [ ] **Step 2: Update the batch dashboard**

Requirements:
- show how many tasks are blocked in storyboard review vs keyframe review
- “需要复核” should use canonical review state, not only duration failures
- sort queue and exception list by `updatedAt`
- keep visible freshness indicator

- [ ] **Step 3: Update the asset center**

Requirements:
- show whether assets are waiting on storyboard review, keyframe review, or fully reviewed
- include review freshness next to the existing asset freshness hint
- do not pretend assets are “ready for handoff” if review is still pending

- [ ] **Step 4: Run targeted checks**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/pages/BatchDashboardPage.tsx apps/web/src/pages/AssetsPage.tsx apps/web/src/styles.css
git commit -m "feat: propagate review state across workbench pages"
```

### Task 8: End-to-end verification and regression pass

**Files:**
- Verify only; modify as needed in files touched above if regressions appear

- [ ] **Step 1: Run the backend/unit suites**

Run:
- `pnpm exec vitest run tests/unit/api/task-store.test.ts`
- `pnpm exec vitest run tests/unit/api/review-routes.test.ts`

Expected: PASS

- [ ] **Step 2: Run full focused app checks**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/api typecheck`
- `pnpm --filter @genergi/web build`
- `pnpm --filter @genergi/api build`

Expected: PASS

- [ ] **Step 3: Manual browser verification**

Verify in browser:
- storyboard page approve persists after reload
- storyboard reject with note persists after reload
- keyframe page approve persists after reload
- dashboard shows updated review stage/pending count
- asset center shows pending review state honestly
- disabled advanced operations remain clearly disabled

- [ ] **Step 4: Commit final verification fixes if needed**

```bash
git add <only files changed during regression pass>
git commit -m "fix: finalize review persistence workflow"
```

---

## Manual Acceptance Criteria

The subproject is only complete when all of the following are true:

- Clicking storyboard approve/reject changes persisted scene state
- Clicking keyframe approve/reject changes persisted scene state
- Review notes survive refresh
- Task summary shows truthful review stage and pending counts
- Batch dashboard reflects review-blocked tasks without misleading truncation/order
- Asset center reflects whether a task is still awaiting review
- Review pages no longer pretend unsupported actions are live
- Typecheck/build/tests pass

## Risks And Guardrails

- Do not mix this with worker pause/resume orchestration.
- Do not re-enable “merge/split/retry” actions unless backend support exists in the same change set.
- Do not let frontend infer review summary purely from local arrays once the backend returns canonical review state.
- Preserve existing auth behavior on all new routes.
