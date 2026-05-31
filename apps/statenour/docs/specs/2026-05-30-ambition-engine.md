# Ambition Engine — `/stats` goals redesign

**Status:** design locked (clarity-gated 2026-05-30) · P1 in progress
**Direction:** A+B hybrid — *Ambition Spine* + *Compounding Ladder*
**Skills:** brainstorming (design-first) · sam-altman lens · clarity-gate (premises verified)

## Problem
The `/stats` goals card is **passive, island, generic, dated** (operator confirmed all four). `LifeGoal` is a true DB island — no link to mastery stats, and a **quantitative-biased** model (`metric`/`targetValue`/`unit`) used for **qualitative life goals**, so half the UI falls back to `targetValue===0`. The goal engine doesn't compound or pull.

## Clarity-gate — premises verified against code
- ✅ `/stats` mounts `CoachEventBanner surface="goals"` + `NickSidePane page="goals"` (stats/page.tsx:84,99) — the proactive surface is real + mounted.
- ✅ Stat-XP attribution engine exists: `lib/mastery/attribution.ts` `attributeHabit(habit→stat)`. `GoalStat` supplements it on the goal side.
- ✅ Coach Channel writer API exists: `lib/services/coach-events.ts` `recordCoachEvent` — add a goal-drift detector as one more writer.
- ✅ **CORRECTED:** `Task.goalId` (schema:340) + `Task.missionId` (295) already bridge goal↔work↔mission. **No `Mission.goalId` needed** — ride the existing `Task.goalId` edge for stat attribution.

## Design
- **`LifeGoal.kind` = `metric | milestone | narrative`** — kills the quant-bias. metric = target/unit (today); milestone = checklist (% done); narrative = Nick + reflection scored, no fake target.
- **`GoalStat { goalId, statKey, weight }`** — the spine to mastery. A goal declares which of the 33 stats it levels; a completed `Task.goalId`-tagged rep credits XP to those stats via the existing leveling engine. Character sheet cites the goal on level-up; goal shows its stat chips.
- **`LifeGoal.parentGoalId`** — the ladder: LIFE→YEAR→QUARTER→WEEK→rep; children roll up.
- **Proactive Nick:** a goal-drift detector (Coach Channel writer, registered via the `inngest:true` manifest pattern) checks pace/drift/deadline/ladder-coherence → priority-graded Coach Events → `/stats` banner + Telegram. Grounded in bridge numbers + journal + stat levels. Voice = the shipped MASTERY_COACHING_LENS.
- **UI:** kind-adaptive card (ring+pace / checklist / coach-momentum) + stat chips (character-sheet colors) + ladder + next-rep (from `Task.goalId`) + Nick read. Editorial-minimalist, gold-on-dark, mobile-first.

## Decision Log
1. 3 kinds over quant-only — operator's goals are often qualitative.
2. Goal↔stat via weighted `GoalStat` join reusing the leveling engine — not a parallel XP system.
3. `parentGoalId` ladder over flat horizon tabs — enables compounding.
4. Proactive Nick via the existing Coach Channel — not a new notification system.
5. Additive migration — zero data loss.
6. **Drop `Mission.goalId`** (clarity-gate) — `Task.goalId` already bridges; less schema churn.

## Phasing
- **P1 — Spine:** schema (`kind` + `GoalStat` + `parentGoalId`) · goal→stat XP attribution · fusion UI (stat chips + character-sheet citation).
- **P2 — Proactive Nick:** drift detector → Coach Channel → banner + Telegram, grounded.
- **P3 — Ladder + trajectory + UI polish.**

## Migration
Additive: `kind` default `"metric"`, `parentGoalId` null, `GoalStat` empty. Backfill infers `kind` (targetValue>0 → metric, else narrative). **Apply at ship-time** (working local-only per operator; migration deploy deferred like the push).

## Gates (per phase)
typecheck · `check:crons` (detector registers via `inngest:true`) · `prompt:size-check` (side-pane enrichment cap-aware) · the bridge-contract guard · full suite · build.

## Stolen patterns (skill-mined 2026-05-30 · operator: "steal anything that elevates us")
- **Elon (first-principles):** *question→delete ritual* — `lastChallengedAt` + one-tap KILL on stale goals (the core anti-stale fix; "the best goal is no goal") · *idiot index* — derived `minutesInvested ÷ progress` ("40h in, 5% moved") · *10x-vs-10%* — `ambition` tag.
- **Sam (YC):** *conviction 1-5* — `conviction` (devastated-to-lose; force-rank; low-conviction+low-progress = the surfaced zombie) · *WIP limit* per horizon (query/UI rule) · *pre-mortem* "what must be true?" authoring → milestones/risks.
- **clarity-gate:** *goal-as-hypothesis* — assumptions labeled in `planData`; milestones test them ("$15K PROJECTED · assumes X").
- **+ elevate:** *kill-criteria / if-then exit* — `killCriteria` + `killBy` (Annie Duke; pre-commit when you'd quit; pairs with the delete ritual, beats sunk-cost) · *outcome-vs-output* (Nick authoring check) · *consistency flame* (derived from `loopsThisWeek`, reuses the character-sheet flame) · *identity line* (`identityLine` on narrative goals; powers the coaching lens).

### Enriched LifeGoal additions (additive · Elon-delete applied — only what earns a column)
- **New columns** — P1: `kind` · `parentGoalId` · `GoalStat(join)` · `conviction Int?` · `lastChallengedAt DateTime?` · `killCriteria String?` + `killBy DateTime?`. P2: `ambition String?`. P3: `identityLine String?` (narrative).
- **Derived / rules — NO column:** idiot-index (minutesInvested÷progress) · WIP limit (query) · consistency flame (loopsThisWeek) · outcome-vs-output + pre-mortem (Nick behaviors) · goal-as-hypothesis (planData labels).

### Decision Log (additions)
7. Steal the anti-stale ritual (delete + `killCriteria` + `conviction`) — fixes the "old and stale" complaint at the root, not cosmetically.
8. Keep idiot-index / WIP / flame / outcome-vs-output **derived** (no columns) — minimize schema per Elon-delete; only conviction/lastChallengedAt/killCriteria/killBy/ambition/identityLine become columns.
