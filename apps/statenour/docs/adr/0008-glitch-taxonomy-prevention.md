# ADR-0008 · 8-category glitch taxonomy + 4-phase prevention infrastructure

**Status:** Accepted
**Date adopted:** v10.0.333 (2026-05-06)
**Backfilled:** 2026-05-07 (v10.0.458)

## Context

Through v10.0.330 the OS had been shipping ~1-3 glitches per week
that the operator caught in real use. The pattern was always:
"something silently broke, I didn't know until I tried to use it."
Each glitch was fixed individually but the root-cause categories
were re-emerging.

A real-world example surfaced in a single /chat post-creation
session: 4 distinct glitches from 4 different failure categories:

1. `revenue_week` query returned empty (contract drift · the bridge
   action existed but pointed at an unbuilt feature)
2. XML template tag leaked into the rendered reply (template
   escape · `<{tag}>` interpolation hit a Mustache-class parser)
3. Image regen used the operator's *complaint* about the previous
   image as the regen prompt (intent confusion · the regen handler
   read the chat history and grabbed the wrong span)
4. Double assistant reply (race · the streaming finish + the
   verifier-rewrite path both wrote a turn)

4 surfaces · 4 root causes · 1 chat session. The pattern was clear:
without a taxonomy, the team (just Nour + Nick) re-discovered the
same failure modes repeatedly.

## Decision

Adopt an **enumerated taxonomy of 8 root-cause categories** plus
a **4-phase prevention infrastructure** that wraps each category
with detection + tooling.

The 8 categories (full reference: `docs/glitch-taxonomy.md`):

1. **Contract drift** — external API shape/auth/rate changes
2. **Silent failure** — error swallowed without breadcrumb (see
   ADR-0004 withGuardian; v10.0.448 added breadcrumbs to the
   judge + critic chain that bypassed guardian)
3. **Template escape** — user input or model output bleeds through
   a templating layer (XML tags, Mustache, etc.)
4. **Race / ordering** — concurrent paths both try to write or both
   read stale state
5. **Intent confusion** — handler reads wrong context span (e.g.
   regen reads the complaint instead of the original prompt)
6. **State drift** — DB row state and code expectation diverge
   (orphan FK, soft-delete missed, status enum drift)
7. **Schema drift** — DB schema and code Prisma type diverge
8. **UI surface drift** — admin/operator UI references a deleted
   route/page/feature

The 4-phase prevention infrastructure:

- **Phase 1 · Detect** — a probe per category (e.g. cron-drift
  detector · audit-internal-links script · recall cross-lane
  overlap monitor · bridge envelope schema check)
- **Phase 2 · Surface** — finding routes to operator-visible places
  (the `/system/observability` request tracer · `system_metric`
  rows that power the dashboard · `correlation_alert` brain
  memories)
- **Phase 3 · Prevent** — the design discipline that keeps the
  failure from re-emerging (withGuardian wrapping · centralized
  operator-rules · type-safe bridge envelopes · pre-push gate)
- **Phase 4 · Document** — taxonomy file + ADR backfill + commit
  message format that captures category in every fix

## Consequences

**Positive:**

- Glitches now get filed against a category. The /chat session that
  exposed 4 glitches wrote 4 fixes against 4 categories, not 4
  ad-hoc patches.
- The 15-step pre-push gate (typecheck/lint/tests/raw-sql/
  cron-drift/auth/build) directly maps to category coverage. New
  steps can be added when a 9th category emerges.
- Future-Claude sessions and future-Nour both have the same
  vocabulary. "This looks like contract drift" is a 3-word
  diagnostic that points to a documented failure mode + remediation
  pattern.
- The 4-phase model makes "we shipped the prevention" a discrete
  status. Detection-only is incomplete. Surfacing-only is
  incomplete. Prevention-only without detection is brittle.
  Documentation-only without prevention is theatre.

**Negative:**

- 8 categories is large enough that some glitches don't fit
  cleanly. The taxonomy file already notes "new categories get
  added when we hit something that doesn't fit."
- Prevention work has compounding cost. Each new category requires
  a probe + a surface + a discipline + a doc — 4× the work to
  add one. The trade-off is that adding a category is a one-time
  cost; failing-without-category is a per-glitch cost.
- The taxonomy file is a living document. Stale categories and
  abandoned probes drift over time without explicit ownership.

## Alternatives considered

- **Per-glitch ad-hoc fixing** — was the status quo before
  v10.0.333. Produced exactly the recurrence pattern that motivates
  the taxonomy.
- **External error-tracking SDK (Sentry / Datadog)** — rejected on
  cost + on the fact that Sentry surfaces failures but doesn't
  enforce a categorical vocabulary. Solves Phase 2 (Surface)
  partially; doesn't help with Phases 1, 3, 4.
- **Single all-encompassing "robustness" project** — rejected as
  too vague. The taxonomy gives discrete deliverables.

## References

- `docs/glitch-taxonomy.md` — the canonical taxonomy (8 categories
  with failure modes, surfaces, detection, prevention)
- `scripts/audit-internal-links.ts` — Phase 1 detector for
  category 8 (UI surface drift)
- `scripts/schema-index-audit.ts` + `schema-timestamp-audit.ts` —
  Phase 1 detectors for category 7 (schema drift)
- `lib/tools/guardian.ts` — Phase 3 prevention for category 2
  (silent failure · see ADR-0004)
- `app/api/system/observability/route.ts` — Phase 2 surface
- v10.0.333 commit · taxonomy adoption
- v10.0.448 commit · silent-failure breadcrumbs (recent example
  of a category 2 fix using the framework)
- ADR-0004 · withGuardian (the prevention-side infrastructure for
  category 2)

## Open items

- Probe coverage matrix · which categories have all 4 phases
  shipped vs partial. As of v10.0.385 the matrix was reportedly
  complete; would benefit from a fresh refresh now that another
  ~70 versions have shipped.
- Auto-classification of glitch reports · today the operator
  manually classifies. A small classifier (rule-based on
  keywords + regex) could pre-fill the category in `system_metric`
  rows for trend analysis.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
