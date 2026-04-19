# GENERGI Model Control Plane Redesign

Date: 2026-04-19
Status: Approved by operator direction, ready for implementation
Scope: Rebuild model/provider management as a first-class control plane for GENERGI, covering both operator-facing model selection and engineering-safe runtime resolution.

## 1. Background

The current model configuration is still effectively code-owned:

- provider/model defaults are defined in `packages/config/src/index.ts`
- mode behavior is compiled into static `MODE_MODELS`
- task runtime is frozen from these code defaults at task creation time
- changing models frequently requires engineering edits, release work, and risk across multiple layers

This is now too rigid for the intended usage model.

The operator requirement is clear:

- providers and models must be manageable from the system itself
- providers/models must support frequent changes
- both operations and engineering must be served by the same system
- the first version should stabilize the bottom layer before adding heavier platform abstractions

## 2. Decision

We will implement **Solution B**:

> Build a self-owned model control plane plus a unified effective-config resolver, while keeping the current direct provider execution paths inside the worker.

We will **not** introduce a separate gateway service in the first version.

## 3. Why Solution B

### 3.1 Not Solution A

We will not merely add CRUD on top of the existing `packages/config` constants.

That would preserve the current weaknesses:

- code-owned defaults remain the real source of truth
- runtime behavior still depends on static mappings
- provider credential rotation remains clumsy
- model overrides remain difficult to reason about

### 3.2 Not Solution C Yet

We will not introduce a standalone model gateway service yet.

That is too heavy for the current phase because it would require:

- a new deployable service
- a new internal protocol for text/image/video/TTS
- worker-to-gateway migration
- new operational complexity before the management problem is even solved

The immediate pain is control and changeability, not multi-product infra reuse.

## 4. Product Goal

The control plane must make model management feel like a real production system rather than a source file edit.

The system must support:

1. backend-managed provider records
2. backend-managed model records
3. encrypted provider credentials and endpoints stored by the system
4. validation state before a provider/model becomes selectable
5. three-level resolution:
   - global default
   - mode default
   - task-level override
6. frozen runtime snapshots at task creation

## 5. Core Principle

The model control plane is the only source of truth for:

- which providers exist
- which models exist
- which models are active/selectable
- which capability flags they expose
- which defaults are effective at each layer

Static code defaults may exist only as bootstrap seed data, not as the authoritative long-term control surface.

## 6. Scope

### 6.1 In scope

- provider registry
- model registry
- provider credential encryption storage
- provider/model validation lifecycle
- global default settings
- mode default settings
- task override settings
- effective-config resolution
- task runtime freeze snapshot
- admin UI for provider/model management
- task creation UI for controlled slot overrides

### 6.2 Out of scope for the first version

- standalone gateway service
- cross-product shared AI platform
- dynamic shadow routing / A/B routing
- automatic performance-based routing
- provider billing aggregation platform

These may follow later once the control plane itself is stable.

## 7. Required Slots

The first version must support fine-grained management for these six slots:

- `textModel`
- `imageDraftModel`
- `imageFinalModel`
- `videoDraftModel`
- `videoFinalModel`
- `ttsProvider`

The system must not collapse these into one generic “current model” field.

## 8. Registry Model

### 8.1 Provider Registry

A provider record represents one authenticated upstream connection target.

Required fields:

- `id`
- `providerKey`
  - internal stable identifier such as `anthropic-prod-01`
- `providerType`
  - e.g. `anthropic-compatible`, `openai-compatible`, `edge-tts`, future `azure-tts`
- `displayName`
- `endpointUrl`
- `authType`
  - e.g. `bearer_token`, `api_key_header`, `none`
- `encryptedSecret`
- `status`
  - `draft`
  - `validating`
  - `available`
  - `invalid`
  - `disabled`
  - `deprecated`
- `lastValidatedAt`
- `lastValidationError`
- `createdAt`
- `updatedAt`

### 8.2 Model Registry

A model record represents a provider-backed runnable capability entry.

Required fields:

- `id`
- `modelKey`
  - internal stable identifier such as `veo-3-1-fast-prod`
- `providerId`
- `slotType`
  - one of the six supported slots
- `providerModelId`
  - exact provider-facing upstream model string
- `displayName`
- `lifecycleStatus`
  - `draft`
  - `validating`
  - `available`
  - `invalid`
  - `disabled`
  - `deprecated`
- `capabilityJson`
  - size, async support, single-shot ceiling, orientation, quality tier, etc.
- `lastValidatedAt`
- `lastValidationError`
- `createdAt`
- `updatedAt`

### 8.3 Why provider and model must be separate

