# Runbook · Stale-doc cleanup + the guard

- **Status:** active · **Domain:** docs · **Risk:** low · **Last verified:** 2026-06-09
- **When to use:** a doc asserts a retired deploy/provider fact as current, or before adding a new doc.
- **Source of truth:** [`../CURRENT-TRUTH.md`](../CURRENT-TRUTH.md), [`../../scripts/check-stale-docs.ts`](../../scripts/check-stale-docs.ts).

## Rules

1. **Quarantine, don't delete.** Move a historical doc into `docs/archive/**` with a `*-HISTORICAL-DO-NOT-EXECUTE` filename via `git mv`, and leave a pointer **stub** at the original path so links still resolve.
2. **Active docs state only current truth.** No retired deploy facts as current instructions. Point provider/model claims at `lib/ai/provider.ts` — don't hardcode a model.
3. **Mark history clearly.** A doc the guard should skip must announce itself (a `historical`/`retired` banner in its header, a dated filename, or live under `archive/`).

## Commands

```
pnpm check:stale-docs                  # advisory (exit 0)
STALE_DOCS_STRICT=1 pnpm check:stale-docs   # fail on critical findings
```

## Gotchas

- The guard exempts `archive/`, `adr/`, dated filenames, bannered files, and lines with a safe word within ±2 lines — so a legitimately retired mention ("X is retired") never trips it, but a fresh current-tense claim does.

## Verification

- `pnpm check:stale-docs` reports 0 critical.

## Rollback

- `git restore` the doc; quarantines are `git mv` and fully reversible.
