# AGENTS.md for E:\genergi

## Product Identity
- Main brand: `GENERGI`
- Product display name: `GENERGI 自动化视频平台`
- Company/domain layer: `Genergius`
- Primary entrypoint: `ai.genergius.com`

## Product Direction
- This is a pure online web application, not a desktop software product.
- Primary target audience: overseas English-speaking users.
- Operator language: Chinese-first for internal teams.
- Content output language: English-first.
- Default content channels: TikTok, Instagram Reels, YouTube Shorts.

## Current Architecture Direction
- Monorepo at `E:\genergi`
- `apps/web`: React + Vite control console
- `apps/api`: Hono API layer
- `apps/worker`: Node.js + BullMQ execution engine
- `packages/shared`: shared contracts and types
- `packages/ui`: GENERGI design system components
- `packages/config`: modes, brand, channel, and provider config

## Runtime Defaults
- Default text model strategy: strongest available model for planning by default.
- Phase 1 TTS: `Edge TTS` as the practical default so budget does not block implementation.
- TTS must remain provider-pluggable for later replacement.
- Video/image are expensive stages; cost control focuses on scene count, video scene count, and retries.

## Phase 1 Priorities
- Build a runnable web-first monorepo foundation.
- Add versioning and migration controls.
- Add canonical model and mode registries.
- Add frozen task-run config, state-machine, and budget shell.
- Add V2 persistence foundation.
- Scope preload/IPC ideas do not apply directly here anymore because the new repo is web-first; adapt the intent into web/api contracts.
- Lock UI direction and baseline in Phase 1 using Stitch.
- Add packaged/runtime deployment baseline for server rollout.
- Keep docs Chinese-first.

## Repository Hygiene
- This repo can be public.
- Never commit real API keys, tokens, passwords, server secrets, or private endpoints.
- Keep examples in `.env.example`, `provider.example.json`, and `mode.example.json`.
- Prefer Chinese documentation by default. Add English docs only when necessary.
- Key code comments should be Chinese-first for orchestration, budget, retry, migration, and provider fallback logic.

## Deployment Direction
- Reuse the same production host family as `E:\anhe_automation`, but keep full directory isolation.
- Recommended server layout:
  - `/opt/genergi/releases/<timestamp>`
  - `/opt/genergi/current`
  - `/opt/genergi/shared/`
- Do not mix files into `/opt/anhe_automation/current`.

## Reference Documents
- Spec source copied from prior repo context into:
  - `docs/superpowers/specs/2026-04-17-v2-social-video-factory-redesign.md`
- Phase 1 plan copied into:
  - `docs/superpowers/plans/2026-04-17-genergi-v2-phase1-foundation-plan.md`

## Current Branch Guidance
- Active branch for bootstrap work: `codex/bootstrap-foundation`
- The old repo `E:\short-video-factory` is reference-only now. Do not treat it as the mother repository.
