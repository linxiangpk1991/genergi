# GENERGI V2 Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the current project into GENERGI 自动化视频平台 V2 by establishing the runtime foundation, version-management controls, scoped orchestration shell, public-safe configuration model, and the Phase 1 UI design baseline.

**Architecture:** Use Electron as the operator console, introduce a main-process orchestrator with a background job runner boundary, and rebuild the business model around Task, Stage, Scene, Asset, and Cost as first-class concepts. Phase 1 intentionally stops short of the full batch factory and instead locks the contracts, persistence, UI direction, and migration controls required for later phases.

**Tech Stack:** Electron 41.x target, Node 24 LTS for development, Vue 3 + Vite 7, SQLite, better-sqlite3 12.x target, FFmpeg, Anthropic-compatible text provider registry, Gemini/Veo-compatible image/video registry, Google Cloud TTS or Azure AI Speech, Stitch MCP for design baseline.

---

## Scope Note

The redesign spec covers multiple independent subsystems. This plan intentionally covers only **Phase 1**:
- runtime modernization foundation
- version management and migration controls
- canonical model/mode registry shell
- orchestrator/state-machine/budget shell
- scoped preload contract
- GENERGI UI direction and design baseline using Stitch
- public-open-source-safe configuration examples
- packaged ABI verification baseline

Later phases require separate follow-up plans:
- Phase 2 workflow replacement
- Phase 3 media modernization
- Phase 4 batch scheduler and budget pool
- Phase 5 publishing and feedback loop

## File Structure

### Existing files to modify in Phase 1
- `package.json`
- `electron/main.ts`
- `electron/preload.ts`
- `electron/ipc.ts`
- `electron/electron-env.d.ts`
- `electron/sqlite/index.ts`
- `scripts/before-pack.js`
- `src/store/app.ts`
- `src/views/Home/index.vue`
- `src/views/Home/components/TextGenerate.vue`
- `src/views/Home/components/TtsControl.vue`
- `src/views/Home/components/VideoRender.vue`
- `README.md`
- `src/lib/render-pipeline-persistence.ts`

### New files to create in Phase 1
- `scripts/check-packaged-abi.ps1`
- `docs/architecture/versioning-strategy.md`
- `docs/architecture/commenting-standard.md`
- `docs/architecture/ui-direction.md`
- `docs/architecture/ui-baseline-manifest.md`
- `docs/architecture/deployment-baseline.md`
- `electron/services/versioning/schema-version.ts`
- `electron/services/versioning/config-version.ts`
- `electron/services/versioning/feature-flags.ts`
- `electron/services/versioning/migrations.ts`
- `electron/services/models/types.ts`
- `electron/services/models/registry.ts`
- `electron/services/modes/types.ts`
- `electron/services/modes/registry.ts`
- `electron/services/orchestrator/types.ts`
- `electron/services/orchestrator/task-run-config.ts`
- `electron/services/orchestrator/state-machine.ts`
- `electron/services/orchestrator/budget.ts`
- `electron/services/orchestrator/review-policy.ts`
- `electron/services/orchestrator/background-runner.ts`
- `electron/services/tasks/repository.ts`
- `electron/services/tasks/scene-repository.ts`
- `electron/services/tasks/cost-repository.ts`
- `electron/services/tasks/task-run-config-store.ts`
- `electron/services/tasks/lookup-repository.ts`
- `src/features/modes/ModePicker.vue`
- `src/features/modes/ModeOverridePanel.vue`
- `src/features/costs/CostEstimatePanel.vue`
- `src/features/review/StoryboardReviewShell.vue`
- `src/features/review/KeyframeReviewShell.vue`
- `.env.example`
- `provider.example.json`
- `mode.example.json`

### Tests to create in Phase 1
- `tests/unit/versioning/versioning.test.ts`
- `tests/unit/models/model-registry.test.ts`
- `tests/unit/modes/task-run-config.test.ts`
- `tests/unit/orchestrator/state-machine.test.ts`
- `tests/unit/orchestrator/budget.test.ts`
- `tests/integration/preload/preload-contract.test.ts`
- `tests/integration/sqlite/v2-schema.test.ts`
- `tests/integration/sqlite/packaged-abi-check.test.ts`
- `tests/integration/ui/genergi-home-shell.test.ts`

## Version Management Rules

