# Reel-pack backlog status — 2026-08-28 10:30 UTC

## What changed since the last status note (2026-08-27 19:30 UTC, #1948)

That note found the recurring trigger was producing far more content-pack
inventory than the one real consumer needs, and sent a direct notification
recommending the operator confirm intent or throttle the schedule. Nothing
about that math has changed — but the trigger kept firing on the same
cadence regardless: **12 more reel-pack PRs opened in the 15 hours since**
(#1952–#1965, 13:35–08:31 UTC), zero merged. Open PR count is now **18**,
16 of them reel packs. Merged inventory is still 118 dirs (2026-08-14 to
2026-08-27) since the last bulk-merge (~12:56–13:13 UTC yesterday) — so
every one of last night's 12 firings added supply nobody has reviewed yet,
on top of a backlog already measured at ~2x the real 30-day requirement.

## Why this run adds no new content pack

Same finding as #1948, now with a second data point: `packCoveredTopics(30)`
in `server/services/reelPackRegistry.ts` is still the only real consumer of
this directory, still only needs ~60 distinct topics across a rolling
30-day window (2/day cap), and committed + open inventory is still sitting
at 134 (118 merged + 16 open), well past that. Adding a 17th open PR
increases review debt for topic-collision insurance the system already has
in multiples of excess — the same reasoning #1948 gave, unchanged by one
more cycle.

## Why this run sends no new notification

#1948 already sent a direct notification for this exact finding 15 hours
ago. Nothing decision-relevant is different now — same root cause, same
unresolved question (intentional inventory vs. accidental overproduction),
same "no in-session tool can change trigger cadence" limit. A second
notification restating an unactioned finding is the kind of duplicate ping
the notification tool's own guidance says not to send; it would be noise,
not new information. This note exists as the dated receipt only.

## Standing ask (unchanged from #1948, still open)

1. Confirm whether ~134 banked/pending topics is intentional inventory or
   accidental overproduction from a trigger nobody throttled.
2. If accidental: reduce or pause this scheduled task's firing cadence at
   the account/trigger level.
3. If intentional: widen `packCoveredTopics`'s 30-day window or document a
   target inventory size so a future run has an explicit stopping rule.

## Test plan

N/A — markdown status note only, no code changes.
