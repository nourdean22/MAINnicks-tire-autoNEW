---
name: statenour-wave-reconcile
description: Use at the end of a statenour work wave (a batch of commits) — refresh docs/RECONCILIATION.md and AGENTS.md so the next session resumes on accurate ground truth.
---

# statenour-wave-reconcile

`AGENTS.md` mandates "refresh after every wave" — but the refresh is
routinely skipped, and the docs drift weeks behind reality. Run this
when a wave of work lands, before ending the session.

## Procedure

1. **`apps/statenour/docs/RECONCILIATION.md`** — prepend a new entry at
   the top, AFTER the `**Last verified:**` header line and BEFORE the
   previous entry. Match the existing blockquote format:
   - `> ## <date> · <wave name> · <N> ships`
   - a summary paragraph
   - a ship-by-ship roll-up — one bold line per commit
   - a `**Flagged · NOT fixed**` list for known-but-deferred issues

   Then update the `**Last verified:**` stamp — **note there are TWO of
   them, and the guard reads the FIRST.** `check-stale-docs.ts` parses the
   first occurrence in the file, which is embedded mid-line inside the
   corrupted 2026-06-21 blockquote near line 5 — not the standalone header
   line near line 57 that looks like the obvious one. Previous waves
   updated only the standalone stamp and left the first at 2026-07-29, so
   `STALE_DOCS_STRICT` fails with "Date mismatch" after an edit that looks
   correct. **Update both, or at minimum the first.**

2. **`apps/statenour/AGENTS.md`** — update `**Last refreshed:**` (§1).
   If the wave changed deploy target, branch, versioning, test counts,
   or the backlog (§5), correct those too.

## Rules

- Record only what actually shipped — do NOT fabricate entries for
  waves you lack first-hand detail on. If the doc has a gap, write
  "gap — backfill pending" rather than inventing it.
- Keep the flagged-list honest: real bugs deferred, not vague TODOs.
- Docs-only change — its own commit, `docs · statenour · …`.

## When NOT to use

Mid-wave (reconcile at the END) · trivial single-commit fixes that
don't change project state worth recording.