- Every schema change must increment `SCHEMA_VERSION` and be registered in `electron/services/versioning/migrations.ts`.
- Every runtime config structure change must increment `CONFIG_VERSION`.
- Every temporary compatibility bridge must be guarded by a feature flag and documented with a removal condition.
- `model_registry` is the only source of truth for runnable model IDs.
- Mode definitions may only reference `model_registry.id`, never raw provider strings.
- `task_run_config_json` must persist the resolved `model_registry.id` values used at task admission.
- Historical task config and cost ledger rows are immutable after creation.
- Any rollback path must be documented before implementation starts for that migration step.

## Code Commenting Rules

- Add succinct comments only where logic is stateful, contract-heavy, or non-obvious.
- Required comment zones in Phase 1:
  - schema/config version compatibility branches
  - canonical model pinning and alias mapping
  - mode override precedence
  - task admission and frozen config generation
  - state transition guards
  - budget reservation / release semantics
  - preload security boundaries
  - migration compatibility branches
- Do not add comments that simply restate syntax or obvious assignments.
- Any temporary compatibility path must include a comment stating when it can be safely removed.

## Task 1: Add the Phase 1 test harness

**Files:**
- Modify: `package.json`
- Create: `tests/unit/versioning/versioning.test.ts`
- Create: `tests/unit/models/model-registry.test.ts`
- Create: `tests/unit/modes/task-run-config.test.ts`
- Create: `tests/unit/orchestrator/state-machine.test.ts`
- Create: `tests/unit/orchestrator/budget.test.ts`
- Create: `tests/integration/preload/preload-contract.test.ts`
- Create: `tests/integration/sqlite/v2-schema.test.ts`
- Create: `tests/integration/sqlite/packaged-abi-check.test.ts`
- Create: `tests/integration/ui/genergi-home-shell.test.ts`

- [ ] **Step 1: Add a test runner dependency and script to `package.json`**

Target additions:
```json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.2.0",
    "@testing-library/vue": "^8.1.0",
    "jsdom": "^26.0.0"
  }
}
```

- [ ] **Step 2: Write one minimal failing versioning test**

