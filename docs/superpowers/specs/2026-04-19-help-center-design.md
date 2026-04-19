# GENERGI Help Center Design

Date: 2026-04-19
Status: Drafted from approved operator direction, ready for spec review
Scope: Add an in-product Help Center for internal operators, combining operator-first feature guidance, process-oriented learning paths, visual flow explanations, and a timeline-based release update center.

## 1. Background

`GENERGI` already has a meaningful set of platform capabilities:

- task launch
- storyboard review
- keyframe review
- batch dashboard
- asset center
- model control plane
- user center

It also already has a growing document base in the repository:

- project handoff
- full project description
- model control usage notes
- release notes

However, those documents are still mostly repository-owned handoff material, not an operator-facing help experience inside the product.

The operator requirement is clear:

- the product must include a **Help Center**
- it must explain all major platform capabilities in concrete operational language
- it must include **timeline-style release updates**
- it should use **beautiful, comprehensible flow diagrams** to help operators understand how work moves through the system
- the content should be rewritten for operators, not merely link to engineering docs

## 2. Goal

Build a first-class, in-product Help Center that helps internal operators:

1. learn the platform by workflow
2. find guidance by feature/module
3. understand process through clear visual diagrams
4. review version updates in a timeline format

The Help Center should feel like a real product module, not a documentation afterthought.

## 3. Non-Goals

The first version will **not** include:

- WYSIWYG backend editing
- CMS-style authoring
- full-text search engine
- multi-role permission-specific documentation variants
- external/public documentation publishing

The first version will be:

- repo-owned
- released with product versions
- operator-first in tone and content

## 4. Primary Users

### 4.1 Core user

Internal Chinese-speaking operators who use the platform to manage English-language video production.

### 4.2 Secondary user

New team members onboarding into GENERGI operations.

### 4.3 Usage style

Operators should be able to:

- open Help Center from the main console
- quickly understand a workflow visually
- jump into a module guide
- review recent releases without reading engineering release notes

## 5. Product Direction

The Help Center should behave like an **operations knowledge center**, not a generic markdown viewer.

It should privilege:

- diagrams first
- practical explanations second
- long prose last

The content model should be more like:

- “what this page is for”
- “when to use it”
- “how work flows”
- “what to check”
- “what changed in this version”

rather than:

- architecture narrative
- engineering constraints
- repository-level implementation notes

## 6. Entry Structure

The Help Center homepage should support **two parallel discovery modes plus one update mode**.

### 6.1 Mode A: Learn by workflow

This is the primary onboarding path.

Recommended cards:

1. `新建任务 -> 审阅 -> 交付`
2. `模型接入 -> 模型登记 -> 默认值设置 -> 任务覆盖`
3. `失败任务 -> 看板定位 -> 资产排查 -> 继续处理`

Each workflow entry leads to a dedicated visual guide page.

### 6.2 Mode B: Browse by feature

This is the primary lookup path for day-to-day questions.

Recommended feature entries:

- 任务启动
- 分镜审阅
- 关键帧审阅
- 生产看板
- 交付资产
- 模型控制中心
- 用户中心

### 6.3 Mode C: Version updates

This is the release-awareness path.

It must be a **timeline-style changelog page**, ordered by release date, with each release presented as an operator-readable update summary.

## 7. Information Architecture

## 7.1 Main route

Add a first-class route:

- `/help-center`

This route becomes the Help Center home.

## 7.2 Sub-routes

Recommended route structure:

- `/help-center`
- `/help-center/workflows/:workflowId`
- `/help-center/features/:featureId`
- `/help-center/releases`

This supports:

- direct sharing
- bookmarkable help pages
- cleaner future growth

## 7.3 Navigation entry

Add `帮助中心` to the main app shell navigation.

It should live under `系统管理`, because it is a persistent operational support surface rather than a production execution step.

## 8. Page Design

## 8.1 Help Center Home

The home page should include:

1. a strong header
2. a short explanation of what the center is for
3. a **workflow learning section**
4. a **feature browsing section**
5. a **recent release updates section**

The page should feel like an index of guided help, not a card dump.

## 8.2 Workflow Guide Page

Each workflow page should include:

