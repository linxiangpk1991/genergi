# GENERGI Help Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class in-product Help Center for internal operators, with workflow learning, feature lookup, polished visual flow components, and a timeline-style release updates page.

**Architecture:** Keep the first version frontend- and content-owned. Add a new Help Center module under the existing web console, backed by structured local content files for workflows, features, and releases. Reuse the current app shell and visual language, but introduce dedicated help layout and diagram components so the center feels like a product module, not a markdown viewer.

**Tech Stack:** React, React Router, TypeScript, existing GENERGI web styling, structured local content modules

---

## File Structure

### Routing and shell integration

- Modify: `apps/web/src/App.tsx`
  - Add Help Center routes.
- Modify: `apps/web/src/components/AppLayout.tsx`
  - Add `帮助中心` to system navigation and workspace metadata.
- Modify: `apps/web/src/styles.css`
  - Add shared help-center styles and diagram component styles.

### Help Center pages

- Create: `apps/web/src/pages/HelpCenterHomePage.tsx`
  - Main dual-entry Help Center homepage.
- Create: `apps/web/src/pages/HelpWorkflowPage.tsx`
  - Renders workflow guide pages from content definitions.
- Create: `apps/web/src/pages/HelpFeaturePage.tsx`
  - Renders feature guide pages from content definitions.
- Create: `apps/web/src/pages/HelpReleaseTimelinePage.tsx`
  - Renders timeline-based release updates page.

### Help content and presentational components

- Create: `apps/web/src/help-center/content/workflows.ts`
  - Structured workflow help content.
- Create: `apps/web/src/help-center/content/features.ts`
  - Structured feature help content.
- Create: `apps/web/src/help-center/content/releases.ts`
  - Structured release timeline content.
- Create: `apps/web/src/help-center/content/types.ts`
  - Content model types shared by help content.
- Create: `apps/web/src/help-center/components/HelpHero.tsx`
  - Shared help-page hero/header block.
- Create: `apps/web/src/help-center/components/HelpFlowDiagram.tsx`
  - Main polished flow diagram component.
- Create: `apps/web/src/help-center/components/HelpStageList.tsx`
  - Step-by-step stage cards for workflow pages.
- Create: `apps/web/src/help-center/components/HelpFeatureSection.tsx`
  - Reusable feature-page sections.
- Create: `apps/web/src/help-center/components/HelpReleaseTimeline.tsx`
  - Timeline rendering for updates page.

### Tests

- Create: `tests/unit/web/help-center-content.test.ts`
  - Content integrity and routing assumptions.
- Optionally create: `tests/unit/web/help-center-routes.test.tsx`
  - Route-level smoke only if cheap.

### Documentation

- Modify: `docs/handover/项目完整说明.md`
  - Mention Help Center module.
- Modify: `docs/handover/仓库交接说明.md`
  - Add Help Center reading order and operator purpose.

---

## Task 1: Define Help Center content contracts and seed operator-first content

**Files:**
- Create: `apps/web/src/help-center/content/types.ts`
- Create: `apps/web/src/help-center/content/workflows.ts`
- Create: `apps/web/src/help-center/content/features.ts`
- Create: `apps/web/src/help-center/content/releases.ts`
- Test: `tests/unit/web/help-center-content.test.ts`

- [ ] **Step 1: Write failing content integrity tests**

Cover:
- all workflow entries have ids, titles, summaries, stages, and related links
- all feature entries have ids, titles, purpose, usage timing, sections, and related workflows
- all release entries have dates, titles, summaries, and affected feature arrays
- feature/workflow/release ids are unique

- [ ] **Step 2: Run test to confirm failure**

Run:
`pnpm exec vitest run tests/unit/web/help-center-content.test.ts`

Expected:
- FAIL because help-center content modules do not exist yet

- [ ] **Step 3: Define content model types**

Add types for:
- workflow guides
- workflow stages
- feature guides
- feature sections
- release entries

- [ ] **Step 4: Write operator-first workflow content**

Include three workflow guides:
- 新建任务 -> 审阅 -> 交付
- 模型接入 -> 模型登记 -> 默认值设置 -> 任务覆盖
- 失败任务 -> 看板定位 -> 资产排查 -> 继续处理

