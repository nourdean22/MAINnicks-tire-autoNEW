# Decision Log — Personal OS

This log documents major architectural decisions, work package executions, and justifications in the monorepo.

## Decision: WP-0 — de-Venice Residual Cleanup & Drift Guard
- Date: 2026-06-20
- Context: Statenour deep-research report (verified) — drift / config / security / perf remediation
- Assumptions:
  - Known: Venice AI is fully retired at the primary chat provider layer (`lib/ai/provider.ts`).
  - Likely: Removing all residual references will prevent future agent confusion and codebase pollution.
  - Unknown: Whether any external/historical logs or analytics databases store references that we should retain code-level parsing support for (we will keep historical message parsing in `nick-message.tsx` but clean up telemetry/loading UI).
- Options considered:
  - Option A: Keep Venice as a dormant fallback (requires keeping API keys, and docs saying it's a fallback).
  - Option B: Fully retire Venice, clean up all residual references, remove dead routes, and update suggestions metrics from "venice" to "ai".
- Chosen move: Option B (Full Retirement)
- Why this is wise: Collapses provider truth to the active set, cleans up confusing stale loading states/error messages, and prevents future developer/agent drift via a strict test guard.
- Risks: Summing historical "venice" metrics under "ai" in suggestion telemetry could cause slight discrepancy if tags are parsed strictly, but we handled it defensively.
- Reversal plan: Revert the PR branch `statenour/de-venice-residual`.
- Review date: 2026-07-20
- Result: Pending verification
