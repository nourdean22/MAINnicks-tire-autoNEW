# Reel-pack backlog status — 2026-09-01 22:28 UTC

## What changed since the last status note (2026-09-01 15:32 UTC, #2051)

Same recurring scheduled task ("generate a complete faceless short-form video
workflow") invoking `.claude/skills/nickstire-reel-operator/SKILL.md`. Per its
convention, checked prior art first: `ls apps/nickstire/docs/reel-packs/`
(still **136 merged dirs**, byte-for-byte the same count #2051 recorded) and a
GitHub PR search for open reel-pack PRs.

**Nothing was merged from that queue in the 7 hours since #2051**, and it is
not because the operator was away: in that same window they merged **ten**
other PRs on this repo (#2042, #2043, #2047, #2048, #2049, #2050, #2052,
#2053, #2054, #2055 — the most recent at 21:32 UTC, less than an hour before
this note). The six reel-pack PRs from earlier today (#2037, #2038, #2041,
#2044, #2045, #2046) plus #2051 itself are all still open. That rules out
"notification didn't reach anyone" — the account is actively merging work all
day, just not from this specific queue.

## New fact #2051 didn't have: the publish path itself is closed, independent of backlog size

One of the ten PRs merged in this window is directly relevant and changes the
calculus for whether adding more topic packs is useful right now:

**#2042** ("give the default-deny reel publish gate a handle") states plainly
that autonomous reel publishing has been **default-deny since #2000**, the
`reel_publish_approvals` table has had **zero writers** until this PR, and
**the daily reel cron has held every reel since 2026-08-29** — three days
before this backlog even started accumulating in earnest. #2042 adds the
missing approval-writer service, but its own PR body is explicit that
**migration `0112_reel_publish_approvals.sql` is hand-applied and was NOT
applied by that PR** — "Until it runs against production TiDB, no approval
can be recorded and no reel can publish."

So independent of whether 136 banked concepts is 1x or 10x the real
30-day/2-per-day requirement (`packCoveredTopics()` in
`server/services/reelPackRegistry.ts`, the point #1948/#2038/#2051 already
made), **nothing in this backlog can currently ship at all** — the publish
door has had no working handle for three days and, even with today's fix
merged, stays shut until an operator runs a schema migration nobody has
authorized. Producing pack #137 today would not just be excess inventory on
top of excess inventory; it would be inventory for a pipeline that cannot
move it regardless of count.

## Why this run adds no new content pack, and sends one notification (not zero)

No new pack: identical reasoning to #2051, now reinforced rather than
superseded — the topic-supply problem was already solved many times over, and
the newly-discovered publish-gate problem means solving it further has zero
marginal value until the migration question is resolved.

One notification, not silence: #2051 already pinged the operator 7 hours ago
for the supply-vs-demand question and got no visible action on this queue.
Repeating that same ping would be the duplicate-notification anti-pattern.
But the migration finding is genuinely new and decision-relevant on its own
(it wasn't inferable from anything #2051 could see), and it changes the
actionable ask from "throttle a schedule" to "run one specific migration, or
explicitly decide not to yet" — a narrower, more concrete request than any
prior note in this chain made. That's worth surfacing once.

## Standing ask, updated

1. **New, higher-priority than the backlog question:** decide whether to
   apply `0112_reel_publish_approvals.sql` to production TiDB (operator
   action only — never run migrations from this skill/session). Until that
   runs, the entire reel-publish pipeline stays closed regardless of #2 below.
2. Confirm whether ~136 banked + 7 pending topics is intentional inventory or
   accidental overproduction from an unthrottled scheduled trigger; if
   accidental, reduce/pause/space out this trigger's firing cadence.
3. Separately, review/merge or reject the backlog of open reel-pack PRs
   (#2037, #2038, #2041, #2044, #2045, #2046, #2051, this one) — they've been
   accumulating for 7+ hours of active repo work without being touched.

## Test plan

N/A — markdown status note only, no code/schema/config changes.
