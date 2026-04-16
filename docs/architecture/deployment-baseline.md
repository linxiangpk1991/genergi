# Deployment Baseline

## Primary Entry
- ai.genergius.com

## Shared Host Strategy
- Reuse the existing production host used by `anhe_automation`.
- Keep GENERGI isolated under `/opt/genergi/`.

## Recommended Layout
- `/opt/genergi/releases/<timestamp>`
- `/opt/genergi/current`
- `/opt/genergi/shared/`
