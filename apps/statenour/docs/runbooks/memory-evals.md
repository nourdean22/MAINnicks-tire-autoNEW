# Runbook · Memory evals — the truth scoreboard

- **Status:** active · **Domain:** ai-evals · **Risk:** low · **Last verified:** 2026-06-09
- **When to use:** after changing a truth doc, or to check Statenour still knows its current truth.
- **Source of truth:** [`../../lib/evals/memory-evals.ts`](../../lib/evals/memory-evals.ts), [`../../scripts/run-memory-evals.ts`](../../scripts/run-memory-evals.ts).

## What it is

A typed, deterministic dataset of "does Statenour know its own current truth?"
checks across 10 categories (deployment, source-of-truth, stale-doc, migration
safety, action honesty, task classification, memory kind, business + personal-OS
context, provider truth). Each eval names the truth doc that should **teach** it.

## Memory kinds

Workflow / operating rules — the "how we work here" knowledge in these runbooks —
are **procedural** memory (as opposed to semantic facts or episodic events). The
classifier treats procedural rules as durable, not as one-off observations.

## Rules

1. **Docs are graded for teaching facts.** `gradeDoc` checks a truth doc contains the expected facts; `forbiddenClaims` are NOT applied to docs (a truth doc must name retired terms to mark them retired). `forbiddenClaims` grade free-form **answers**.
2. **The runner is pure.** No DB mutation, no external API by default. LLM judging is a future, off-by-default flag.
3. **Add an eval whenever a current-truth fact must not regress** — give it a `groundingDoc` so it grades deterministically.

## Commands

```
pnpm eval:memory               # per-category scoreboard; fails on critical grounded regressions
pnpm test -- tests/lib/evals
```

## Gotchas

- An eval grounded against a runbook reads as **manual** until that runbook md exists on disk.

## Verification

- `pnpm eval:memory` → 0 critical fail · `tests/lib/evals` green.

## Rollback

- Delete `lib/evals/**` + the `eval:memory` script line; nothing depends on it.