```ts
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, CONFIG_VERSION } from '../../../electron/services/versioning/schema-version'

describe('versioning bootstrap', () => {
  it('exports positive schema and config versions', () => {
    expect(SCHEMA_VERSION).toBeGreaterThan(0)
    expect(CONFIG_VERSION).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Add placeholder failing imports for all remaining Phase 1 areas**

Required failing coverage areas:
- model registry
- task-run config
- state machine
- budget semantics
- preload contract
- sqlite schema
- packaged ABI verification
- GENERGI home shell

- [ ] **Step 4: Run the full test command to verify the harness fails cleanly**

Run: `pnpm test`
Expected: FAIL because the V2 foundation modules do not exist yet.

- [ ] **Step 5: Commit**

```bash
git add package.json tests
git commit -m "test: add GENERGI V2 Phase 1 test harness"
```

## Task 2: Implement versioning and migration controls

**Files:**
- Create: `docs/architecture/versioning-strategy.md`
- Create: `electron/services/versioning/schema-version.ts`
- Create: `electron/services/versioning/config-version.ts`
- Create: `electron/services/versioning/feature-flags.ts`
- Create: `electron/services/versioning/migrations.ts`
- Modify: `electron/sqlite/index.ts`
- Test: `tests/unit/versioning/versioning.test.ts`
- Test: `tests/integration/sqlite/v2-schema.test.ts`

- [ ] **Step 1: Implement schema/config version constants and feature flags**

Required exports:
```ts
export const SCHEMA_VERSION = 1
export const CONFIG_VERSION = 1
export const FEATURE_FLAGS = {
  use_v2_orchestrator: false,
  use_business_scoped_preload: false,
  use_new_tts_provider: false,
  use_template_composition_layer: false,
} as const
```

- [ ] **Step 2: Implement migration descriptors with rollback metadata**

Required shape:
```ts
export interface MigrationStep {
  version: number
  applySql: string[]
  rollbackNote: string
}
```

- [ ] **Step 3: Update SQLite bootstrap to consult the migration registry**

Implementation notes:
- Add a schema metadata table.
- Keep legacy task/checkpoint tables untouched in Phase 1.
- Add a comment explaining why schema versioning and config versioning are separate.

- [ ] **Step 4: Write `docs/architecture/versioning-strategy.md`**

Must include:
- schema vs config version split
- feature-flag transition policy
- rollback expectations
- immutable task/cost record rule

- [ ] **Step 5: Run versioning and schema tests**

Run: `pnpm exec vitest run tests/unit/versioning/versioning.test.ts tests/integration/sqlite/v2-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/versioning-strategy.md electron/services/versioning electron/sqlite/index.ts tests/unit/versioning/versioning.test.ts tests/integration/sqlite/v2-schema.test.ts
git commit -m "feat: add GENERGI V2 versioning and migration controls"
```

## Task 3: Add canonical model and mode registries

**Files:**
- Create: `electron/services/models/types.ts`
- Create: `electron/services/models/registry.ts`
- Create: `electron/services/modes/types.ts`
- Create: `electron/services/modes/registry.ts`
- Modify: `src/store/app.ts`
- Test: `tests/unit/models/model-registry.test.ts`
- Test: `tests/unit/modes/task-run-config.test.ts`

- [ ] **Step 1: Define canonical model registry types**

Required shape:
```ts
export interface RegisteredModel {
  id: string
  canonicalModelId: string
  localAlias: string
  lifecycleStatus: 'active' | 'deprecated' | 'blocked' | 'experimental'
  pinSource: 'official' | 'provider_verified' | 'manual_mapping'
  fallbackModelRegistryId?: string
  introducedAt: string
  deprecatedAt?: string
  capabilityFlags: Record<string, string | number | boolean>
}
```

- [ ] **Step 2: Define built-in mode presets**

Required initial IDs:
- `mass_production`
- `high_quality`

Each mode must reference registry IDs only.

- [ ] **Step 3: Update `src/store/app.ts` to support mode selection and advanced overrides**

Implementation notes:
- Add mode selection state.
- Add explicit override fields instead of only the legacy model triplets.
- Keep current legacy model fields only long enough to bridge Phase 1.

- [ ] **Step 4: Add contract comments in registry code**

Required comment topics:
- why `portrait`, `2k`, and `hd` are capability flags rather than primary keys
- why mode definitions cannot store raw provider model strings
- why canonical and local model IDs are both needed
- why pin-source metadata and fallback IDs are required for safe rollback

- [ ] **Step 5: Run model and mode tests**

Run: `pnpm exec vitest run tests/unit/models/model-registry.test.ts tests/unit/modes/task-run-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/models electron/services/modes src/store/app.ts tests/unit/models/model-registry.test.ts tests/unit/modes/task-run-config.test.ts
git commit -m "feat: add canonical model and mode registries for GENERGI V2"
```

## Task 4: Implement frozen task-run config, state machine, and budget shell

**Files:**
- Create: `electron/services/orchestrator/types.ts`
- Create: `electron/services/orchestrator/task-run-config.ts`
- Create: `electron/services/orchestrator/state-machine.ts`
- Create: `electron/services/orchestrator/budget.ts`
- Create: `electron/services/orchestrator/review-policy.ts`
- Test: `tests/unit/modes/task-run-config.test.ts`
- Test: `tests/unit/orchestrator/state-machine.test.ts`
- Test: `tests/unit/orchestrator/budget.test.ts`

- [ ] **Step 1: Implement task-run config freezing from mode + overrides**

Required fields:
- `modeId`
- resolved registry-backed text/image/video model IDs
- review policy
- budget policy
- export policy
- `frozenAt`

- [ ] **Step 2: Implement legal task and stage transitions**

Minimum task states:
- `draft`
- `queued`
- `running`
- `waiting_review`
- `paused`
- `failed`
- `completed`
- `canceled`

- [ ] **Step 3: Implement reservation, spend, release, and retry semantics**

Required helper functions:
```ts
reserveBudget()
realizeSpend()
releaseBudget()
appendRetryCost()
```

- [ ] **Step 4: Add comments for task admission and budget semantics**

Required topics:
- why runtime config freezes at admission time
- why budget reserves before expensive stages
- why retries append instead of mutating cost history

- [ ] **Step 5: Run task-run config, state machine, and budget tests**

Run: `pnpm exec vitest run tests/unit/modes/task-run-config.test.ts tests/unit/orchestrator/state-machine.test.ts tests/unit/orchestrator/budget.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/orchestrator tests/unit/modes/task-run-config.test.ts tests/unit/orchestrator/state-machine.test.ts tests/unit/orchestrator/budget.test.ts
git commit -m "feat: add GENERGI V2 task config, state machine, and budget shell"
```

## Task 5: Rebuild the V2 persistence schema and task-run-config storage

**Files:**
- Create: `electron/services/tasks/repository.ts`
- Create: `electron/services/tasks/scene-repository.ts`
- Create: `electron/services/tasks/cost-repository.ts`
- Create: `electron/services/tasks/task-run-config-store.ts`
- Create: `electron/services/tasks/lookup-repository.ts`
- Modify: `electron/sqlite/index.ts`
- Modify: `src/lib/render-pipeline-persistence.ts`
- Test: `tests/integration/sqlite/v2-schema.test.ts`

- [ ] **Step 1: Add V2 core schema definitions**

Required core tables:
- `workflow_tasks`
- `workflow_stage_runs`
- `storyboard_scenes`
- `asset_records`
- `cost_ledger_entries`

Required Phase 1 lookup/config tables:
- `channel_profiles`
- `brand_kits`
- `batch_jobs`
- `batch_job_items`

- [ ] **Step 2: Persist the frozen `task_run_config_json` in the task layer**

Implementation notes:
- Persist resolved `model_registry.id` values at task admission.
- Do not let renderer-side state remain the source of truth.

- [ ] **Step 3: Keep current legacy task/checkpoint tables readable**

Implementation notes:
- Do not delete or rewrite legacy tables in Phase 1.
- Mark them as compatibility-only in comments.

- [ ] **Step 4: Implement repository helpers for the core V2 entities**

Required responsibilities:
- task create / update / fetch
- task run config persist / fetch
- scene create / update / fetch
- cost ledger append / summarize

- [ ] **Step 5: Run schema tests**

Run: `pnpm exec vitest run tests/integration/sqlite/v2-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/tasks electron/sqlite/index.ts src/lib/render-pipeline-persistence.ts tests/integration/sqlite/v2-schema.test.ts
git commit -m "feat: add GENERGI V2 persistence foundation"
```

## Task 6: Add Phase 1 lookup repositories and legacy compatibility checks

**Files:**
- Create: `electron/services/tasks/lookup-repository.ts`
- Modify: `electron/sqlite/index.ts`
- Modify: `src/lib/render-pipeline-persistence.ts`
- Test: `tests/integration/sqlite/v2-lookup-schema.test.ts`

- [ ] **Step 1: Add Phase 1 lookup/config tables for `channel_profiles`, `brand_kits`, `batch_jobs`, and `batch_job_items`**

- [ ] **Step 2: Write a failing lookup schema test and run it to verify it fails**

Run: `pnpm exec vitest run tests/integration/sqlite/v2-lookup-schema.test.ts`
Expected: FAIL because the lookup schema does not exist yet.

- [ ] **Step 3: Implement lookup repository helpers and mark legacy persistence as compatibility-only**

Implementation notes:
- Add explicit comments describing which legacy persistence helpers may be removed after Phase 2.
- Keep read access for old task/checkpoint data.

- [ ] **Step 4: Run the lookup schema test**

Run: `pnpm exec vitest run tests/integration/sqlite/v2-lookup-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/tasks/lookup-repository.ts electron/sqlite/index.ts src/lib/render-pipeline-persistence.ts tests/integration/sqlite/v2-lookup-schema.test.ts
git commit -m "feat: add GENERGI V2 lookup schema and compatibility bridge"
```

## Task 7: Scope preload and IPC to business APIs with a compatibility bridge

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron/ipc.ts`
- Modify: `electron/electron-env.d.ts`
- Modify: `electron/main.ts`
- Test: `tests/integration/preload/preload-contract.test.ts`

