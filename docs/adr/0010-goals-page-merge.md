# ADR-0010 · Merge /plan + /mastery → /goals · LADDER + SIDEBAR

> **Status**: Accepted (2026-05-17 · Phase A.1 · post Wave-200)
> **Decision drivers**: graveyard problem · operator-cautious migration ·
> single shared vocabulary · Wave-200 system-push thesis

---

## Context

After Wave-200 substrate ship, the operator surfaced a layered pain point
through a /brainstorming session (skill-driven design dialogue · Decision
Log archived below):

- `/plan` and `/mastery` were both "graveyards" — set-once goals/missions
  that operator stopped opening · stale numbers · vanity tracking · no
  review loop
- The two pages had overlapping jobs (both touched goals + scoreboards)
- Total surface bleed was scattered across `/plan` (346 LOC) +
  `/mastery` (455 LOC) + 30+ `/system/*` stats pages

The operator's framed evolution intent: **"elevate each page" · not unify
everything · not burn-and-rebuild from scratch.** But after Q1 clarified
overlap, the merge fell out naturally as the right scope.

## Decision

**MERGE `/plan` + `/mastery` into a single `/goals` page** with:

### LADDER shape
- LifeGoal grouped by `horizon` enum (DAY|WEEK|MONTH|QUARTER|YEAR|LIFE)
- DAY-tier is the hero (top · biggest typography · highest opacity)
- Each rung tapers in visual weight as horizon lengthens
- UNSCOPED bucket at bottom for backward-compat (goals with null
  horizon predate the Apr 15 rebuild)
- Forces the "today's work → month goal → year goal" cascade visible

### SIDEBAR (right rail)
- Top section: compact list of latest MasteryScore per domain · 7-day
  delta arrow per row
- Bottom section: active Mission rows · sorted by priority + ROI · 12
  cap
- Header doubles up: 8 axis badges (pill-shaped) for at-a-glance scan

### Pruner integration
- Nick-flagged stale goals get a `stale · review` badge on the goal card
- Header gets a `N stale · review →` banner deep-linking to chat with
  a seeded prompt
- No goal dies without operator consent (per Decision Log · operator
  one-click confirms; chat is the review surface)

### Three jobs the page does (operator stated)
1. **NARRATOR-INPUT** · Nick reads the page state in agent calls
2. **PRUNER** · Nick auto-suggests, operator confirms
3. **SCOREBOARD** · axes at the header + inline tags (double visibility)

## What ships in Phase A.1

| File | Purpose |
|---|---|
| `apps/statenour/lib/services/goals-snapshot.ts` | Composer · single-roundtrip read of goals + missions + axes + pruner flags |
| `apps/statenour/app/api/goals/snapshot/route.ts` | Owner-only GET endpoint |
| `apps/statenour/app/(mastery)/goals/page.tsx` | The merged UI · LADDER + SIDEBAR · editorial-minimalist |
| `apps/statenour/src/inngest/functions/goal-pruner.ts` | Daily 12:00 UTC cron · scans GoalEvent · upserts `BrainMemory(category="goal_prune_candidate")` rows |
| `apps/statenour/lib/brain/categories.ts` | Registered new `GOAL_PRUNE_CANDIDATE` category |
| `apps/statenour/next.config.ts` | `/plan` + `/mastery` → `/goals` permanent redirects |
| Deleted: `app/(mastery)/plan/page.tsx` (346 LOC) | Replaced by `/goals` · git history preserves |
| Deleted: `app/(mastery)/mastery/page.tsx` (455 LOC) | Same |

**Net code delta**: -801 LOC of old surface · +~700 LOC of new (page +
service + cron + types). Smaller, sharper, less fragmented.

## Rejected alternatives

### UNIFY EVERYTHING (Path A from brainstorm Q1)
Collapse tasks/goals/missions/stats into ONE page · the rest become
drill-downs. Operator rejected · they wanted page-level separation
preserved.

### NEW LAYER ON TOP (Path C from brainstorm Q1)
Keep /plan + /mastery untouched · add a NEW intelligent page above
them. Operator rejected · adds another surface to the already-cluttered
nav.

### KEEP SEPARATE · POLISH IN PLACE (Path B literal)
Don't merge · just make each page individually smarter. Rejected when
Q5 surfaced the overlap pain ("id like more organized") · the merge
fell out as the cleaner answer.

