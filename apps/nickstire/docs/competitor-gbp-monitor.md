# Competitor GBP Monitor

**Status: PARTIAL — server poller exists, read surface is new; weekly
collection is manual until a richer admin view ships.**

## Opportunity
Watching local competitors' GBP (review velocity, rating, posting,
owner-response presence) shows where Nick's can out-execute. Review
VOLUME is the gap most worth closing — see the baseline.

## What exists
- **Server monitor** (`services/competitorMonitor`) keeps each competitor's
  Google `place_id` in `competitor_snapshots` (source `place_id`) and reads
  ratings on demand. Since Q-48 (2026-09-23) it stores no ratings or review
  counts and sends no alerts: Google Maps Platform Terms allow caching
  place_id, not Places content.
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
`client/src/lib/competitorGbpMonitor.ts` (audit-dated baseline). Live
ratings come from `fetchCompetitorSnapshot()` on demand and must not be
written to the database (Q-48).