Providers rotate credentials, base URLs, and auth policies.

Models rotate:

- upstream model ids
- lifecycle states
- capability metadata
- approved usage slots

They must be separate registries, not one mixed table.

## 9. Validation Lifecycle

### 9.1 Provider validation

When a provider is created or updated:

1. it enters `validating`
2. the system checks:
   - endpoint syntax
   - auth configuration presence
   - authentication success
3. if valid:
   - provider becomes `available`
4. if invalid:
   - provider becomes `invalid`
   - validation error is stored

No lightweight real generation smoke is required in the first version.

### 9.2 Model validation

When a model is created or updated:

1. it enters `validating`
2. the system checks:
   - linked provider is `available`
   - providerModelId exists or is accepted by the upstream provider
   - required capability metadata is present or derivable
   - the model is valid for the declared slot type
3. if valid:
   - model becomes `available`
   - it automatically enters the selectable pool
4. if invalid:
   - model becomes `invalid`
   - validation error is stored

## 10. Effective Resolution Model

The system must compute the effective runtime choice using three layers:

1. `global defaults`
2. `mode defaults`
3. `task-level overrides`

Priority:

`task override > mode default > global default`

This resolution must happen through one shared resolver, not through ad-hoc UI code or worker fallback guessing.

## 11. Frozen Task Snapshot

At task creation time, the system must freeze:

- selected provider ids
- selected model ids
- display labels
- capability metadata needed by the worker
- review requirements derived from the resolved mode+model configuration

This snapshot becomes part of `taskRunConfig`.

Once frozen:

- later global default changes do not affect the task
- later mode changes do not affect the task
- later provider/model deprecations do not retroactively rewrite historical task runs

## 12. Management UI

### 12.1 Admin console areas

The first version should provide:

1. **Provider Management**
   - create/edit provider
   - encrypted credential input
   - validation status
   - enable/disable

2. **Model Management**
   - create/edit model
   - bind to provider
   - assign slot type
   - view capability metadata
   - validation status
   - enable/disable/deprecate

3. **Default Resolution Center**
   - global defaults per slot
   - mode defaults per slot
   - visible effective precedence

### 12.2 Task creation surface

Task launch should support:

- normal operator path:
  - pick mode
  - use defaults
- advanced operator path:
  - open controlled override panel
  - choose from validated selectable models for each slot

This must use only `available` records from the registry.

## 13. Security Model

Provider credentials and endpoints are stored by the system.

Required controls:

- secrets must be encrypted at rest
- decrypted secrets must be available only in API/server runtime
- frontend must never receive raw provider secrets
- task snapshots store resolved model/provider identity, not raw secrets

The first version may use application-managed symmetric encryption if done correctly, but the key itself must be provided by environment/secure deployment config, never hardcoded.

## 14. Runtime Integration

Worker changes must be limited to:

- consuming the resolved frozen task snapshot
- no longer relying on static `MODE_MODELS` as the primary truth
- keeping current direct provider execution paths

The worker should not own:

- provider selection
- model lifecycle decisions
- default precedence logic

Those belong to the control plane and resolver.

## 15. Bootstrap Strategy

The current static config should become seed data:

- built-in providers
- built-in models
- built-in mode defaults

On boot or migration:

- if registry data does not exist, seed from current defaults
- once registry data exists, runtime should prefer registry data

This allows transition without a flag day rewrite.

## 16. Migration Rules

### 16.1 Existing tasks

Existing tasks remain valid because they already carry frozen `taskRunConfig`.

They must not be rewritten in-place.

### 16.2 Existing modes

`mass_production` and `high_quality` remain as stable mode ids, but their default slot assignments move into managed data instead of static code ownership.

### 16.3 Existing code defaults

Static constants in `packages/config` should downgrade into:

- bootstrap seed material
- fallback only for first-run initialization

They should stop being the primary live control plane.

## 17. Phase-1 Deliverable For This Project

This project is complete when:

1. provider records can be created and securely stored
2. model records can be created and linked to providers
3. validation lifecycle works
4. validated records automatically become selectable
5. global/mode/task resolution works
6. task creation freezes the resolved snapshot
7. worker uses the frozen snapshot
8. operators can override from validated model pools
9. defaults can be changed in the backend without code edits

## 18. What Success Looks Like

When this redesign succeeds:

- changing a model no longer requires editing `packages/config/src/index.ts`
- operators can safely switch validated models from the system UI
- engineering keeps control of runtime integrity through validation and snapshot freezing
- worker behavior is reproducible from persisted task config
- the product can later grow into a gateway architecture without rewriting the control plane

