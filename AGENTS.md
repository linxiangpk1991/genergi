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
- Production deployment should follow the stable `anhe_automation` model:
  - timestamped releases under `/opt/genergi/releases/<timestamp>`
  - `/opt/genergi/current` and `/opt/genergi/current.prev` symlink switching
  - `systemd` for long-running `api` / `worker`
  - `nginx` serving static `apps/web/dist` and proxying `/api` to `127.0.0.1:8787`
- Recommended server layout:
  - `/opt/genergi/releases/<timestamp>`
  - `/opt/genergi/current`
  - `/opt/genergi/current.prev`
  - `/opt/genergi/shared/`
- Do not mix files into `/opt/anhe_automation/current`.
- Runtime state such as task data must live in stable shared paths, not inside a release directory.

## Hard-Won Deployment Rule
- Do not treat root-domain DNS as proof that the product subdomain is ready. `genergius.com` and `www.genergius.com` can resolve correctly while `ai.genergius.com` is still `NXDOMAIN` on public resolvers.
- Public acceptance for `ai.genergius.com` requires checking the subdomain itself against public DNS, not just the DNS provider console screenshot.

## Reference Documents
- Spec source copied from prior repo context into:
  - `docs/superpowers/specs/2026-04-17-v2-social-video-factory-redesign.md`
- Phase 1 plan copied into:
  - `docs/superpowers/plans/2026-04-17-genergi-v2-phase1-foundation-plan.md`

## Current Branch Guidance
- Active branch for bootstrap work: `codex/bootstrap-foundation`
- The old repo `E:\short-video-factory` is reference-only now. Do not treat it as the mother repository.

## Thread Migration Note
- If a future Codex desktop thread still visually appears under `E:\short-video-factory`, treat that as stale UI binding only.
- The real working project, source of truth, and all new implementation work must continue under `E:\genergi`.
- Before resuming work in any new thread, read `docs/architecture/线程迁移记忆.md`.
