# GENERGI Production Planning And Video Chain Redesign

> This spec defines a full-chain replacement of the current script-planning and video-generation workflow. It is not a patch set. The implementation must ship as a complete chain and must not degrade into partial, temporary, or lower-quality substitutes.

## 1. Background

`GENERGI` currently has a runnable Phase 1 media chain, but the script-planning and video-generation logic is still not production-ready.

The main issues observed are:

1. The final video duration is not reliably aligned with the user's chosen target duration.
2. The user's original script is treated too much like direct voiceover text, instead of being treated as the full-content source of truth for the whole video.
3. The text model currently behaves too much like a rewrite helper and not enough like a planner/director for downstream image and video generation.
4. The current chain can drift between:
   - task detail script
   - generated scene scripts
   - generated prompts
   - narration audio
   - final video
5. Partial fixes create rework. If one layer changes without the others, the whole system becomes inconsistent again.

Because the system is not formally launched yet, this is the right moment to replace the full chain instead of continuing with incremental patchwork.

## 2. Product Principle

The system must follow this principle:

**The user provides the content source of truth, and the system turns that into a fully planned production package.**

This means:

- The user input is the whole-video content source, not a technical prompt.
- Users should not need to understand:
  - prompt engineering
  - single-shot vs. multi-scene routing
  - scene duration balancing
  - model capability limits
- The system must absorb those technical concerns internally.

## 3. Core Design Principles

### 3.1 No partial rollout

This redesign must be implemented as one complete chain.

It must not ship in a state where:

- frontend uses new options but worker still consumes old planning logic
- text planning uses new structure but asset generation still assumes old scene structure
- route selection is changed but review/asset display still assume the previous model

If the full chain is not ready, it must not be treated as complete.

### 3.2 No downgrade substitutes

If implementation hits a hard problem, any substitute solution must remain at the same product level.

Allowed:

- a different structured planning strategy that still preserves full-chain consistency
- a different route selection mechanism that still honors model capability and user intent

Not allowed:

- falling back to fixed template scenes
- falling back to uncontrolled freeform rewrite output
- falling back to "ship now, polish later" for any critical link in the chain

### 3.3 Model planning before media generation

The text model must become the structured planner for downstream generation.

Its role is to output:

- final voiceover script
- route-aware generation plan
- scene responsibilities when needed
- image prompts
- video prompts
- CTA strategy

It must not output:

- explanation notes
- markdown dividers
- "what changed and why"
- user-facing commentary about the rewrite

## 4. User-Facing Interaction Model

Users should interact with content controls, not technical controls.

### 4.1 User-visible inputs

The task creation surface should expose:

- task title
- original content script
- target platform
- target final duration
- generation mode
  - `忠于原脚本`
  - `启用系统增强`

Optional enhancement toggles may exist, but must also use content language rather than technical language.

### 4.2 Hidden system concerns

These must remain internal:

- `single_shot` / `multi_scene` routing logic
- current model capability table
- prompt assembly internals
- scene duration balancing algorithm
- validation and retry rules

The UI may communicate the result in user language, but not expose raw technical internals as the primary interface.

## 5. Generation Modes

### 5.1 `忠于原脚本`

Meaning:

- Preserve the user's original thematic direction and tone as much as possible.
- Only apply structure and generation-readiness constraints.
- Do not inject platform-style changes that materially alter the content voice.

### 5.2 `启用系统增强`

Meaning:

- Preserve the original theme and intent.
- Add controlled system-provided enhancement keywords and constraints to improve:
  - hook strength
  - pacing
  - platform-native tone
  - conversion clarity
  - visual direction

System enhancement must enhance presentation, not replace the user's original meaning.

## 6. Route Selection Logic

Route selection must happen before the text model generates the final plan.

The text model is not responsible for deciding whether the task should be single-shot or multi-scene.

### 6.1 Route inputs

System route selection must consider:

- current selected video model
- current selected target duration
- current selected platform
- generation mode
- model capability table

### 6.2 Route outputs

The system must produce:

- `generationRoute`
  - `single_shot`
  - `multi_scene`
- `routeReason`
- `enhancementMode`
  - `user_locked`
  - `system_enhanced`

### 6.3 Capability-driven rule

The route must be constrained by real model ability.

Example with current Veo 3.1 capability:

- current stable single video generation duration support is `4 / 6 / 8` seconds
- therefore:
  - `15s / 30s / 45s / 60s` must route to `multi_scene`
  - single-shot is only allowed when the target duration does not exceed the chosen model's single-shot ceiling

This rule must be derived from an explicit capability table, not implicit assumptions in prompt text.

