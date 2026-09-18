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

   **If another OPEN branch already carries a same-day entry at the top,
   insert yours BELOW that day's entries and say so in the commit** — a
   conflict on this file's line 3 is the commonest way a docs commit stalls
   a sibling's merge (2026-09-15: Session B's two entries sat at the top
   with its next PR open; the waves 2-3 entry went beneath them).

   Then update the `**Last verified:**` stamp. **Do not trust a line number
   for it — find it with the guard's own regex.** `check-stale-docs.ts:226`
   matches `/Last verified:(?:\*\*|\s)*(\d{4}-\d{2}-\d{2})/i`, i.e. the first
   occurrence *followed by a DATE*. Verified 2026-09-18.

   Run it from the REPO ROOT (the normal working directory) — the path is
   `apps/statenour/docs/RECONCILIATION.md`. A bare `docs/RECONCILIATION.md`
   throws `ENOENT` from the root, which is exactly how the first version of
   this probe shipped: broken, in the step whose entire purpose is to stop you
   editing the wrong stamp. Caught in review on #2428.

   ```bash
   node -e "const fs=require('fs');const p='apps/statenour/docs/RECONCILIATION.md';const c=fs.readFileSync(p,'utf8');const m=/Last verified:(?:\*\*|\s)*(\d{4}-\d{2}-\d{2})/i.exec(c);console.log(m&&m[1],'line',m&&c.slice(0,m.index).split('\n').length)"
   ```

   This skill previously said the guard reads a stamp "embedded mid-line
   inside the corrupted 2026-06-21 blockquote near line 5" and told you to
   update that one. **That is now wrong in two ways** and following it would
   edit the wrong stamp: the corrupted blockquote sits near line 3062, not 5,
   and it contains the bare text `` `**Last verified:**` `` with NO date — so
   the regex skips it. The live match is the standalone stamp (line 3590 as
   of 2026-09-18). Line numbers in this file move every wave; re-run the
   probe instead of trusting any of these numbers, including these.

   `AGENTS.md`'s `**Last refreshed:**` date must EQUAL the stamp above
   (`check-stale-docs.ts:336` compares them and fails on mismatch).

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
