# Competitor GBP Monitor

**Status: PARTIAL — server poller exists, read surface is new; weekly
collection is manual until a richer admin view ships.**

## Opportunity
Watching local competitors' GBP (review velocity, rating, posting,
owner-response presence) shows where Nick's can out-execute. Review
VOLUME is the gap most worth closing — see the baseline.

## What exists
- **Server poller** (`services/competitorMonitor`) already does daily
  Places polling → `competitor_snapshots` + Telegram alerts. It runs but
  has had no admin read surface (operator can't see trends).
- **New (this PR):** `client/src/lib/competitorGbpMonitor.ts` — the watch
  list, the audit-dated baseline, the weekly-check field list, and a pure
  `reviewVolumeGaps()` helper. Baseline is explicitly dated `2026-06` and
  is a comparison anchor, never presented as live.

## Watch list (2026-06 baseline)
| Competitor | Rating | Reviews |
|---|---:|---:|
| Moe's Tire Center | 4.3 | 639 |
| Moe's Tire Center 3 | 4.2 | 379 |
| St.Clair Tire | 4.9 | 156 |
| Bro's Tires | 4.4 | 267 |
| EJ'S Tire & Auto Repair | 4.7 | 81 |

## Weekly check (manual, ~10 min)
Record per competitor: review count (vs baseline), rating, new posts,
new photos, Q&A activity, owner-response presence, service emphasis,
profile completeness.

## Safety
Read-only / manual. No aggressive scraping, no bypassing Google
protections, no private credentials, no fabricated competitor data.

## Truth source
`client/src/lib/competitorGbpMonitor.ts` + the existing
`competitor_snapshots` table. Future automation: route the poller's
snapshots into an admin read card (integration plan doc).
