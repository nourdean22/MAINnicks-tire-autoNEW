# Hour-frame key census · 2026-08-27

**The numbers, from prod** (probe: `scripts/probe-hour-frame-census.ts`, read-only,
host `ep-quiet-wave-am320eo1-pooler.c-5.us-east-1.aws.neon.tech`, boundary =
`HOUR_FRAME_BOUNDARY_ISO` = 2026-08-25T15:17:30Z, the #1809 merge instant):

| key family | pre-boundary (UTC-keyed) live | soft-deleted | post-boundary (ET-keyed) live | soft-deleted | `hourFrame` marked |
|---|---|---|---|---|---|
| `journal_mood_{date}_{h}` | 90 | 19 | 2 | 0 | 2 |
| `mood_{date}_{h}` | 128 | 92 | 4 | 0 | 4 |
| `booking_hour_{h}` | 0 | 0 | 0 | 0 | 0 |
| `unanswered_leads_{date}_{h}` | 0 | 0 | 0 | 0 | 0 |

**Totals: 218 live UTC-keyed · 6 live ET-keyed · 111 soft-deleted (all UTC-keyed).**
The #1894 marker is verified working: every post-boundary row (6 of 6) carries
`metadata.hourFrame = "et"`; no pre-boundary row does. Soft-deleted rows are counted
separately on purpose — they share the `(category, key)` identity space and a bare
count hides them (the 2026-08-20 memory-loop lesson).

Context: still true that **nothing reads the hour** — rows are consumed by category
(`lib/brain/hour-frame.ts` records the 2026-08-26 reader survey; the discovery arm of
`tests/repo/hour-frame.test.ts` gates the writer list). The ambiguity is dormant until
the first hour-aware consumer is built.

## Three options — no decision made here; this is the operator's call

**A · Status quo (marker + boundary constant, nothing else).** Cost 0, no prod write.
A future hour-aware consumer classifies unmarked rows by
`createdAt < HOUR_FRAME_BOUNDARY_ISO` — a two-source rule (metadata OR timestamp)
that lives in one module. Risk: the rule must be known to be applied; hour-frame.ts
is the only place that teaches it.

**B · Backfill the marker (`metadata.hourFrame = "utc"` on the 218 live pre-boundary
rows).** Rows become self-describing; keys untouched; reversible (strip the metadata
key). Requires an operator-approved prod write with a `_bak_brain_memories_*` copy
first, and it breaks hour-frame.ts's stated contract ("absence is meaningful, only
ever added, never backfilled") — the module doc flips to explicit-both-ways. Decide
whether the 111 soft-deleted rows get stamped too (consistency) or left (they are
tombstones).

**C · Rekey the 218 keys from UTC hour to ET hour.** Uniform key space, no
classification rule forever after. Highest cost and the only destructive option:
`remember()` upserts on `(category, key)`, so a rekeyed row can collide with an
existing row and the #1793 tombstone chain applies to any key surgery on this table
(a soft-deleted row holds its unique key; the swap can resurrect or permanently
shadow). 218-row prod write, backup + reversible bridge required, and today it buys
nothing — there is no hour reader to serve.

## Decision — 2026-08-28 (operator): exclude, don't migrate — executed and ratcheted

Marker + boundary stand; **pre-boundary rows are retained**, excluded from any keyed-hour
aggregate, window labelled "since 2026-08-25 (ET frame)". Enforced mechanically:
`tests/repo/hour-frame.test.ts` now DISCOVERS key-prefix readers and fails any that do not
reference `HOUR_FRAME_BOUNDARY_ISO` (positive + negative controls; a planted unbounded reader
kills exactly one arm). Measured for the reconsideration clause: migration IS technically
viable — all 218 live pre-boundary rows carry `createdAt`, so `hourET(createdAt)` rekeying
would be DST-exact — and is still declined: a rewrite of behavioural history with zero
hour-readers on the other end. Engine audit (2026-08-28): `decision-patterns`,
`time-intelligence`, `teaching-moments`, `counter-intuitive` all derive hours from absolute
`createdAt` via `hourET()` and read none of these keys — their aggregates were never
mixed-frame, so their timestamp windows deliberately keep pre-boundary data.

## Adjacent items closed in the same batch

- `camera-intelligence` denominators fixed (ET day start, active-days average,
  clamped utilization) — see the batch commit; the mixed-frame numerator/denominator
  there was the same defect family at the aggregation layer.
- `operating-rhythm.ts:278` — the stale "UTC OK" comment was already replaced by
  #1888 (verified on origin/main: the line now documents the correction and reads
  `weekdayET()`); the repo-wide comment-frame gate measured the shape at one
  instance, now zero.
