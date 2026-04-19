# GENERGI Model Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class model control plane for GENERGI so providers/models can be managed in-system, validated before use, resolved through global/mode/task precedence, and frozen into task snapshots without relying on static code mappings as the primary live source of truth.

**Architecture:** Keep current worker-side provider execution paths, but move control ownership into a server-side registry and resolver. Static `packages/config` model definitions become bootstrap seed data, while runtime truth comes from provider/model registries, effective defaults, and per-task frozen snapshots. The web console gains both an admin-facing model management center and an advanced override panel in task creation.

**Tech Stack:** TypeScript, React, Hono, shared Zod contracts, file-based persistence (Phase 1), BullMQ worker, Vitest

---

## File Structure

### Shared contracts and persistence

- Create: `packages/shared/src/model-control.ts`
  - Shared schemas and types for provider records, model records, validation state, effective slot config, encrypted secret references, and override payloads.
- Modify: `packages/shared/src/index.ts`
  - Export model-control contracts and extend task schemas to support frozen slot snapshots and override metadata.
- Modify: `packages/shared/src/task-persistence.ts`
  - Persist provider/model registry data, defaults, and validation metadata with normalization rules.

### Bootstrap / seed data

- Modify: `packages/config/src/index.ts`
  - Convert static model defaults into seed/default material rather than primary runtime truth.

### API / control plane backend

- Create: `apps/api/src/lib/model-control/crypto.ts`
  - Encrypt/decrypt provider secrets using a server-side master key.
- Create: `apps/api/src/lib/model-control/registry-store.ts`
  - CRUD and normalization for providers/models/defaults.
- Create: `apps/api/src/lib/model-control/validation.ts`
  - Provider/model validation orchestration (connectivity, auth, model existence, capability shape).
- Create: `apps/api/src/lib/model-control/resolver.ts`
  - Resolve effective config from global defaults, mode defaults, and task overrides.
- Modify: `apps/api/src/lib/task-store.ts`
  - Freeze resolved slot snapshots into `taskRunConfig` at task creation time.
- Modify: `apps/api/src/index.ts`
  - Add admin routes for provider/model CRUD, validation, defaults, and task launch override support.

### Worker integration

- Modify: `apps/worker/src/lib/providers.ts`
  - Use frozen resolved slot snapshot only; stop depending on static config as authoritative.
- Modify: `apps/worker/src/index.ts`
  - Ensure runtime labels/assets/logging reflect frozen provider/model ids from the control plane.

### Web console

- Modify: `apps/web/src/api.ts`
  - Add types and client calls for provider/model management, validation, defaults, and task override retrieval/submission.
- Modify: `apps/web/src/App.tsx`
  - Add routes for the model management center.
- Create: `apps/web/src/pages/ModelControlCenterPage.tsx`
  - Main admin page for providers, models, validation status, and default resolution management.
- Create: `apps/web/src/pages/ModelProvidersPage.tsx`
  - Provider registry management UI.
- Create: `apps/web/src/pages/ModelRegistryPage.tsx`
  - Model registry management UI.
- Create: `apps/web/src/pages/ModelDefaultsPage.tsx`
  - Global/mode default management UI.
- Modify: `apps/web/src/pages/HomePage.tsx`
  - Add advanced override panel for validated selectable slot models.
- Modify: `apps/web/src/components/AppLayout.tsx`
  - Add navigation entry for the model control center.
- Modify: `apps/web/src/styles.css`
  - Styling for registry tables, validation states, override panel, and precedence summaries.

### Tests

- Create: `tests/unit/api/model-control-registry.test.ts`
- Create: `tests/unit/api/model-control-validation.test.ts`
- Create: `tests/unit/api/model-control-resolver.test.ts`
- Modify: `tests/unit/api/task-store.test.ts`
- Modify: `tests/unit/worker/providers.test.ts`
- Optionally create lightweight web tests only if cheap; otherwise require explicit manual verification steps.

### Docs

- Modify: `docs/handover/项目完整说明.md`
  - Update model/provider management architecture.
- Modify: `docs/handover/仓库交接说明.md`
  - Add model control center reading order.
- Create: `docs/handover/模型控制面使用说明.md`
  - Operator/admin usage guide.

---

## Long Tasks

### Task 1: Define provider/model registry contracts and file persistence

**Files:**
- Create: `packages/shared/src/model-control.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/task-persistence.ts`
- Test: `tests/unit/api/model-control-registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Cover:
- provider record shape
- model record shape
- validation lifecycle defaults
- persisted normalization for legacy/missing fields

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm exec vitest run tests/unit/api/model-control-registry.test.ts`

Expected: FAIL because registry contracts do not exist yet.

- [ ] **Step 3: Implement shared contracts**

Required contracts:
- provider record schema
- model record schema
- validation status enums
- slot type enums for six slots
- default mapping schemas
- task override schemas
- frozen task slot snapshot schemas

- [ ] **Step 4: Implement persistence normalization**

Persist:
- `providers.json`
- `models.json`
- `model-defaults.json`

Rules:
- missing fields normalized
- invalid lifecycle values repaired
- encrypted secrets persisted as ciphertext only

