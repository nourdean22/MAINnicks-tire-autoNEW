---
name: statenour-wave-reconcile
description: Use at the end of a statenour work wave (a batch of commits) — add a docs/reconciliation/ entry file and refresh AGENTS.md so the next session resumes on accurate ground truth.
triggers: end of a wave, batch of commits, reconciliation.md, refresh docs, ground truth, ship history, wave reconcile, statenour docs
---

# statenour-wave-reconcile

`AGENTS.md` mandates "refresh after every wave" — but the refresh is
routinely skipped, and the docs drift weeks behind reality. Run this
when a wave of work lands, before ending the session.

## Procedure

1. **`apps/statenour/docs/reconciliation/<YYYY-MM-DD>-<slug>.md`** — one
   NEW file per PR (since 2026-11-02). Never insert into
   `RECONCILIATION.md` any more: every PR inserting at its line 3 made any
   two open PRs conflict there (PRs 3500, 3504, 3506, 3507, 3508 went
   DIRTY against each other five times on 2026-11-01/02). The file's first
   line must carry the file's date, in the existing blockquote format:
   - `> ## <date> · <wave name> · <N> ships`
   - a summary paragraph
   - a ship-by-ship roll-up — one bold line per commit
   - a `**Flagged · NOT fixed**` list for known-but-deferred issues

   Check it with `node scripts/agent-os/reconciliation-render.mjs --list`
   (exit 1 names a misnamed file or a header whose date differs from the
   name). The bdnick change digest reads the newest file as the latest wave.

   Then, once per wave (not per PR: it is one shared line), update the
   `**Last verified:**` stamp in `RECONCILIATION.md`. **Do not trust a line number
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