- [ ] **Step 1: Define the business-scoped preload contract**

Required groups:
- task launch
- registry lookup
- cost estimate
- review submit
- task status monitoring

- [ ] **Step 2: Keep a temporary compatibility bridge behind a feature flag**

Implementation notes:
- Existing UI paths may temporarily keep working.
- New V2 code must not depend on generic `window.ipcRenderer`.

- [ ] **Step 3: Tighten `electron/main.ts` security defaults where possible without breaking Phase 1**

Implementation notes:
- Every temporary unsafe holdover must get a removal-condition comment.
- Do not remove critical compatibility behavior without a bridge.

- [ ] **Step 4: Run preload contract tests**

Run: `pnpm exec vitest run tests/integration/preload/preload-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts electron/ipc.ts electron/electron-env.d.ts electron/main.ts tests/integration/preload/preload-contract.test.ts
git commit -m "feat: scope preload and IPC for GENERGI V2"
```

## Task 8: Lock the GENERGI UI direction and design baseline using Stitch

**Files:**
- Create: `docs/architecture/ui-direction.md`
- Create: `docs/architecture/ui-baseline-manifest.md`
- Create or update via Stitch: design system and key screens
- Modify: `README.md`

- [ ] **Step 1: Write `docs/architecture/ui-direction.md`**

