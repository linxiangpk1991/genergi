# GENERGI Phase 1 UI Baseline Manifest

Updated: 2026-04-17
Stitch project: `projects/14661247850593460120`
Title: `GENERGI UI Baseline V2`

## Canonical Phase 1 Baseline Screens

### 1. Homepage / Task Launch Workbench
- Canonical title: `GENERGI 任务启动工作台 (V4)`
- Role: Primary product entry screen for `ai.genergius.com`
- Status: Canonical homepage baseline
- Notes:
  - Use this screen as the source of truth for the launch workspace layout.
  - Chinese-first operator UI
  - English-first content production context
  - Brand blue + orange visual language

### 2. Storyboard Review Workbench
- Canonical title: `分镜审阅工作台`
- Role: Manual storyboard review gate
- Status: Canonical review baseline
- Notes:
  - Must remain visually more focused and immersive than homepage
  - Keep left scene list + center review content + right decision panel pattern

### 3. Keyframe Review Workbench
- Canonical title: `关键帧审阅工作台`
- Role: Manual keyframe approval gate before video generation
- Status: Canonical review baseline
- Notes:
  - More visual than storyboard review
  - Large frame preview is the dominant layout element

### 4. Batch Dashboard
- Canonical title: `批量任务看板 (Batch Dashboard)`
- Role: Queue, budget pool, and worker monitoring screen
- Status: Canonical operations baseline
- Notes:
  - Chinese UI must use a Chinese-friendly font strategy
  - High information density is allowed, but hierarchy must stay clear

## Typeface Rule
- Chinese operator UI must prioritize Chinese-friendly fonts for labels, sidebars, cards, filters, and dense workbench areas.
- English titles, numbers, and content payload blocks may retain a more editorial sans-serif treatment.
- Future UI changes must preserve natural Chinese-English mixed typography.

## Iteration Handling
- Earlier exploratory homepage iterations are superseded by `GENERGI 任务启动工作台 (V4)`.
- Design-system boards and non-product display boards are not part of the production baseline.
- Hidden or duplicate exploratory screens may remain in Stitch history, but they are not the source of truth.

## Repository Rule
- After the final UI baseline is fully locked, export/download `DESIGN.md` and commit it into this repository as the global UI source of truth.
