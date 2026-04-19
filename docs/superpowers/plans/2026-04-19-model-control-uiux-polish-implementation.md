# GENERGI Model Control UI/UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the app shell and model control plane experience so the UI feels like a mature SaaS control console without changing model-control behavior.

**Architecture:** Keep all business logic intact and concentrate changes in the shell, model-control pages, and shared web styling. Treat this as a presentation-layer refactor: navigation structure, content hierarchy, spacing, states, and interaction polish.

**Tech Stack:** React, React Router, TypeScript, existing GENERGI CSS system

---

## File Structure

- Modify: `apps/web/src/components/AppLayout.tsx`
  - Rework shell structure, navigation grouping, footer behavior, and contextual toolbar actions.
- Modify: `apps/web/src/styles.css`
  - Central styling changes for sidebar, toolbar, control-center surfaces, forms, registry cards, defaults rows, and advanced override panel.
- Modify: `apps/web/src/pages/ModelControlCenterPage.tsx`
  - Reframe overview hierarchy and recent panels.
- Modify: `apps/web/src/pages/ModelProvidersPage.tsx`
  - Improve provider form grouping, scanability, and action emphasis.
- Modify: `apps/web/src/pages/ModelRegistryPage.tsx`
  - Improve registry cards, filtering, and capability metadata presentation.
- Modify: `apps/web/src/pages/ModelDefaultsPage.tsx`
  - Improve default matrix readability and control density.
- Modify: `apps/web/src/pages/HomePage.tsx`
  - Refine advanced override panel layout, summaries, and loading/disabled feedback.
- Optional light modify: `apps/web/src/App.tsx`
  - Only if route wrapper adjustments are needed for the refined shell.

---

## Task 1: Refactor the app shell so navigation is top-anchored and grouped

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Rework sidebar markup into brand / nav groups / footer**

Update `AppLayout.tsx` so the sidebar contains:
- brand block
- grouped nav sections
- lightweight footer/utility area

- [ ] **Step 2: Remove the structural dependence on `space-between`**

Update sidebar CSS so navigation naturally flows from the top and the footer no longer forces the nav to sit in the middle of the screen.

- [ ] **Step 3: Introduce clear nav grouping**

Split nav items into:
- `生产工作区`
- `系统管理`

- [ ] **Step 4: Strengthen active-state styling**

Add:
- clearer active background
- left accent rail
- calmer hover state

- [ ] **Step 5: Move or lighten the “return/new task” action**

Ensure contextual task-entry action no longer distorts sidebar layout.

- [ ] **Step 6: Run shell verification**

Run:
- `pnpm --filter @genergi/web typecheck`

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/AppLayout.tsx apps/web/src/styles.css
git commit -m "feat: polish shell navigation hierarchy"
```

## Task 2: Rebuild model control overview hierarchy

**Files:**
- Modify: `apps/web/src/pages/ModelControlCenterPage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Reframe overview hero and metric band**

Make the top section read like a control console summary rather than a generic page header.

- [ ] **Step 2: Improve workflow card hierarchy**

Give the three step cards stronger visual structure and more deliberate spacing/ordering.

- [ ] **Step 3: Improve precedence explanation strip**

Make precedence blocks easier to scan and visually more “system rule” than “marketing card”.

- [ ] **Step 4: Improve defaults summary matrix**

Make six-slot summary more readable with clearer row structure and less wall-of-text feel.

- [ ] **Step 5: Fix recent activity visual ordering and weight**

Keep the data ordering behavior intact while making these panels visually lighter and easier to scan.

- [ ] **Step 6: Run web verification**

Run:
- `pnpm --filter @genergi/web typecheck`

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/ModelControlCenterPage.tsx apps/web/src/styles.css
git commit -m "feat: polish model control overview"
```

## Task 3: Refine Provider and Model management pages for operator speed

**Files:**
- Modify: `apps/web/src/pages/ModelProvidersPage.tsx`
- Modify: `apps/web/src/pages/ModelRegistryPage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Re-group provider form structure**

Visually cluster:
- identity
- connection
- secret
- lifecycle

- [ ] **Step 2: Improve provider list/table readability**

Make endpoint, secret status, validation status, and actions faster to scan.

- [ ] **Step 3: Refine model form density and hierarchy**

Reduce noise around slot/provider/model metadata and make capability JSON area feel intentional instead of tacked on.

- [ ] **Step 4: Improve registry card readability**

Make slot ownership, provider binding, and capability chips easier to parse at speed.

- [ ] **Step 5: Normalize action button hierarchy**

Ensure edit / validate / disable / deprecate read as primary-secondary-dangerously enough without visual chaos.

- [ ] **Step 6: Run web verification**

Run:
- `pnpm --filter @genergi/web typecheck`

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/ModelProvidersPage.tsx apps/web/src/pages/ModelRegistryPage.tsx apps/web/src/styles.css
git commit -m "feat: refine provider and model management surfaces"
```

## Task 4: Refine Defaults Center and task advanced override experience

**Files:**
- Modify: `apps/web/src/pages/ModelDefaultsPage.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Improve Defaults Center row hierarchy**

Make global vs mode defaults easier to compare visually without changing behavior.

- [ ] **Step 2: Reduce repetitive visual fatigue**

Improve spacing, labels, and supporting text so repeated slot rows remain readable.

- [ ] **Step 3: Polish advanced override panel**

Make the panel feel like a deliberate expert workflow:
- better summary hierarchy
- clearer selector rows
- clearer state transitions for default / overridden / effective

- [ ] **Step 4: Improve disabled/loading feedback**

Ensure action states are easy to understand during selectable-pool refreshes and task submission.

- [ ] **Step 5: Run web build verification**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ModelDefaultsPage.tsx apps/web/src/pages/HomePage.tsx apps/web/src/styles.css
git commit -m "feat: polish defaults and advanced override ux"
```

## Task 5: Manual browser walkthrough and live visual acceptance

**Files:**
- Verify only: `apps/web/src/components/AppLayout.tsx`
- Verify only: `apps/web/src/pages/ModelControlCenterPage.tsx`
- Verify only: `apps/web/src/pages/ModelProvidersPage.tsx`
- Verify only: `apps/web/src/pages/ModelRegistryPage.tsx`
- Verify only: `apps/web/src/pages/ModelDefaultsPage.tsx`
- Verify only: `apps/web/src/pages/HomePage.tsx`

- [ ] **Step 1: Walk through local browser flows**

Check:
- shell/sidebar
- overview
- providers
- registry
- defaults
- advanced override panel

- [ ] **Step 2: Run final web verification**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected:
- PASS

- [ ] **Step 3: Deploy and verify live pages**

Verify on live:
- home shell
- model control overview
- provider page
- registry page
- defaults page

- [ ] **Step 4: Commit any final polish**

```bash
git add apps/web/src/components/AppLayout.tsx apps/web/src/pages apps/web/src/styles.css
git commit -m "feat: finalize model control ui polish"
```

---

## Manual Acceptance Criteria

This polish pass is complete only when:

- sidebar no longer appears vertically centered in empty space
- nav grouping is obvious and improves scanability
- toolbar/context actions feel more intentional
- model control overview reads like a real SaaS control console
- provider/model/default pages feel faster and calmer to operate
- advanced override panel feels premium and deliberate
- no backend behavior changed
- `web` typecheck/build pass
- live browser walkthrough confirms the improvement
