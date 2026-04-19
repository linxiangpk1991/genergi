# GENERGI Media Model Slot Simplification Design

Date: 2026-04-20
Status: Approved by operator direction, ready for implementation
Scope: Replace the current draft/final image and video model slot system with a simplified runtime model system that matches the real production chain: `textModel`, `imageModel`, `videoModel`, and `ttsProvider`.

## 1. Background

The current model control plane exposes six model slots:

- `textModel`
- `imageDraftModel`
- `imageFinalModel`
- `videoDraftModel`
- `videoFinalModel`
- `ttsProvider`

This was originally intended to support a “draft vs final” split for image and video generation.

However, the operator clarified the real product truth:

- current task launch is already the final production path
- there is no real separate draft image stage
- there is no real separate final image stage
- there is no real separate draft video stage
- there is no real separate final video stage

In the current product, operators are not actually running a staged “draft first, final later” pipeline. They are launching one production chain that generates the actual task result.

That means the current slot model is misleading in two ways:

1. it makes operators believe the platform has explicit multi-stage visual generation when it does not
2. it prevents a single image or video model from being freely selected for both “draft” and “final” positions, even though those positions are not real runtime phases

This creates ongoing confusion in:

- model registration
- defaults center
- task-level overrides
- operator understanding of the runtime chain

## 2. Decision

Replace the current six-slot media model system with a four-slot runtime model system:

- `textModel`
- `imageModel`
- `videoModel`
- `ttsProvider`

This change must be treated as a first-class product and architecture simplification, not just a label tweak.

## 3. Product Principle

The model control plane must reflect the **actual execution chain**, not an aspirational or historical staging concept.

If the runtime chain only has one image generation role and one video generation role, the control plane should expose one image model slot and one video model slot.

If a true multi-stage visual pipeline is added in the future, it should be introduced as:

- a real pipeline capability
- with explicit pipeline stages

and not by leaving stale pseudo-stage slot names in the present-day UI.

## 4. Target Model Slot System

The new slot system becomes:

### 4.1 `textModel`

Used for:

- script planning
- text rewriting
- prompt planning
- structured text output

### 4.2 `imageModel`

Used for:

- image generation
- keyframe generation
- still-frame visual output

### 4.3 `videoModel`

Used for:

- scene video generation
- final video generation inputs

### 4.4 `ttsProvider`

Used for:

- narration audio generation

## 5. What Will Be Removed

The following slot names should stop being first-class runtime concepts:

- `imageDraftModel`
- `imageFinalModel`
- `videoDraftModel`
- `videoFinalModel`

They may remain temporarily in migration logic, but not in the steady-state public model-control experience.

## 6. Operator-Facing Meaning

After this redesign, operators should understand the system as:

- choose the text model used for planning
- choose the image model used for image/keyframe generation
- choose the video model used for video generation
- choose the TTS provider used for narration

Nothing in the UI should imply that the system currently performs a separate “draft-first then final-pass” image or video pipeline.

## 7. Migration Rules

## 7.1 Existing historical tasks

The operator explicitly confirmed:

- existing old tasks can be cleared
- they are not meaningful production artifacts

Therefore:

- we do **not** need a complex historical compatibility story for old tasks
- old task summaries/details/assets may be cleared as part of this cleanup

This significantly simplifies the migration.

## 7.2 Existing defaults

Current defaults stored under the old six-slot system should migrate into the new four-slot system using deterministic precedence:

### Image default migration

Use:

- `imageFinalModel` if present
- otherwise `imageDraftModel`

### Video default migration

Use:

- `videoFinalModel` if present
- otherwise `videoDraftModel`

### Text and TTS

Keep:

- `textModel`
- `ttsProvider`

## 7.3 Existing model registry entries

Model registry records currently carry a single `slotType`.

Under the new system:

- image models should be registered under `imageModel`
- video models should be registered under `videoModel`
- text models remain under `textModel`
- TTS remains under `ttsProvider`

Old model registry records in the obsolete media slot types should be migrated or rebuilt into the new slot types.

Since this is pre-launch and old tasks can be discarded, the cleaner approach is:

- migrate provider registry forward
- migrate model registry forward
- rebuild defaults into the new slot system
- clear old task data

## 8. Runtime Design

## 8.1 Task creation

At task creation time, the resolver should now resolve only:

- `textModel`
- `imageModel`
- `videoModel`
- `ttsProvider`

The resolved snapshot stored in `taskRunConfig.slotSnapshots` must use only these four slot types.

## 8.2 Worker execution

The worker must consume the simplified runtime snapshot:

- `textModel` for planning/rewrite
- `imageModel` for keyframes/images
- `videoModel` for video generation
- `ttsProvider` for narration

The worker should no longer need to guess between draft/final media slots.

## 8.3 Mode defaults and task overrides

The same priority remains:

`task override > mode default > global default`

But the actual per-slot choices now reduce to four runtime slots instead of six.

## 9. UI/UX Changes

## 9.1 Model Registry

The registry should no longer expose obsolete slot names.

Replace:

- 草图出图
- 终稿出图
- 草稿视频
- 终稿视频

With:

- 图片模型
- 视频模型

Text and TTS remain unchanged.

## 9.2 Defaults Center

Defaults Center should render only four rows:

- 文本模型
- 图片模型
- 视频模型
- TTS 配音

For both:

- 全局默认
- 模式默认

## 9.3 Task launch advanced overrides

Task launch advanced override should render only four configurable slots:

- 文本模型
- 图片模型
- 视频模型
- TTS 配音

This will align the operator mental model with actual runtime behavior.

## 9.4 Help Center and explanatory content

Any help-center content, inline descriptions, or operational guidance that still mentions:

- 草图 / 终图
- 草稿视频 / 终稿视频

must be rewritten to reflect the simplified runtime model.

## 10. Why This Is Better

This redesign improves the system in three major ways:

### 10.1 Product clarity

Operators will no longer see a staged model-selection system that the runtime does not actually implement.

### 10.2 Runtime simplicity

The worker, resolver, and defaults logic all get simpler because they stop carrying redundant media slots.

### 10.3 Future correctness

If the product later introduces a real draft/final production pipeline, it can do so properly:

- via explicit pipeline stages
- via explicit workflow changes
- via explicit UI explanations

rather than inheriting a misleading slot model from an earlier phase.

## 11. Out of Scope

This redesign does **not** itself add:

- a true draft/final visual pipeline
- a staged image approval workflow before final image generation
- a staged video refinement workflow

Those may be future product projects, but they are not part of this cleanup.

## 12. Acceptance Criteria

This redesign is complete only when:

1. the runtime model slot system has only four slots
2. model registry supports only the simplified slot set
3. defaults center shows only the simplified slot set
4. task launch advanced override shows only the simplified slot set
5. worker consumes only the simplified slot set
6. legacy tasks are cleared
7. help center and page copy no longer imply a non-existent draft/final execution chain
8. local verification passes
9. a new task can be created and frozen with the new four-slot snapshot model

## 13. Recommendation

Implement this as a system-wide cleanup in one pass:

- shared contracts
- persistence
- registry
- resolver
- task creation
- worker
- model-control UI
- help-center content

Anything less than that risks leaving operators in a half-old, half-new mental model, which is exactly the confusion this redesign is meant to remove.