- [ ] **Step 5: Write operator-first feature content**

Include seven feature guides:
- 任务启动
- 分镜审阅
- 关键帧审阅
- 生产看板
- 交付资产
- 模型控制中心
- 用户中心

- [ ] **Step 6: Write release timeline seed content**

Create structured release entries based on already-shipped milestones, including:
- model control plane
- model-control UI/UX polish
- major review persistence / operator workflow milestones if appropriate

- [ ] **Step 7: Re-run content tests**

Run:
`pnpm exec vitest run tests/unit/web/help-center-content.test.ts`

Expected:
- PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/help-center/content tests/unit/web/help-center-content.test.ts
git commit -m "feat: add help center content models"
```

## Task 2: Build Help Center routes and layout scaffolding

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Create: `apps/web/src/pages/HelpCenterHomePage.tsx`
- Create: `apps/web/src/pages/HelpWorkflowPage.tsx`
- Create: `apps/web/src/pages/HelpFeaturePage.tsx`
- Create: `apps/web/src/pages/HelpReleaseTimelinePage.tsx`
- Create: `apps/web/src/help-center/components/HelpHero.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add Help Center routes**

Add:
- `/help-center`
- `/help-center/workflows/:workflowId`
- `/help-center/features/:featureId`
- `/help-center/releases`

- [ ] **Step 2: Add Help Center navigation entry**

Place `帮助中心` under `系统管理` in the shell.

- [ ] **Step 3: Add help-page layout scaffolding**

Create reusable page shells for:
- home
- workflow pages
- feature pages
- releases page

- [ ] **Step 4: Add shared Help Hero component**

Make the top of help pages visually consistent and clearly different from operational task pages.

- [ ] **Step 5: Add foundational help-center styles**

Add:
- help homepage sections
- card grids
- content side rails where appropriate
- help page typography hierarchy

- [ ] **Step 6: Run web checks**

Run:
- `pnpm --filter @genergi/web typecheck`

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/AppLayout.tsx apps/web/src/pages/HelpCenterHomePage.tsx apps/web/src/pages/HelpWorkflowPage.tsx apps/web/src/pages/HelpFeaturePage.tsx apps/web/src/pages/HelpReleaseTimelinePage.tsx apps/web/src/help-center/components/HelpHero.tsx apps/web/src/styles.css
git commit -m "feat: add help center routes and layout"
```

## Task 3: Build polished workflow diagram and stage components

**Files:**
- Create: `apps/web/src/help-center/components/HelpFlowDiagram.tsx`
- Create: `apps/web/src/help-center/components/HelpStageList.tsx`
- Modify: `apps/web/src/pages/HelpWorkflowPage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Create the main flow diagram component**

Support:
- horizontal stage progression
- branching/decision hints
- highlighted current critical points
- labeled transitions

- [ ] **Step 2: Create the stage detail list component**

Each workflow page should pair the main visual flow with stage-by-stage explanation cards.

- [ ] **Step 3: Wire workflow pages to render real content**

Workflow route should:
- resolve workflow id
- render main hero
- render diagram
- render stage list
- render reminders / related links

- [ ] **Step 4: Add fallback for unknown workflow ids**

Unknown ids should gracefully redirect or show a helpful empty state, not crash.

- [ ] **Step 5: Run web verification**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/help-center/components/HelpFlowDiagram.tsx apps/web/src/help-center/components/HelpStageList.tsx apps/web/src/pages/HelpWorkflowPage.tsx apps/web/src/styles.css
git commit -m "feat: add workflow help diagrams"
```

## Task 4: Build feature guide pages with operator-first structure

**Files:**
- Create: `apps/web/src/help-center/components/HelpFeatureSection.tsx`
- Modify: `apps/web/src/pages/HelpFeaturePage.tsx`
- Modify: `apps/web/src/pages/HelpCenterHomePage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Create reusable feature section component**

Support sections for:
- page purpose
- when to use
- main areas
- common actions
- common mistakes
- related workflows

- [ ] **Step 2: Render feature guide pages from structured content**