## 7. Text Model Input Contract

The system should send the text model a structured planning input that includes:

- original user script
- target platform
- target final duration
- selected generation mode
- resolved generation route
- route reason
- current video model capability context
- enhancement keyword bundle when `启用系统增强` is selected
- explicit output rules:
  - no explanation text
  - no markdown separators
  - no commentary
  - output must be machine-usable

The user script must not be pre-truncated or pre-downgraded before planning.

## 8. Text Model Output Contract

The text model must return structured JSON.

### 8.1 Required top-level fields

- `generationRoute`
- `targetDurationSec`
- `finalVoiceoverScript`
- `visualStyleGuide`
- `ctaLine`
- `scenePlan`

### 8.2 `single_shot` output

When route is `single_shot`, `scenePlan` must contain exactly one scene object with:

- `sceneIndex`
- `scenePurpose`
- `durationSec`
- `script`
- `imagePrompt`
- `videoPrompt`
- `transitionHint`

### 8.3 `multi_scene` output

When route is `multi_scene`, `scenePlan` must contain multiple scene objects with:

- `sceneIndex`
- `scenePurpose`
- `durationSec`
- `script`
- `imagePrompt`
- `videoPrompt`
- `transitionHint`

## 9. Output Validation Rules

The system must validate text-model output before it is accepted.

### 9.1 Hard validation

The following are hard failures:

- route mismatch between system decision and model output
- missing required fields
- empty `script`, `imagePrompt`, or `videoPrompt`
- explanation or commentary fields contaminating structured output
- `single_shot` returning more than one scene
- `multi_scene` returning one or zero scenes
- planned scene duration total not matching `targetDurationSec`

### 9.2 Retry strategy

If validation fails:

- automatically retry planning 1 to 2 times
- include validation failure reasons in the retry instruction

The system must prefer structured regeneration over content hard-cropping.

## 10. Media Generation Rules

### 10.1 `single_shot`

When route is `single_shot`:

- generate one coherent video segment
- generate one coherent keyframe plan
- generate one aligned narration script
- produce one final cut without multi-scene concatenation

### 10.2 `multi_scene`

When route is `multi_scene`:

- generate one video segment per scene
- generate one keyframe plan per scene
- concatenate scene videos
- then mux narration onto the stitched video

All downstream media must consume the same accepted planning result.

## 11. Consistency Requirements

The following must remain aligned at all times:

- persisted task detail
- final voiceover script
- scene scripts
- image prompts
- video prompts
- narration audio
- final video

There must not be a state where:

- the task detail shows one script
- exported script file shows another
- narration speaks a third
- final video follows a fourth

If the worker rewrites or replans a task, the updated result must be written back to persistence before generation continues.

## 12. Duration Validation Policy

### 12.1 Planning layer

Planning durations are strict:

- planned scene durations must sum exactly to the target duration

### 12.2 Final media layer

Final output duration allows tolerance:

- if `abs(actualDuration - targetDurationSec) <= 2s`, pass
- if difference is `> 2s` and `<= 5s`, warning
- if difference is `> 5s`, failure or retry candidate

The system must not fail production tasks for `1-2s` natural model variance.

## 13. Review Layer Requirements

The review UI must support both planning routes.

### 13.1 Single-shot review

- simplified whole-video plan view
- one consolidated visual plan
- one final voiceover script

### 13.2 Multi-scene review

- scene-by-scene plan
- per-scene prompts and timing
- transition visibility

Review surfaces must reflect the accepted planning result, not regenerate their own interpretation.

## 14. Asset Layer Requirements

Asset center must expose route-aware outputs clearly.

At minimum it should show:

- target duration
- actual final duration
- generation route
- scene count
- final video
- narration
- storyboard JSON
- keyframe manifest

## 15. Acceptance Criteria

This redesign is only acceptable when all of the following are true:

1. Users can choose total duration and generation mode from the UI.
2. System route selection happens before text planning.
3. Text planning outputs structured JSON.
4. Structured validation and retry are active.
5. `single_shot` and `multi_scene` both run end-to-end through worker logic.
6. Persisted task detail matches actual generation inputs.
7. Final video duration follows tolerance policy.
8. Review and asset layers reflect the same plan the worker used.
9. Automated tests, typecheck, and build all pass.
10. At least one real-task production validation is completed after rollout.

## 16. Non-Negotiable Delivery Rule

This redesign must ship as a whole-chain replacement.

It must not be marked complete if only some of the following are done:

- UI fields added
- route logic added
- text planner changed
- worker partially updated
- asset/review layers still using old assumptions

Completion requires the entire production chain to move together.