### MASTRA AGENT-FIRST WITHOUT UI (Approach 3 from design)
Skip the UI · let Nick narrate state in chat + morning brief. Punted
to Phase A.2 follow-up · the UI is still needed for visual scan +
the SCOREBOARD job.

### Schema migration · add Mission.lifeGoalId + axisTags (Approach 2)
Operator is migration-cautious per ADR-0009 · YAGNI says wait until
the implicit mission↔goal link via tasks actually hurts. Punted to
Phase A.3 if/when needed.

## Consequences

### Positive
- **Single page, single URL** · `/goals` is shared vocabulary for
  operator + Nick · no more "do you mean /plan or /mastery"
- **The why is visible** · LADDER cascade makes "today's tasks roll
  up to which goal" instantly readable
- **Pruner closes the review loop** · stale goals get flagged
  automatically · operator handles the kill decision · no goal
  lingers forever as graveyard decoration
- **No schema migration** · uses existing LifeGoal · Mission ·
  MasteryScore · GoalEvent · BrainMemory models. Zero risk to data.
- **Bookmarks preserved** · /plan and /mastery redirect permanent
  (308) · search engines update · operator's habits survive
- **Editorial-minimalist** · matches /customer-360 · /voice · /chat
  · consistent aesthetic across Wave-200 surfaces

### Negative
- **Mission → goal connection is implicit** · derived via shared
  tasks (mission.tasks ∩ task.goalId) · not first-class FK. Auto
  progress-bump on mission completion can't fire reliably. Operator
  accepts; if it bites, ADR-0011 (Phase A.3) adds the FK.
- **Axis duplication** · scores show in BOTH the page header (badges)
  AND inline on each goal card. Operator chose this for legibility
  vs single source of truth.
- **Pruner is conservative** · 30-day threshold means a momentary
  cool-off doesn't trigger flags. Tunable later if too lenient.

### Neutral
- **8-axis framing** · the existing MasteryScore model is per-domain ·
  the "8 axes" label maps 1:1 to whichever domains have recent rows.
  No fixed schema enforcement of "exactly 8 axes."

## Operator action items

None blocking. Optional follow-ups:
- After 7d of using `/goals`, decide if the implicit mission↔goal
  link is acceptable or if ADR-0011 (Phase A.3 schema migration) is
  needed
- After 30d of pruner cron firing, tune `STALE_THRESHOLD_DAYS` (in
  `goal-pruner.ts`) if 30 feels too lenient or too aggressive

## Decision Log (from brainstorm session)

1. Path B · elevate each page independently (NOT unify into single)
2. Sequence: graveyard surface first → stats → tasks
3. The graveyard surface IS the merged goals page (originally framed
   as /mastery · re-anchored to actual goals page /plan)
4. Three jobs: NARRATOR-INPUT + PRUNER + SCOREBOARD (e+d+c)
5. Hybrid org: meta-scoreboard + Nick narrates (deferred to A.2)
6. Nick picks 5-10 dynamic numbers (deferred to A.2)
7. Brief feeds meta (deferred to A.2)
8. Pruner: Nick suggests · operator one-click confirms
9. MERGE /plan + /mastery into single page
10. LADDER shape · Day hero top · cascade to Life
11. Missions in SIDEBAR · goals = WHY · missions = WORK
12. Mastery scores: HEADER (badges) + INLINE (axis tags) · accepted
    duplication for legibility
13. URL: `/goals` · operator-Nick shared vocabulary

## Phase A.2 (next session, parked)

- Meta-scoreboard page (Decisions 5-7) · Nick rotates 5-10 numbers
  daily based on what's anomalous · brief feeds it · single engine
- Likely lives at `/cockpit` (currently 22 LOC redirect-ish file)

## References

- `apps/statenour/lib/services/goals-snapshot.ts` · composer
- `apps/statenour/app/api/goals/snapshot/route.ts` · owner-only API
- `apps/statenour/app/(mastery)/goals/page.tsx` · the merged page
- `apps/statenour/src/inngest/functions/goal-pruner.ts` · pruner cron
- `apps/statenour/lib/brain/categories.ts` · GOAL_PRUNE_CANDIDATE
- `apps/statenour/next.config.ts` · redirect map
- ADR-0005 · Inngest substrate (pruner runs on)
- ADR-0008 · Customer 360 + predictive brain pattern · same shape
- `docs/WAVE-200-PLAN.md` · Phase A.1 entry