Must describe:
- main product display name: `GENERGI 自动化视频平台`
- brand relationship: `GENERGI` product, `Genergius` company/domain layer
- primary entrypoint domain: `ai.genergius.com`
- overall tone: professional control center + visually stronger review/workbench screens
- homepage default: task launch workspace
- key screens locked in Phase 1

- [ ] **Step 2: Use Stitch to create the design system and key screen prototypes**

Required outputs:
- GENERGI design system baseline
- task launch home shell
- mode and override shell
- storyboard review shell
- keyframe review shell
- cost / budget panel direction

- [ ] **Step 3: Export or capture baseline artifacts**

Required outputs:
- persisted artifact references
- screenshot export or manifest entries in `docs/architecture/ui-baseline-manifest.md`
- note of which screens are baseline-locked vs exploratory

- [ ] **Step 4: Commit the design baseline artifacts**

```bash
git add docs/architecture/ui-direction.md docs/architecture/ui-baseline-manifest.md README.md
git commit -m "design: lock GENERGI V2 Phase 1 UI baseline"
```

## Task 9: Implement the minimal GENERGI mode-first UI shell

**Files:**
- Create: `src/features/modes/ModePicker.vue`
- Create: `src/features/modes/ModeOverridePanel.vue`
- Create: `src/features/costs/CostEstimatePanel.vue`
- Create: `src/features/review/StoryboardReviewShell.vue`
- Create: `src/features/review/KeyframeReviewShell.vue`
- Modify: `src/views/Home/index.vue`
- Modify: `src/views/Home/components/TextGenerate.vue`
- Modify: `src/views/Home/components/TtsControl.vue`
- Modify: `src/views/Home/components/VideoRender.vue`
- Test: `tests/integration/ui/genergi-home-shell.test.ts`

- [ ] **Step 1: Write the failing UI shell test**

```ts
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/vue'
import Home from '../../../src/views/Home/index.vue'

describe('GENERGI home shell', () => {
  it('shows the GENERGI product name and a mode-first launch workflow', () => {
    const { getByText, container } = render(Home)
    expect(getByText('GENERGI 自动化视频平台')).toBeTruthy()
    expect(getByText('量产模式')).toBeTruthy()
    expect(getByText('高质量模式')).toBeTruthy()
    expect(container.querySelector('[data-testid="mode-picker"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="cost-estimate-panel"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="mode-override-panel"]')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the UI shell test to verify it fails**

Run: `pnpm exec vitest run tests/integration/ui/genergi-home-shell.test.ts`
Expected: FAIL because the GENERGI shell does not exist yet.

- [ ] **Step 3: Implement the minimal GENERGI launch shell**

Implementation requirements:
- Rebrand only the display name, not package IDs.
- Add mode selection and advanced override controls.
- Add preflight cost estimate panel placeholder wired to V2 architecture.
- Add storyboard and keyframe review shell components as visible placeholders.
- Follow the Stitch baseline rather than inventing a new layout during implementation.
- Keep implementation minimal; do not rewrite unrelated legacy components unless necessary for the shell.

- [ ] **Step 4: Add one structural or snapshot-style baseline assertion**

In addition to text assertions, add one structural or snapshot-style check that guards:
- layout regions for mode picker, override panel, and cost panel
- existence of review shell containers
- preservation of the Phase 1 screen hierarchy locked by Stitch

- [ ] **Step 5: Write `docs/architecture/commenting-standard.md`**

Must include:
- where comments are required
- where comments are noise
- examples for state machine, budget, provider, preload, migration, and render normalization comments

- [ ] **Step 6: Run the UI shell test**

Run: `pnpm exec vitest run tests/integration/ui/genergi-home-shell.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/commenting-standard.md src/features src/views/Home tests/integration/ui/genergi-home-shell.test.ts
git commit -m "feat: add GENERGI V2 mode-first UI shell"
```

## Task 10: Add packaged-build and ABI verification baseline

**Files:**
- Create: `docs/architecture/deployment-baseline.md`
- Create: `scripts/check-packaged-abi.ps1`
- Modify: `package.json`
- Modify: `scripts/before-pack.js`
- Test: `tests/integration/sqlite/packaged-abi-check.test.ts`

- [ ] **Step 1: Write the failing packaged ABI verification test**

```ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