Each feature route should resolve content and render it consistently.

- [ ] **Step 3: Build feature-browsing section on Help Center home**

Show feature cards as a parallel discovery path to workflows.

- [ ] **Step 4: Ensure operator readability**

Trim overly technical wording and keep paragraphs short and actionable.

- [ ] **Step 5: Run web verification**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/help-center/components/HelpFeatureSection.tsx apps/web/src/pages/HelpFeaturePage.tsx apps/web/src/pages/HelpCenterHomePage.tsx apps/web/src/styles.css
git commit -m "feat: add feature help guides"
```

## Task 5: Build timeline-style release updates page

**Files:**
- Create: `apps/web/src/help-center/components/HelpReleaseTimeline.tsx`
- Modify: `apps/web/src/pages/HelpReleaseTimelinePage.tsx`
- Modify: `apps/web/src/pages/HelpCenterHomePage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Create release timeline component**

Support:
- visual timeline spine
- dated release cards
- affected module pills
- operator notes list

- [ ] **Step 2: Render release entries from structured local content**

Do not render raw markdown release notes directly.

- [ ] **Step 3: Add “recent updates” section to Help Center home**

Highlight the latest releases and link to the full timeline.

- [ ] **Step 4: Run web verification**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/help-center/components/HelpReleaseTimeline.tsx apps/web/src/pages/HelpReleaseTimelinePage.tsx apps/web/src/pages/HelpCenterHomePage.tsx apps/web/src/styles.css
git commit -m "feat: add help center release timeline"
```

## Task 6: Integrate Help Center polish and operator navigation flow

**Files:**
- Modify: `apps/web/src/pages/HelpCenterHomePage.tsx`
- Modify: `apps/web/src/pages/HelpWorkflowPage.tsx`
- Modify: `apps/web/src/pages/HelpFeaturePage.tsx`
- Modify: `apps/web/src/pages/HelpReleaseTimelinePage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Make home page feel like an index, not a card dump**

Balance:
- workflow learning
- feature lookup
- recent updates

- [ ] **Step 2: Add cross-linking**

Ensure:
- workflow pages link to relevant features
- feature pages link back to workflows
- release page links to affected modules where appropriate

- [ ] **Step 3: Improve empty/error states**

Unknown routes or missing content should produce clean operator-facing fallbacks.

- [ ] **Step 4: Run final web verification**

Run:
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/HelpCenterHomePage.tsx apps/web/src/pages/HelpWorkflowPage.tsx apps/web/src/pages/HelpFeaturePage.tsx apps/web/src/pages/HelpReleaseTimelinePage.tsx apps/web/src/styles.css
git commit -m "feat: finalize help center operator experience"
```

## Task 7: Documentation alignment and final verification

**Files:**
- Modify: `docs/handover/项目完整说明.md`
- Modify: `docs/handover/仓库交接说明.md`
- Verify all Help Center files as needed

- [ ] **Step 1: Update repository handoff docs**

Add:
- Help Center module overview
- route entry
- operator usage purpose

- [ ] **Step 2: Run focused content and build validation**

Run:
- `pnpm exec vitest run tests/unit/web/help-center-content.test.ts`
- `pnpm --filter @genergi/web typecheck`
- `pnpm --filter @genergi/web build`

Expected:
- PASS

- [ ] **Step 3: Manual browser walkthrough**

Verify:
- Help Center home
- at least one workflow page
- at least one feature page
- release timeline page

- [ ] **Step 4: Commit**

```bash
git add docs/handover/项目完整说明.md docs/handover/仓库交接说明.md
git commit -m "docs: add help center handoff context"
```

---

## Manual Acceptance Criteria

This Help Center project is complete only when:

- `帮助中心` appears in the main app navigation
- operators can enter the Help Center homepage
- homepage supports both `按流程学习` and `按功能查阅`
- workflow pages contain polished visual flow diagrams and step guidance
- feature pages are operator-first and easy to scan
- release updates are available in a timeline-style page
- content is repo-owned and ships with the product
- Help Center feels like a real module, not a markdown dump
- web typecheck/build pass
- manual browser walkthrough confirms all main paths work
