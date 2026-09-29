# NourOS capability lifecycle / Toolsmith — current truth

Date: 2026-09-28 ET
Status: MERGED to `main` in PR #2757 as `3178a894ff1d39d402837b214d060ce7b61b3a55`. Production usage remains operator-gated; live capability-lifecycle events are still needed for production proof.

## Why this exists

The repo already had the canonical Tool Registry, Tool Policy, ToolSelectionTurn/ToolGateDecision telemetry, Tool Gap report, and durable ActionAttempt execution receipts. The missing layer was capability lifecycle.

This slice adds lifecycle without creating another tool registry or granting self-install authority.

## Gap routing

Tool Gap classes now have an explicit lifecycle response:

- `DISCOVERABILITY_GAP` → `FIX_DISCOVERABILITY`
- `ROUTING_GAP` → `FIX_ROUTING`
- `EXTERNAL_SERVICE_GAP` → `REPAIR_INTEGRATION`
- `UNRESOLVED_GAP` → `INVESTIGATE_NEW_CAPABILITY`

A routing/discoverability/service gap cannot be submitted as a brand-new capability unless the proposal identifies the registered incumbent tool being repaired/reused.

## Append-only capability lifecycle

Capability proposals and state changes reuse RealityEvent Tool Gap Episodes.

States:

`PROPOSED → APPROVED → IMPLEMENTED_UNVERIFIED → VERIFIED → RETIRED`

A proposal may also become `REJECTED` from PROPOSED, APPROVED, or IMPLEMENTED_UNVERIFIED.

Hard boundaries:

- Toolsmith has proposal/lifecycle authority only.
- It cannot install code, activate a registry entry, or execute a new tool.
- `IMPLEMENTED_UNVERIFIED` requires an external implementation reference such as a PR/commit/artifact.
- `VERIFIED` requires a verification reference/receipt.
- Illegal state jumps are rejected.
- Gap telemetry stays bounded by the requested report window, but lifecycle history is read all-time so unresolved proposals cannot silently age out of governance.
- Capability risk/approval posture is derived from requested read/write/external-mutation/memory-write behavior and recorded with the proposal.

## Operator surface

The existing `system.tools` tRPC router now carries:
- lifecycle report,
- proposal mutation,
- lifecycle transition mutation.

The existing Tool Gap panel now shows the lifecycle response for each gap and proposal counts for proposed / approved / built-unverified / verified.

No new auth surface was created.

## Verification

- 8/8 capability lifecycle tests green, including a regression test proving old unresolved proposals do not age out of the report.
- Existing Tool Gap tests remain 4/4 green.
- 12/12 combined focused Toolsmith + Tool Gap tests green.
- Changed-file ESLint green.
- `git diff --check` green.

## Not claimed

This does not mean the system can autonomously manufacture or deploy tools. The implementation and activation boundaries remain external/explicit by design. Production proof remains pending until the merged code is deployed/exercised and real lifecycle events exist.
