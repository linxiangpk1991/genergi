# GENERGI Model Control UI/UX Polish Design

Date: 2026-04-19
Status: Approved by operator direction, ready for implementation
Scope: Refine the shell and model-control surfaces so they feel like a mature SaaS control console, with better navigation hierarchy, denser operator workflows, and less visually awkward layout behavior.

## 1. Background

The new model control plane is functionally complete, but the current UI still carries several traits that make it feel more like an engineering admin screen than a polished SaaS operating console.

The most obvious problem is the shell layout:

- the left sidebar uses `space-between`
- brand, navigation, and bottom CTA are vertically stretched apart
- on tall screens the primary navigation appears artificially centered
- operators read the navigation as floating in empty space rather than anchored to the top of the workspace

The model control center also works functionally, but still needs stronger UI discipline:

- overview tiles and workflow cards are serviceable but not premium
- provider and model forms are dense but not clearly grouped
- defaults center works, but still feels like a raw configuration page rather than a production control console
- task-launch advanced overrides are useful, but their hierarchy and affordances can be clearer

This refinement is intentionally a **UI/UX-only project**. It must not alter model-control precedence, validation logic, or task snapshot semantics.

## 2. Goal

Make the shell and model-control experience feel closer to mature SaaS products such as Vercel, Stripe, and Linear:

- top-anchored navigation
- clearer grouping between production work and system management
- less “floating whitespace”
- better scanability for operators
- stronger visual hierarchy without sacrificing density

## 3. Non-Goals

This polish pass will not:

- change provider/model/default resolution rules
- change task creation payload semantics
- add new backend capabilities
- redesign unrelated review or asset workflows beyond shared shell styling side-effects
- add collapsible/resizable sidebar infrastructure in this pass

## 4. Design Principles

### 4.1 Navigation must feel anchored

Primary navigation should start near the top of the shell, directly under the brand block, rather than being visually suspended between top and bottom elements.

### 4.2 High-frequency actions first

The most common operator actions should appear first and feel visually grouped:

- task launch
- storyboard review
- keyframe review
- production dashboard
- asset center

Management tools should be grouped separately:

- model control center
- user center

### 4.3 Utility actions are not navigation

“Return to task entry” or similar page-level actions should not distort sidebar layout. These belong in the workspace toolbar or as lighter contextual actions, not as a structural anchor in the main nav column.

### 4.4 Forms should support fast scanning

Provider/model/defaults pages must feel operationally efficient:

- grouped labels
- stable control widths
- obvious status color hierarchy
- tighter but calmer spacing
- clearer primary vs secondary actions

### 4.5 Control center must feel like a system dashboard

The overview page should read as:

1. current control-plane health
2. key workflows
3. effective default state
4. recent changes

instead of a stack of generic cards.

## 5. Proposed Layout Changes

## 5.1 App shell

### Current

- single sidebar column
- `justify-content: space-between`
- bottom CTA compresses the nav into the vertical middle

### New

Sidebar becomes three stacked sections:

1. **Brand block**
2. **Navigation stack**
3. **Auxiliary footer**

The navigation stack stays top-aligned and grows naturally. The footer stays at the bottom, but without forcing the nav block into the middle.

### Sidebar grouping

Two nav groups:

- `生产工作区`
  - 任务启动
  - 分镜审阅
  - 关键帧审阅
  - 生产看板
  - 交付资产
- `系统管理`
  - 模型控制中心
  - 用户中心

### Active-state treatment

Active nav item should gain:

- stronger inset background
- left accent rail
- stronger foreground contrast
- less “button” feel, more “selected workspace section” feel

## 5.2 Workspace toolbar

The workspace toolbar should carry more of the contextual navigation burden.

Changes:

- make title/description block feel more structured
- move “new task” / contextual back-to-entry behavior into the toolbar layer
- keep toolbar actions visually secondary to content

## 5.3 Model Control Center overview

Current overview works, but should feel more intentional.

New structure:

1. top summary band with clearer state metrics
2. workflow cards with more distinct “step” feel
3. precedence explanation as a compact diagram-like strip
4. defaults summary as a more legible matrix
5. recent activity panels sorted and visually lighter

## 5.4 Provider Management page

Provider page should feel like a control console, not a long form plus a raw table.

Adjustments:

- form fields grouped by “identity / connection / secret / lifecycle”
- provider status visually stronger
- table spacing tightened
- endpoint and secret states easier to scan
- action cluster more stable and less noisy

## 5.5 Model Registry page

Model registry should visually emphasize:

- slot ownership
- provider binding
- capability metadata
- validation status

Adjustments:

- clearer distinction between form and registry list
- capability metadata rendered with calmer, tighter chips
- registry item cards easier to parse at a glance
- slot filter treated as first-class control

## 5.6 Defaults Center page

Defaults center is operationally important, so it should feel like a governed control surface.

Adjustments:

- stronger “global vs mode” sectional contrast
- easier-to-scan row layout
- clearer explanation of current effective state
- less visual fatigue from repeated form rows

## 5.7 Task-launch advanced overrides

This area should feel like a controlled expert panel, not a hidden settings dump.

Adjustments:

- stronger separation between explanatory guidance and actual selectors
- better “default / overridden / effective” hierarchy
- clearer disabled/loading feedback
- more deliberate visual summary of affected slots

## 6. Interaction Changes

No business logic changes are intended, but the following interaction changes are in scope:

- advanced override submit button should visually reflect loading states more clearly
- sidebar hover and active states should be calmer and more premium
- control pages should reduce ambiguous action weight
- default reset vs save actions should read clearly as secondary vs primary

## 7. Files In Scope

Primary files:

- `apps/web/src/components/AppLayout.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/App.tsx`
- `apps/web/src/pages/ModelControlCenterPage.tsx`
- `apps/web/src/pages/ModelProvidersPage.tsx`
- `apps/web/src/pages/ModelRegistryPage.tsx`
- `apps/web/src/pages/ModelDefaultsPage.tsx`
- `apps/web/src/pages/HomePage.tsx`

Possible light touch only if needed:

- `apps/web/src/api.ts`

No backend files should change unless a tiny typing fix becomes unavoidable.

## 8. Acceptance Criteria

This polish pass is complete when:

1. sidebar navigation is top-anchored and no longer visually centered in empty space
2. production vs management nav grouping is clear
3. model control overview feels like a control console, not a placeholder dashboard
4. provider/model/default pages are easier to scan and operate at speed
5. advanced override panel feels deliberate and premium
6. no model-control behavior regresses
7. `web` typecheck/build still pass
8. manual browser walkthrough on the live site confirms the intended visual improvements

## 9. Risks

- Over-styling could make dense operator pages slower to scan
- Sidebar regrouping could accidentally reduce discoverability if headings are too dominant
- Shared shell changes could unintentionally harm non-model-control pages if spacing is not carefully tested

## 10. Recommendation

Implement this as a focused shell-plus-control-plane polish pass:

- no backend churn
- no new data model
- no hidden architectural work
- pure usability, hierarchy, spacing, and operator-flow refinement

That gives the highest UI/UX return with the lowest regression risk.
