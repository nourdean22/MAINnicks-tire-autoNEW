# ADR-0016 · Merge Brain + Life into Actions · OPS into Settings

- **Status:** accepted · 2026-05-15 · shipped v10.0.529.72 (Wave 18)
- **Superseded in part:** by [ADR-0025](./0025-settings-system-ownership.md) (2026-10-02) — OPS is no longer folded into Settings; System owns machine operations.
- **Context layer:** information architecture · QUICK NAV
- **Owners:** operator (Nour) · IA call · executed in-session
- **Supersedes:** v10.0.529.50 (Wave 4 nav upgrade · which had added the
  BRAIN + LIFE + OPS rows to the QUICK NAV)
- **Related:** ADR-0010 (editorial minimalism + StandardPage) ·
  v10.0.529.69 (Settings SystemOpsHub Wave 17.4)

---

## Decision

Three top-level QUICK NAV entries are folded into their natural parents:

| Before · QUICK NAV row | After · home | Rationale |
|---|---|---|
| **BRAIN** (→ `/brain`) | inlined on `/tasks` as `<ActionsContextBand>` Brain card | Brain (self-model · contradictions · skills · identity) is *context for action*. Putting its entry on the execution surface (`/tasks`) collapses one nav hop. The full `/brain` dashboard route stays — the band routes there. |
| **LIFE** (→ `/life`) | inlined on `/tasks` as 5-card row inside `<ActionsContextBand>` | `/life` was itself a thin 5-card hub (per its docstring: "the hub stays a router · the dashboards keep their depth"). Folding the 5 cards inline saves a click. `/life` route preserved for any deep-link consumer. |
| **OPS** (→ `/system`) | already reachable via `/settings` SystemOpsHub | Settings landed in Wave 17.4 with a full SystemOpsHub grid that lists every `/system/*` surface with live pulse counts. The QUICK NAV's OPS row was redundant. The system-tone drift signal that lived on the OPS row is preserved on the Settings row's tone dot. |

Net: QUICK NAV drops from **10 items → 7**. Brain/Life/System still
reachable via:
- The `<ActionsContextBand>` on `/tasks` (Brain card + 5 Life cards)
- The `SystemOpsHub` block at the top of `/settings`
- The `⌘K` command palette (NAV_ITEMS in `components/layout/nav-items.ts`
  still has them)
- Direct URLs (no redirects added · all routes preserved)

---

## Context

The QUICK NAV (FloatingHome expanded menu) accumulated 10 items over the
v10 era. The operator called out via in-session screenshot annotation
that the menu felt too wide and that Brain/Life/Ops "fit better"
elsewhere:

> "i want brain and life properly combined into the actions/tasks page
> bc they fit better there. but also check to see if any dupe info is
> there already. also ops need to be combined and properly integrated
> into settings idk why i need to see that there."

Discovery confirmed:
1. **No dupe content** between `/tasks` and `/brain` or `/tasks` and
   `/life` · the surfaces were disjoint (`grep` audit found zero
   imports of brain/life components in `app/(mastery)/tasks/page.tsx`
   or its `components/actions/*` deps).
2. **Brain = full dashboard** · 16+ panels (`BrainMaturityHeader`,
   `BrainInsightsPanel`, `ActiveAlertsCard`, `PredictionStreaksCard`,
   `NudgePanel`, `PinnedContextPanel`, `GhostNickStrip`,
   `ContradictionResolutionPanel`, `ContradictionsCard`,
   `DecisionReplayCard`, `PreferencesCard`, `PersonaDriftCard`,
   `SkillLibraryPanel`, `IdentityPanel`, `QualitativeIdentityPanel`,
   `BeliefsPanel`, `ToolTelemetryPanel`, `SuggestionTelemetryPanel`).
   Inlining all of them on `/tasks` would bloat the execution surface.
   → Decision: entry-point card only · deep dive stays at `/brain`.
3. **Life = 5-card hub** (114 LOC) · already a router with no data
   fetching. → Decision: inline the 5 cards in `<ActionsContextBand>` ·
   the destination routes (`/mastery` · `/body` · `/financial` ·
   `/knowledge` · `/learn`) keep their depth.
4. **OPS already had a home in Settings** · `SystemOpsHub` was built
   in Wave 17.4 and renders every `/system/*` surface as a category
   grid. The QUICK NAV's OPS row was duplicating that affordance.

---

## Considered Alternatives

| Option | Why rejected |
|---|---|
| Fold all 16 Brain panels INTO `/tasks` | Bloats the execution page (LOC + first-paint cost). Violates kaizen + YAGNI. |
| Convert Brain to a Life-style 5-card hub | Loses the dense self-model surface that the operator actively uses for ContradictionResolution + IdentityPanel work. Heavy regression. |
| Delete `/life` and `/brain` routes outright | Breaks deep-links from chat replies + bookmarks + `⌘K` palette entries. No real LOC savings (the Brain panels would still need a home). |
| Keep QUICK NAV at 10 items + improve labels | Operator explicitly rejected the current count. Doesn't address the "fit better there" intent. |

---

## Consequences

**Positive**
- QUICK NAV cognitive load drops · 7 destinations vs 10
- Brain + Life signals appear ABOVE the work surface · context-before-
  execution flow per `ux-flow` Nielsen heuristics
- `/life` becomes redundant route (kept for now · candidate for deletion
  in a future cleanup wave once we confirm no external deep-links)
- `<ActionsContextBand>` is a new shared primitive · other "execution
  surfaces" can re-use it
- Settings becomes the canonical entry for OPS (matches the operator's
  mental model of Settings = control panel)

**Negative**
- One extra page-level component on `/tasks` (mitigated · band is pure
  static · zero render cost · no data fetching)
- Operators relying on the BRAIN row in QUICK NAV need to relearn the
  new path (mitigated · `/brain` still appears in `⌘K` · the context
  band is more prominent than the old nav row)
- `/life` is now a "phantom hub" that only deep-links and `⌘K` reach
  (mitigated · doc-comment updated to point at `<ActionsContextBand>`
  as canonical home)

**Neutral**
- No route deletions · no redirects added · no API changes · zero
  database impact

---

## Verification

- Typecheck · lint · 1717 tests · 15-gate pre-push · production build
- Manual sanity: QUICK NAV opens with 7 rows (was 10) · `/tasks`
  renders the context band above `<KommandoShell>` · `/brain` and
  `/life` still respond directly at their URLs
- `pnpm analyze` bundle delta: trivial (one small static component
  added · 3 icon imports removed from floating-home.tsx)

---

## Files touched

- NEW · `components/actions/actions-context-band.tsx` (~120 LOC)
- MOD · `app/(mastery)/tasks/page.tsx` (+1 import · +1 component mount)
- MOD · `components/layout/floating-home.tsx` (-50 LOC · 3 nav rows +
  3 unused icon imports removed)
- NEW · `docs/adr/0016-merge-brain-life-ops-ia.md` (this file)
