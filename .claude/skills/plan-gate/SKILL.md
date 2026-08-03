---
name: plan-gate
description: Use when handed a pasted plan, audit, roadmap, or "here's what you should build" from another agent or tool — before doing any of the work. In this repo most such plans are already built; docs/UPSTREAMS.md exists specifically to prove it.
---

# plan-gate

External plans arriving in this monorepo have a measured failure mode: **most
of the proposal already exists.** `docs/UPSTREAMS.md` opens by recording nine
external audits in two days that re-proposed platforms already adopted, already
rejected with receipts, or already built natively — twelve incumbent-collisions,
each caught only by hand-gating the proposal.

Gate first. Build second. A plan is a hypothesis about what is missing.

## Order of checks

Run these before writing any code or agreeing to any scope.

1. **`docs/UPSTREAMS.md`** — the disposition register. If the plan proposes
   adopting an external tool or platform, it very likely has a verdict already.
2. **`apps/<app>/docs/CURRENT-TRUTH.md`** — what is actually live in that app.
   statenour's copy is guarded by `pnpm check:stale-docs`.
3. **`apps/statenour/docs/BLUEPRINT-2026-07-28.md`** — the work-package list.
   Check whether the proposal is an existing WP, and whether that WP is closed.
4. **`git log --oneline -40`** and the memory index — a plan re-proposing last
   week's shipped work is the common case, not the exception.
5. **Only now**, scope what is genuinely new.

## Verdict vocabulary

Reuse `UPSTREAMS.md`'s scorecard rather than inventing terms:

| Verdict | Meaning |
|---|---|
| **ADOPTED** | running in production, receipt linked |
| **NATIVE** | first-party code already covers it; adopting would duplicate a live lane |
| **PATTERN** | took the design, not the dependency |
| **WATCH** | real value, missing prerequisite — state a concrete revisit trigger, never "later" |
| **REJECT** | wrong for this system; state the reason |
| **DEAD** | upstream unmaintained or unverifiable |

## Reporting the gate

State the split explicitly before starting work:

- **Already built** — item, plus the receipt (file, PR, or table) proving it
- **Genuinely new** — the only part worth planning
- **Refuted** — claims the plan asserts that the code contradicts

Name the percentage. "~85% of this plan is already shipped; here are the three
items that are not" is the useful answer, and it is usually the true one.

## When the gate finds something new

Write it up as a work package, then hand off to the normal flow
(`brainstorming` → `writing-plans`). Do not let a pasted plan skip design
review just because it arrived pre-formatted and confident.

## Closing the loop

**When a verdict changes, update `docs/UPSTREAMS.md`.** The register only ends
the re-proposal loop if it stays current — an unrecorded rejection gets
re-proposed next month by the next tool.

Related: `session-observer` at the end of a wave · `statenour-wave-reconcile`
for statenour ship history.