describe('packaged abi verification', () => {
  it('ships a packaged ABI verification script and deployment baseline doc', () => {
    expect(fs.existsSync('scripts/check-packaged-abi.ps1')).toBe(true)
    expect(fs.existsSync('docs/architecture/deployment-baseline.md')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the ABI verification test to verify it fails**

Run: `pnpm exec vitest run tests/integration/sqlite/packaged-abi-check.test.ts`
Expected: FAIL because the packaged ABI helper does not exist yet.

- [ ] **Step 3: Write `docs/architecture/deployment-baseline.md`**

Must include:
- primary runtime domain: `ai.genergius.com`
- server reuse strategy on the shared host
- recommended isolated directory layout under `/opt/genergi/`
- packaged build verification matrix by platform
- explicit `better-sqlite3` ABI load check expectations
- rollback notes for packaged runtime failures

- [ ] **Step 4: Add documented or scripted packaged verification targets**

Minimum targets:
- Windows packaged build smoke
- Linux packaged build smoke
- macOS packaging verification note if not executed locally

Required implementation:
- create `scripts/check-packaged-abi.ps1`
- define a packaged smoke sequence that launches the packaged app
- include an explicit `better-sqlite3` load check in the packaged runtime
- define pass/fail criteria for each target in `docs/architecture/deployment-baseline.md`

- [ ] **Step 5: Run the ABI test**

Run: `pnpm exec vitest run tests/integration/sqlite/packaged-abi-check.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the packaged smoke procedure for each declared target**

Required result:
- record whether `better-sqlite3` opens successfully in the packaged runtime
- record which targets were executed directly and which were documented-only
- fail Phase 1 if the declared primary target cannot load the packaged DB runtime

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/deployment-baseline.md scripts/check-packaged-abi.ps1 package.json scripts/before-pack.js tests/integration/sqlite/packaged-abi-check.test.ts
git commit -m "build: add GENERGI packaged ABI verification baseline"
```

## Task 11: Add public-open-source-safe configuration artifacts

**Files:**
- Create: `.env.example`
- Create: `provider.example.json`
- Create: `mode.example.json`
- Modify: `README.md`

- [ ] **Step 1: Add `.env.example` with provider secret placeholders**

Required entries:
```env
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
```

- [ ] **Step 2: Add `provider.example.json` and `mode.example.json`**

Requirements:
- No live API keys.
- No private endpoint secrets.
- Example model selections must reference logical registry-backed names.

- [ ] **Step 3: Update README to explain public configuration and GENERGI branding**

README must clarify:
- `GENERGI 自动化视频平台` is the product display name.
- `ai.genergius.com` is the intended primary deployment entrypoint.
- internal package names may remain unchanged initially.
- real provider credentials must stay out of the repository.

- [ ] **Step 4: Run a quick existence check**

Run: `powershell -Command "Test-Path .env.example; Test-Path provider.example.json; Test-Path mode.example.json"`
Expected: `True` for all three files.

- [ ] **Step 5: Commit**

```bash
git add .env.example provider.example.json mode.example.json README.md
git commit -m "docs: add public-safe GENERGI V2 config examples"
```

## Milestones

### Milestone A: Runtime and governance baseline
- Task 1
- Task 2
- Task 3
- Task 4

### Milestone B: Persistence and security boundary
- Task 5
- Task 6

### Milestone C: UI direction locked in Phase 1
- Task 8
- Task 9

### Milestone D: Packaged verification and public repository hygiene
- Task 10
- Task 11

## Verification Before Leaving Phase 1

Run these checks before declaring Phase 1 complete:
- `pnpm test`
- `pnpm exec vue-tsc --noEmit`
- development-mode Electron boot smoke
- packaged ABI verification for each declared target in `docs/architecture/deployment-baseline.md`
- one synthetic V2 task creation flow through the new mode-first UI shell
- one schema migration smoke test against a fresh local SQLite DB
- one legacy compatibility smoke check confirming old task data remains readable
