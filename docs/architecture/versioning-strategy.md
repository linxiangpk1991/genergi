# Versioning Strategy

## Versions
- Schema version: controls database migrations.
- Config version: controls mode, provider, and runtime config shape.
- Feature flags: control risky transitions and compatibility bridges.

## Rules
- Historical task config and cost rows are immutable.
- Registry-backed model IDs are the only valid runtime selection keys.
- Compatibility paths must document removal conditions.