- [ ] **Step 5: Re-run registry tests**

Run: `pnpm exec vitest run tests/unit/api/model-control-registry.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/model-control.ts packages/shared/src/index.ts packages/shared/src/task-persistence.ts tests/unit/api/model-control-registry.test.ts
git commit -m "feat: add model control registry contracts"
```

### Task 2: Implement provider secret encryption and validation primitives

**Files:**
- Create: `apps/api/src/lib/model-control/crypto.ts`
- Create: `apps/api/src/lib/model-control/registry-store.ts`
- Create: `apps/api/src/lib/model-control/validation.ts`
- Test: `tests/unit/api/model-control-validation.test.ts`

- [ ] **Step 1: Write failing validation tests**

Cover:
- provider secrets are encrypted before persistence
- provider validation transitions `draft -> validating -> available/invalid`
- model validation requires available provider
- invalid provider/model stores validation error

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm exec vitest run tests/unit/api/model-control-validation.test.ts`

Expected: FAIL because crypto/validation modules do not exist yet.

- [ ] **Step 3: Implement encryption layer**

Requirements:
- symmetric encryption using a server-side master key env var
- no raw secret ever returned to frontend
- support endpoint + auth material persistence

- [ ] **Step 4: Implement provider/model validation**

Validation should check:
- endpoint syntax
- auth config presence
- authentication success
- provider model existence / acceptance
- slot compatibility and capability metadata completeness

No lightweight generation smoke in this version.

- [ ] **Step 5: Re-run validation tests**

Run: `pnpm exec vitest run tests/unit/api/model-control-validation.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/model-control/crypto.ts apps/api/src/lib/model-control/registry-store.ts apps/api/src/lib/model-control/validation.ts tests/unit/api/model-control-validation.test.ts
git commit -m "feat: add provider encryption and validation primitives"
```

### Task 3: Build the effective resolver and freeze task snapshots

**Files:**
- Create: `apps/api/src/lib/model-control/resolver.ts`
- Modify: `apps/api/src/lib/task-store.ts`
- Modify: `packages/config/src/index.ts`
- Test: `tests/unit/api/model-control-resolver.test.ts`
- Modify: `tests/unit/api/task-store.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Cover precedence:
- task override > mode default > global default
- only `available` models/providers selectable
- frozen snapshot written into task config at create time
- later default changes do not mutate existing tasks

- [ ] **Step 2: Run tests to confirm failure**

Run:
- `pnpm exec vitest run tests/unit/api/model-control-resolver.test.ts`
- `pnpm exec vitest run tests/unit/api/task-store.test.ts`

Expected: FAIL because resolver/freeze snapshot logic does not exist yet.

- [ ] **Step 3: Implement resolver**

Requirements:
- resolve each of the six slots independently
- reject invalid or unavailable overrides
- produce frozen slot snapshot with provider/model ids + labels + capability metadata

- [ ] **Step 4: Update task creation**

`createTask()` must:
- resolve effective slot config
- freeze snapshot into `taskRunConfig`
- stop depending on `MODE_MODELS` as live truth

- [ ] **Step 5: Downgrade config constants to seed/default source**

`packages/config` should become:
- bootstrap seed defaults
- fallback only for first-run initialization

- [ ] **Step 6: Re-run tests**

Run:
- `pnpm exec vitest run tests/unit/api/model-control-resolver.test.ts`
- `pnpm exec vitest run tests/unit/api/task-store.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/model-control/resolver.ts apps/api/src/lib/task-store.ts packages/config/src/index.ts tests/unit/api/model-control-resolver.test.ts tests/unit/api/task-store.test.ts
git commit -m "feat: freeze task model snapshots from effective resolver"
```

### Task 4: Wire worker runtime to the frozen control-plane snapshot

**Files:**
- Modify: `apps/worker/src/lib/providers.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `tests/unit/worker/providers.test.ts`

- [ ] **Step 1: Add failing worker tests**

Cover:
- worker uses frozen slot snapshot rather than static config defaults
- labels/assets/logging reflect frozen provider/model ids
- invalid frozen TTS provider fails explicitly

- [ ] **Step 2: Run worker test and confirm failure**

Run: `pnpm exec vitest run tests/unit/worker/providers.test.ts`

Expected: FAIL on frozen-control-plane assertions.

- [ ] **Step 3: Implement worker-side consumption**

Requirements:
- text/image/video/tts use frozen snapshot only
- no hidden fallback back to `MODE_MODELS` for live routing decisions

- [ ] **Step 4: Re-run worker tests**

Run: `pnpm exec vitest run tests/unit/worker/providers.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lib/providers.ts apps/worker/src/index.ts tests/unit/worker/providers.test.ts
git commit -m "feat: run worker from frozen model control snapshots"
```

### Task 5: Add admin API for providers, models, defaults, and validation

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/web/src/api.ts`
- Reuse: `apps/api/src/lib/model-control/registry-store.ts`
- Test: extend `tests/unit/api/model-control-registry.test.ts`

- [ ] **Step 1: Add failing API tests or explicit route checks**