1. workflow title
2. short “what this solves” description
3. one **main visual flow diagram**
4. step-by-step stage cards
5. operational reminders / decision points
6. links to related feature pages

### Example workflow topics

#### A. 新建任务 -> 审阅 -> 交付

Should explain:

- task launch
- storyboard review
- keyframe review
- final delivery and asset review

#### B. 模型接入 -> 模型登记 -> 默认值设置 -> 任务覆盖

Should explain:

- provider creation
- model registration
- validation
- defaults center
- task-level override and frozen snapshot behavior

#### C. 失败任务排查流程

Should explain:

- batch dashboard triage
- task detail inspection
- asset center checks
- where the operator should continue work

## 8.3 Feature Guide Page

Each feature page should be structured consistently:

1. `这个页面是干什么的`
2. `什么时候用`
3. `页面主要区域`
4. `常见操作`
5. `常见误区`
6. `相关流程`

The tone should stay operator-oriented and concise.

## 8.4 Release Timeline Page

The release page should be a timeline, not a flat list.

Each release item should show:

- date
- release title
- operator impact summary
- affected modules
- what changed in practical terms
- whether any workflow changed

Release entries should be shorter and more readable than repository release note files.

## 9. Diagram Strategy

The user explicitly wants more diagrams, and wants them to look good.

The first version should therefore use **built-in visual help components**, not raw markdown diagrams.

### 9.1 Principle

Operators should understand the diagram in seconds.

So diagrams must be:

- visual
- structured
- large enough to scan
- consistent across pages

### 9.2 Recommended diagram components

The UI should support:

- horizontal step flow rails
- branching decision cards
- stage clusters
- “input -> processing -> review -> result” chains
- highlighted current/critical points

These should be implemented as styled React UI blocks in the Help Center, not pasted screenshots.

### 9.3 When Mermaid is still useful

For more system-oriented flows, Mermaid may still be used:

- release process
- system state propagation
- model precedence summary

But even there, the primary operator pages should prefer polished in-product visual modules.

## 10. Content Strategy

## 10.1 Source of truth

The Help Center should be **repo-owned** and released with the application.

That means content is maintained in code/content files and deployed together with each release.

## 10.2 Authoring model

Do not directly render repository handoff docs as the Help Center.

Instead:

- use existing docs as source material
- rewrite into operator-first content
- store structured help content specifically for the product module

## 10.3 Content tone

Use:

- practical Chinese
- action-oriented explanations
- minimal engineering jargon

Avoid:

- codebase-focused language
- repository-only terminology
- internal implementation detail unless it affects operation

## 11. Release Update Content Model

Each release entry should be structured as:

- `versionDate`
- `title`
- `summary`
- `affectedFeatures[]`
- `operatorNotes[]`
- `workflowChanges[]`

This keeps it easy to maintain and easy to render as a timeline.

## 12. File and Data Approach

The first version should use **structured local content files** rather than backend CRUD.

Recommended split:

- workflow definitions
- feature definitions
- release definitions

These should be imported by the Help Center frontend and rendered as structured pages.

This keeps:

- content versioned
- release notes tied to code
- implementation lighter than a CMS

## 13. UI Direction

The Help Center should visually match the refined GENERGI control console:

- clean operator-first layout
- strong section hierarchy
- visually rich but readable cards
- diagram blocks that feel native to the product

It should not look like:

- an embedded wiki
- a markdown dump
- a generic docs theme

## 14. Scope for Version 1

Version 1 should include:

- Help Center home
- 3 workflow guide pages
- 7 feature guide pages
- release timeline page
- shared diagram components
- shared help layout components

This is enough to make the module useful immediately.

## 15. Risks

- If content is too text-heavy, it will fail the operator-readability goal
- If diagrams are too decorative, they will not actually improve understanding
- If feature content is copied too literally from handoff docs, it will feel like engineering docs rather than product help
- If the homepage tries to do too much, discovery may become slower instead of easier

## 16. Recommendation

Build the Help Center as a **first-class in-app module** with:

- dual discovery model (`按流程学习` + `按功能查阅`)
- a timeline changelog page
- structured local content
- polished diagram components

This gives the strongest operator value while keeping the implementation realistic for a single release cycle.
