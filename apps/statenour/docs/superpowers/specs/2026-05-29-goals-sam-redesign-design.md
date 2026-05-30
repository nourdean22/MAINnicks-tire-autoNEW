# /goals · Sam-Altman redesign + relevant-stats rethink — Design

**Date:** 2026-05-29 · **Status:** approved (operator "go") · **Approach:** A · Ruthless focus

## Goal

`/goals` answers one question: **am I winning, and what's the one move?** Today it
answers "here are nine stacked surfaces," and renders the 8-axis score **three times**
(header badges + 3D polyhedron + sidebar list). Sam pass = subtraction + make every stat
drive a decision.

## New layout (top → bottom)

1. **Header** — "Goals" + pruner pill. **Cut** the 8 header axis badges (redundant render #1).
2. **HERO** (`GoalsHero`) — fuse `NicksGoalsBrief` (Sam line: what compounds this week) +
   `TopGoalToday` (the one goal: current/should-be/target + pace gap + next-move CTA) into one
   card, plus a derived **accountability line**: did the #1 goal move recently?
   (derived from `daysSinceActivity` — moved this week ✓ / hasn't moved in Nd ⚠. No point-delta,
   because the snapshot carries no 7-day-ago progress.)
3. **Relevant-stats band** (`GoalsStatsBand`, NEW) — replaces all 3 axis renders. Three
   decision signals, re-derived from existing snapshot data:
   - **Trajectory** — fastest-climbing + fastest-falling axis (from `axes[].delta7d`). Two movers, not eight scores.
   - **Pace** — goals on-pace / behind / stalled (reuse `GoalsHealthStrip`'s `classifyPace`).
   - **The floor** — lowest axis OR longest-stalled goal: the one thing rotting (leverage/drift).
4. `CoachEventBanner surface="goals"` — keep.
5. **GoalBoard** — now **full-width** (right `Sidebar` removed; its only content was axis render #3).
6. **Deep-dive drawer** (`MasteryContextDrawer`, collapsed) — move `MasteryPolyhedron` +
   `OperatorPulse` + `CompoundChain` + `RecentInsightsPanel` inside. **Nothing deleted** —
   one tap away. The polyhedron stays the full 8-axis view for when wanted.
7. `GoalsHealthStrip` chip row — keep, relocated directly above GoalBoard as quick-jump triage.
8. Footer snapshot ts + `NickSidePane` — keep.

**Above the fold = answer → relevant stats → board. One screen.**

## Cut / demoted (nothing deleted)
- Header axis badges → gone (folded into stats band)
- Right sidebar axis list → gone (board full-width)
- Polyhedron / Pulse / CompoundChain / RecentInsights → into the deep-dive drawer

## Stale-scores note
The band makes stats *relevant* (trajectory/pace/floor vs 8 static numbers). Separately, the
operator flagged scores may be *stale* — verify the axis-scoring cron is fresh; if broken,
that's a real data bug fixed on its own (out of this UI scope, flagged in the plan).

## Files
- CREATE `components/goals/goals-stats-band.tsx` — derives from `axes` + `ladder` (already in snapshot)
- CREATE `components/goals/goals-hero.tsx` — composes `NicksGoalsBrief` + `TopGoalToday` + accountability line
- MODIFY `app/(mastery)/goals/page.tsx` — re-sequence, cut header badges, drop sidebar (full-width board), drawer the dashboards, mount hero + band
- KEEP `GoalsHealthStrip` (relocate above board), `NicksGoalsBrief`, `TopGoalToday`, drawer, NickSidePane
- **No backend rebuild** — all stats re-derived from the existing `goalsSnapshot` query

## Missing piece (kept light)
The hero's top goal IS the weekly bet; accountability is derived (movement recency), not a new
persisted model. A persisted "name + check your bet" loop is a clean Phase 2 if wanted.

## /scoreboard
Second step — realign to the same relevant-stats vocabulary after /goals ships. Separate spec.

## Verification
- `pnpm run typecheck` 0 errors · focused vitest green (goals/journal/recall untouched-but-adjacent)
- Manual: above-the-fold is hero → band → board on mobile width; drawer holds the dashboards;
  no axis number rendered more than once outside the drawer's polyhedron.