Cover:
- create provider
- validate provider
- create model
- validate model
- set global defaults
- set mode defaults
- list only `available` models for task-creation overrides

- [ ] **Step 2: Implement API routes**

Required route groups:
- `/api/model-control/providers`
- `/api/model-control/models`
- `/api/model-control/defaults`
- `/api/model-control/validation`
- `/api/model-control/selectable`

- [ ] **Step 3: Keep secrets server-only**

Frontend responses may expose masked indicators, never raw encrypted/plain values.

- [ ] **Step 4: Re-run focused tests**

Run:
- `pnpm exec vitest run tests/unit/api/model-control-registry.test.ts tests/unit/api/model-control-validation.test.ts tests/unit/api/model-control-resolver.test.ts`
- `pnpm --filter @genergi/api typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts apps/web/src/api.ts tests/unit/api/model-control-registry.test.ts tests/unit/api/model-control-validation.test.ts tests/unit/api/model-control-resolver.test.ts
git commit -m "feat: add model control plane api"
```

### Task 6: Build the model control center UI/UX

**Files:**
- Create: `apps/web/src/pages/ModelControlCenterPage.tsx`
- Create: `apps/web/src/pages/ModelProvidersPage.tsx`
- Create: `apps/web/src/pages/ModelRegistryPage.tsx`
- Create: `apps/web/src/pages/ModelDefaultsPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Build provider management UI**

Requirements:
- create/edit provider
- endpoint + auth config input
- masked secret display
- validation status panel
- enable/disable actions

- [ ] **Step 2: Build model registry UI**

Requirements:
- create/edit model
- bind to provider
- assign slot type
- display lifecycle/validation state
- display capability metadata

- [ ] **Step 3: Build defaults center**

Requirements:
- global defaults per slot
- mode defaults per slot
- explicit precedence explanation

- [ ] **Step 4: Route and navigation integration**

Add:
- nav entry for model control center
- route(s) in app shell

- [ ] **Step 5: Run web checks**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ModelControlCenterPage.tsx apps/web/src/pages/ModelProvidersPage.tsx apps/web/src/pages/ModelRegistryPage.tsx apps/web/src/pages/ModelDefaultsPage.tsx apps/web/src/App.tsx apps/web/src/components/AppLayout.tsx apps/web/src/styles.css
git commit -m "feat: add model control center ui"
```

### Task 7: Add task-launch advanced override UX

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add advanced override panel**

Requirements:
- hidden/collapsible advanced area
- slot-by-slot validated model selection
- clear “默认 / 已覆盖” visual state
- only selectable `available` models appear

- [ ] **Step 2: Show effective summary**

Users should see:
- current mode defaults
- which slots are overridden
- final effective choices before task creation

- [ ] **Step 3: Submit task overrides**

Task create payload must carry only the chosen overrides; server resolves and freezes.

- [ ] **Step 4: Run web checks**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/HomePage.tsx apps/web/src/api.ts apps/web/src/styles.css
git commit -m "feat: add advanced model override launch flow"
```

### Task 8: Docs, migration verification, and rollout

**Files:**
- Modify: `docs/handover/项目完整说明.md`
- Modify: `docs/handover/仓库交接说明.md`
- Create: `docs/handover/模型控制面使用说明.md`
- Verify app files as needed

- [ ] **Step 1: Document the new control plane**

Must describe:
- provider lifecycle
- model lifecycle
- default precedence
- task snapshot freezing
- operator usage

- [ ] **Step 2: Run full relevant validation**

Run:
- `pnpm exec vitest run tests/unit/api/model-control-registry.test.ts tests/unit/api/model-control-validation.test.ts tests/unit/api/model-control-resolver.test.ts tests/unit/api/task-store.test.ts tests/unit/worker/providers.test.ts`
- `pnpm --filter @genergi/web typecheck && pnpm --filter @genergi/web build`
- `pnpm --filter @genergi/api typecheck && pnpm --filter @genergi/api build`
- `pnpm --filter @genergi/worker typecheck && pnpm --filter @genergi/worker build`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/handover/项目完整说明.md docs/handover/仓库交接说明.md docs/handover/模型控制面使用说明.md
git commit -m "docs: add model control plane handoff guides"
```

---

## Manual Acceptance Criteria

This project is only complete when all of the following are true:

- admin can create a provider and save encrypted credentials
- provider validation can move a provider into `available`
- admin can create a model, validate it, and see it enter the selectable pool automatically
- global defaults can be changed without code edits
- mode defaults can be changed without code edits
- task creation can override any of the six slots from validated models
- task creation freezes the resolved snapshot
- later default changes do not mutate existing tasks
- worker runs from the frozen snapshot
- web/admin UI is understandable and production-usable

## Risks And Guardrails

- Do not allow raw provider secrets to leak into frontend responses.
- Do not make live runtime depend on static `MODE_MODELS` after the registry is initialized.
- Do not allow `draft/invalid/disabled` providers/models into the selectable pool.
- Do not let task creation store only aliases; it must store a reproducible frozen snapshot.
- Keep the first version control-plane focused; do not quietly introduce a full gateway service.

