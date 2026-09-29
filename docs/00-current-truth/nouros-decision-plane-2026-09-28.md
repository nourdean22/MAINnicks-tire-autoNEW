# NourOS Decision Plane — current truth

Date: 2026-09-28 ET  
Scope: StateNour / NourOS probabilistic decision shadow + calibration foundation.

## Status

BUILT + LOCALLY VERIFIED on branch `feat/nouros-decision-plane-20260928`. Not merged and not production-proven at this receipt.

This slice is deliberately **shadow/advisory only**. It does not alter chat routing, tool authority, approval boundaries, mission authority, or provider selection. The incumbent StateNour path remains authoritative.

## What exists

- Vendor-neutral typed decision contracts for noul / choice / score questions.
- Strict HTTP System-One-compatible backend adapter with:
  - http(s)-only endpoint validation,
  - credential-in-URL rejection,
  - private-network detection,
  - explicit opt-in before raw state can leave the private network,
  - strict answer-type, option, score, usage, and probability-distribution validation,
  - bounded request timeout.
- Candidate backend registry for Decider, Kev, and TypeSafe-compatible endpoints.
- Turn Decision schema over incumbent StateNour signals.
- Honest incumbent comparison: only fields the incumbent actually owns are compared; `needsBackgroundMission` has no fabricated baseline label.
- Deterministic bounded shadow sampling.
- Private-mode and obvious-PII rejection before enqueue.
- Durable Inngest shadow evaluation outside the chat response path.
- Decision Episodes persisted through the existing RealityEvent ledger; raw prompt text is not persisted in the Episode.
- Calibration primitives: normalized multiclass Brier, categorical log loss, and top-label ECE.
- Operator report + /system/tools panel showing backend configuration, sample counts, failures, latency, and incumbent agreement.
- Promotion is hard-coded false in the report. Incumbent agreement is explicitly not treated as correctness or calibration.

## Configuration

The feature flag `NICK_DECISION_PLANE_SHADOW` defaults OFF.

A shadow run also requires:
- `DECISION_PLANE_SHADOW_BACKENDS` to name one or more supported candidate backends,
- backend-specific endpoint/model credentials as applicable,
- configured Inngest,
- passing private/PII/sample gates.

`NICK_DECISION_PLANE_ALLOW_EXTERNAL_STATE=1` is a separate explicit operator attestation required before a public candidate endpoint may receive raw decision state. Hosted TypeSafe-compatible use is therefore blocked by default even if an API key exists. `DECISION_PLANE_SHADOW_SAMPLE_PCT` is a numeric sampling knob (default 10, clamped 0–100), not a feature switch; the `NICK_` prefix is intentionally reserved for actual switch-board entries.

## Verification receipt

Focused Decision Plane suite: **17/17 tests green** across:
- backend endpoint/security policy,
- strict response/distribution validation,
- turn request + incumbent comparison semantics,
- calibration math,
- shadow sampling/gating/enqueue behavior,
- report aggregation.

Changed-file ESLint and `git diff --check` are green.

A full local StateNour TypeScript sweep is currently not a trustworthy machine-local signal because NattyNour is resource-constrained (16 GB RAM, near-full C: drive, paging pressure) and the compiler process exhausted memory. Full type/test/build must therefore be taken from GitHub CI after push.

## Replay Lab / outcome calibration

The same branch now also contains the first Replay Lab slice, reusing the existing RealityEvent Episode lineage instead of creating a replay database:

- An operator can append an `episode.decision.outcome_observed` event to an existing candidate `episodeId`.
- Observed labels are validated against the typed turn question contract before they are accepted.
- Corrections remain append-only: another `outcome_observed` event with the same `episodeId` supersedes the earlier label for replay purposes while preserving history.
- Replay scoring uses only explicitly labeled answers; unlabeled candidate Episodes stay visible and are never coerced to zero/negative outcomes.
- Per-backend Replay Lab metrics include label coverage, scored-answer count, mean Brier, mean log loss, and categorical ECE.
- The operator mutation and replay readout live on the existing `system.tools` tRPC surface, and the existing Decision Plane panel shows the replay metrics.
- The report still hard-codes `promotionReady=false`.

Replay verification: **22/22 focused Decision Plane tests green**, plus changed-file ESLint and `git diff --check`.

## Promotion boundary

Do **not** promote a candidate based on incumbent agreement or a small replay cohort. Replay scores are evidence, not authority. Any promotion still requires explicit operator review and an intentional authority change after enough representative observed labels exist.

Next coherent slice: capability lifecycle / Toolsmith and exception consolidation, reusing the existing tool catalog, Tool Gap telemetry, policy layer, and action receipts rather than creating a second tool registry.
