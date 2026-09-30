# Runbook · Current truth — where Statenour runs

- **Status:** active · **Domain:** orientation · **Risk:** low · **Last verified:** 2026-09-29
- **When to use:** first thing in any session, or whenever a doc seems to contradict reality.
- **Source of truth:** [`../CURRENT-TRUTH.md`](../CURRENT-TRUTH.md), [`../../AGENTS.md`](../../AGENTS.md), [`../RECONCILIATION.md`](../RECONCILIATION.md).

## Rules

1. **Production = `main` → Railway → bdnick.info.** Pushing `main` auto-deploys. Nothing else is production.
2. **What's retired** (do not treat as current): Vercel, the `codex/ollama-local` and `statenour-master` branches, the standalone `nourdean22/statenour-os` repo, and the `C:\Users\nourd\NOUR-OS` local path — all **retired**. Canonical checkout is `C:\Users\nourd\NOURCITY`.
3. **Code + RECONCILIATION win.** On any conflict between an older doc and live code / the RECONCILIATION top entry, the code and RECONCILIATION win.

## Commands

```
pnpm check:stale-docs     # active docs assert no retired fact as current
```

## Gotchas

- Historical docs under `docs/archive/**` read like instructions but are **retired** history — never paste them into an agent as current context.
- NattyNour local Qwen/OpenWebUI/external-worker capability is an auxiliary execution surface. It does not replace `main → Railway → bdnick.info` as production authority; read CURRENT-TRUTH for its current proof/promotion state.

## Verification

- `pnpm check:stale-docs` reports 0 critical.

## Rollback

- n/a (read-only orientation).
