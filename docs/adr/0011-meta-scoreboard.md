# ADR-0011 · Meta-scoreboard · `/scoreboard` page

> **Status**: Accepted (2026-05-18 · Phase A.2 · follow-up to ADR-0010)
> **Decision drivers**: brainstorm Decisions 5-7 (operator-locked) ·
> dynamic page that's alive when something matters, calm otherwise ·
> single-engine architecture (brief feeds meta)

---

## Context

ADR-0010 shipped the merged `/goals` page (Phase A.1) and explicitly
parked the meta-scoreboard for the next session. Decisions 5-7 from
the brainstorm:

- **D5 · Organization model**: HYBRID · one meta-scoreboard page +
  Nick narrates which numbers matter today on top
- **D6 · Content**: Nick picks 5-10 numbers · dynamic when anomalous ·
  static when calm
- **D7 · Brief↔meta relationship**: brief FEEDS meta · single engine
  writes once at 6am · scoreboard hydrates from that + adds deltas

`/cockpit` was floated as the URL but its existing 22-LOC file is
referenced by other surfaces. `/scoreboard` is direct + matches
`/goals` naming clarity.

## Decision

Ship `/scoreboard` as a NEW page with three-layer composition:

### 1 · Anchor numbers (always shown when calm)
1. `revenue_today` (from nickstire bridge AuditEvent)
2. `open_tasks` (Prisma count)
3. `active_commitments` (Prisma count)
4. `unresolved_alerts` (DriftAlert count)
5. `mastery_top_mover` (axis with biggest 7d delta · null if <0.3)

### 2 · Anomaly detectors (only surface when triggered)
- `cron_failures_24h` · ≥3 failed cron runs in last 24h
- `stale_goals` · ≥3 goal_prune_candidate BrainMemory rows (Phase A.1
  pruner output)
- `callbacks_pending` · ≥1 customer waiting per bridge payload
- `alert_surge` · ≥10 unresolved drift alerts (vs 5 anchor threshold)

Anomalies displace anchors when total exceeds MAX_NUMBERS (10).
Anomalies always sort to top. State badge: "calm" if 0 anomalies ·
"alive" otherwise.

### 3 · Brief-feeds-meta path
- Morning brief Inngest function writes `BrainMemory(category=
  "morning_brief", key=YYYY-MM-DD)` at 6am ET (already shipped Phase 5)
- `/scoreboard` page reads the latest brief timestamp for the footer
- Future: brief's anomaly picker writes specific scores into a
  `BrainMemory(category="scoreboard_pinned")` row that the service
  consumes ahead of anchor defaults (parked · Phase A.3 if needed)

## What ships in Phase A.2

| File | Purpose |
|---|---|
| `apps/statenour/lib/services/meta-scoreboard.ts` | Composer · 5 anchors + 4 anomaly detectors · brief timestamp |
| `apps/statenour/app/api/scoreboard/snapshot/route.ts` | Owner-only GET · 30s client cache |
| `apps/statenour/app/(mastery)/scoreboard/page.tsx` | The UI · calm/alive badge + anomalies-first grid |
| `docs/adr/0011-meta-scoreboard.md` | This ADR |

Net code: +~640 LOC across page + service + API + ADR. No schema
migration. No new tables. Zero risk.

## Rejected alternatives

### Rebuild `/cockpit` as the meta-scoreboard
`/cockpit` is a 22-LOC redirect-style file referenced by other parts
of the codebase. Safer to leave alone. `/scoreboard` is the right
name anyway · matches `/goals` clarity.

### Always-AI-picked numbers
Decision 6 says "Nick picks" but the read path needs to be cheap. The
implementation: brief uses AI at 6am to write picks; service pulls
anchors + runtime-detected anomalies + falls back through brief picks
later (Phase A.3). Read path stays sub-500ms · AI cost only at brief
time.

### Single-tier card grid (no anomaly separation)
Mixing anomalies with anchors makes "what changed?" invisible. The
separation (anomalies section · then anchors section) preserves the
narrative · operator scans anomalies first · anchors are wallpaper.

## Consequences

### Positive
- One stable URL · operator bookmarks `/scoreboard` and gets the
  pull-anytime version of the morning brief
- Page genuinely alive · anomalies displace anchors when something
  matters · operator notices via the badge flip "calm" → "alive"
- Zero AI cost in read path · all anomaly detection is rule-based +
  Prisma reads
- Drill-down per number via `link` field → operator clicks "Revenue
  today" → lands on `/financial`
- Brief integration is loosely coupled · scoreboard works fine even
  if brief never fires (anchors carry the surface)

### Negative
- Anomaly thresholds are hand-coded (3 failed crons · 3 stale goals ·
  10 alerts). Operator may want tunable thresholds later · YAGNI says
  wait until specific thresholds feel wrong
- Static `anchors` list grows as new metrics come online · keeping it
  under 5 is the discipline · resist the urge to add more

### Neutral
- The existing `lib/services/scoreboard.ts` (personal-mastery daily
  score capture) is a different concern · meta-scoreboard lives in
  `lib/services/meta-scoreboard.ts` · clean lane separation

## Operator action items

None blocking. Future:
- After 7d of using `/scoreboard`, tune anomaly thresholds if firing
  too eagerly or too rarely
- Consider Phase A.3 · morning brief writes specific scoreboard picks
  (not just timestamp) for true brief-feeds-meta flow

## Phase A.3 (if needed · parked)

- Brief-feeds-meta full path: morning-brief writes specific
  scoreboard picks · scoreboard composer reads them ahead of anchor
  defaults
- Operator-tunable thresholds via UserPreference rows
- Mobile push when state flips calm → alive (operator notification)

## References

- `apps/statenour/lib/services/meta-scoreboard.ts`
- `apps/statenour/app/api/scoreboard/snapshot/route.ts`
- `apps/statenour/app/(mastery)/scoreboard/page.tsx`
- ADR-0010 · /goals page merge (Phase A.1 predecessor)
- ADR-0005 · Inngest (morning-brief Phase 5 substrate)
- `docs/WAVE-200-PLAN.md` · Phase A.1 + A.2 entries
