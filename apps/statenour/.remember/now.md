# NOUR OS — Session Buffer

**Updated: 2026-08-19** · Five fields, nothing else. If the SessionStart briefing
reports this file as stale, distrust everything below it and re-derive from source.

> **Maintenance contract.** This is agent-maintained. Update the five fields at the
> end of any session that changes the answer — it costs four lines. It went
> **114 days** without an update (2026-04-18 → 2026-08-10) and in that time became
> a source of two false beliefs, so the SessionStart hook now prints its age.
> An inventory you cannot verify is worse than no inventory: **delete, don't carry.**

## Current objective
Architecture-reimagine wave (nineteenth) SHIPPED 2026-08-19. Canonical record:
`docs/REIMAGINE-VERDICT-2026-08-19.md` (state-of-the-system verdict + six audit
maps + the adversarial-review record). What landed: ONE canonical priority scale
(higher = more urgent; `lib/scoring/task-priority.ts` bands; source scan pins
asc/lt/plain-desc/legacy-literal violations repo-wide; NULLS-FIRST killed with
`nulls: "last"` at 27 sorts) · unknown ≠ zero on operator surfaces (situation
card, meta-scoreboard measured:false anomalies, Home matrix + /missions
unreadable/stale states, ET-day revenue-mirror honesty, system.hub cached 30s) ·
BDN-310 supersession lane-COMPLETE (writer: contradiction loser stamped +
winner lastVerifiedAt + verdict-flip un-strand; readers: every recall lane incl.
the knnSearch vector boundary) · Task.personId live + FK guard · gateway
kill-switches on the flag board as readOnly/ENV-ONLY. Same-day siblings: Brain
waves 1-2 (#1694/#1697), OS-Health truth pass (#1691), mega-evening dispatch
(#1703). NOTE: main's #1698 was THIS branch's pre-round-2 state pushed by the
operator's ChatGPT session — cross-agent lanes now really do collide; check
`git log origin/main` for your own mirrored work before merging.

## Last material decision
The adversarial pre-merge review is the standard, and it works: a 20-agent
fleet (6 hostile finders + 12 refuters + 2 web researchers) on this wave's own
diff returned 55 findings / 12 CONFIRMED / 0 refuted — including two P0s the
author missed (goals.ts nextMove ascending — invisible to the Prisma-shape
source scan because it's an in-memory `a-b` comparator; triage-someday still
writing old-scale 70) and a class bug (Postgres DESC = NULLS FIRST) across all
27 flipped sorts. Doctrine confirmed against primary sources: per-metric
tri-state unknown (Nagios/Grafana/SRE), TanStack v5 `isError && !data`,
Zep/Graphiti bi-temporal supersession (loser stamped, validUntil = winner's
validFrom, exclusive-end boundaries). A working-looking control that does
nothing at runtime (flag-board OFF for env-only flags) is worse than
invisibility — render ENV ONLY and reject server-side.

## Known failed approaches
- **Rebasing this branch onto main after #1698 — 8-commit replay conflicts.**
  Main mirrored the branch's own earlier state, so merge (take ours on all 27
  conflicts, each main hunk was the older same-fix) was the correct move; the
  PR squash erases the merge commit anyway.
- **Auto fast-forwarding the primary checkout from the scheduled sync — rejected
  as unsafe.** The primary sits on `session-end` with a dirty tree.
- **"git globs `[id]` like PowerShell does" — false.** `git ls-files` measures.
- **Counting raw mocked-model calls while the Phase-1 gateway is live — spills.**
  Assert through a category filter, never raw counts (#1532).

## Active blocker
**Operator actions:** ① legacy `manualPriorityOverride` rows written under the
old lower-is-hotter scale are sticky-inverted until remapped — run the census
(`railway run --service statenour-web -- pnpm exec tsx
scripts/probe-task-priority-overrides.ts`), then authorize the remap (prod
write). ② The primary checkout remains on `session-end`, dirty. ③ Anthropic
spend authorization for the model bake-off (Ollama Cloud still the one funded
lane).

## Next action
Next-wave spine (ranked in REIMAGINE-VERDICT "Highest-leverage next moves"):
① close the outcome loop end-to-end — wire recordOutcome from the recordShown
surfaces, feed Task.outcomeRating/outcomeLesson into runAutoLearn, write
reasoning traces through remember() so they re-enter recall; ② Commitment.status
canonical vocabulary + promise_integrity expired/in_progress fixes; ③ shared
"open task" + "done today" predicates (same treatment as the polarity fix);
④ Home progressive loading (httpBatchStreamLink, bound task.list, visibility-
gate the raw pollers); ⑤ one status-tone module + 15 phantom-token repair +
`--font-mono` bridge line. Route brain-file work through the /brain lane owner
while the lane split stands.
