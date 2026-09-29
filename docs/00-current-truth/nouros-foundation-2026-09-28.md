# NourOS intelligence foundation — 2026-09-28

## Status

**BUILT + TESTED on branch `feat/nouros-foundation-20260928`; not yet a production claim.**

This slice deliberately reuses StateNour's existing substrates instead of adding parallel systems:

- `RealityEvent` stays the append-only evidence substrate.
- `Mission` stays the project/objective model.
- Inngest stays the durable workflow engine.
- `ToolSelectionTurn` + `ToolGateDecision` stay the tool-routing evidence.
- the existing verified-regen selector stays the answer-repair path.
- E2B remains the existing code sandbox integration.

No new database table and no new external service were introduced.

## What this slice adds

### 1. Universal Episode envelope over RealityEvent

`lib/intelligence/episodes.ts` creates a typed learning envelope for decision, tool, tool_gap, mission, content, experiment, and business_outcome events.

Episodes carry structured hashes, policy/model/code revision fields, action/receipt/outcome/business-value metadata, latency and operator feedback. They are persisted through `recordEvidenceBatch()`, so the existing PII tripwire and provenance rules still govern writes.

Raw prompts are not part of the Episode contract.

### 2. Bounded durable mission execution

`queueMissionExecution` and `lib/missions/durable-execution.ts` reuse existing ACTIVE Mission rows and Inngest.

V1 supports only two step kinds: `checkpoint` and `research` via the existing deep-research service.

The runner records queued/started/step_started/step_completed/completed/attempt_failed Episode receipts and survives chat/browser closure through Inngest checkpoints.

**Important boundary:** the runner does not auto-complete or mutate Mission lifecycle state. It is gated by `NICK_DURABLE_MISSIONS`, which defaults OFF. This prevents a tested implementation from being silently promoted before deployed registration and one real execution receipt exist.

### 3. Tool-gap intelligence from existing routing telemetry

`lib/observability/tool-gap-report.ts` does not create a duplicate event stream. It reads the existing `searchToolsFired`, `invokeToolFired`, `invokedToolName`, gate verdicts, budget truncation, and semantic-tier attempt/cold-cache fields.

The `/system/tools` page now exposes a Tool Gap Intelligence panel. Recovery of an existing tool is classified as a routing/discoverability/service issue before anyone concludes that StateNour needs another permanent tool.

### 4. Verified-regen telemetry is now persisted

The existing `formatRegenTelemetry()` helper previously had no writer. The verified regeneration path now persists `chat.pre_stream_regen` through the existing metric service with the trace ID.

This closes the known instrumentation gap needed to measure real repair attempts/wins instead of relying only on logs.

### 5. E2B network policy is explicit and test-pinned

E2B's SDK defaults sandbox internet access ON. `runPython` now creates sandboxes with `allowInternetAccess: false` explicitly, with a regression test that fails if the deny-egress option disappears.

No `E2B_API_KEY` is added by this slice. The integration remains unavailable in production until it is provisioned deliberately.

## Verification receipts

Local isolated-worktree receipts before PR:

- targeted tests: **45/45 passed** across 8 test files
- StateNour TypeScript: **passed** after building the three local workspace dependencies required by a fresh worktree
- changed-file ESLint: **passed**
- `git diff --check`: **passed**
- staged secret scan: **no findings**

The existing `missions-tools.test.ts` emits two known test-only warnings from the tool-result fencing fallback and one intentional mocked audit failure; all assertions pass.

## Activation / promotion gates

### Durable missions
Do not turn `NICK_DURABLE_MISSIONS=true` merely because CI is green. Required sequence:

1. merge + deploy
2. verify the new Inngest function is registered
3. run one harmless checkpoint-only mission
4. confirm queued -> started -> step_completed -> completed RealityEvent episodes
5. then enable broader bounded research steps

### E2B
Do not provision `E2B_API_KEY` until the production sandbox path is reviewed with the explicit deny-egress contract intact.

### Regen telemetry
After deploy, collect enough real weak-draft cases to report repair-attempt and repair-win rates. A writer existing is not evidence that repair quality improved.

## Explicitly not built in this slice

This is the foundation, **not** the full probabilistic Decision Plane discussed in the 2026-09-28 Jev/TypeSafe review.

Still separate work:

- vendor-neutral typed probabilistic decision client
- shadow backends / calibration corpus
- Jev/Kev/Laya evaluation and backend selection
- decision distributions for tool/web/depth/model-lane selection
- outcome-calibrated promotion thresholds

Those should sit on top of this Episode/outcome substrate rather than duplicate it.
