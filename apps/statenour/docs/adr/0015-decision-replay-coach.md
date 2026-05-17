# ADR-0015 · Decision-replay coach pipeline

**Status:** Accepted
**Date adopted:** v10.0.528 (2026-05-12) · Ultron surface v10.0.529.7

## Context

`MasteryDecision` is the schema model that captures the operator's
named decisions · what was chosen, the reasoning, the predicted
outcome, the lens applied. Through v10.0.527 the OS captured these
on the way IN (operator records a decision, model stores it) but had
no path back OUT · once a decision was 30+ days old, there was no
mechanism to circle back and ask "how did it play out · would you
decide differently now?"

This left the operator's Mastery loop half-built · the capture is
sharp, the retrospective is missing. Manual review of past decisions
is the kind of high-value, low-urgency work that gets crowded out by
whatever's loudest today.

The operator's stated framing matches the wisdom corpus the OS already
ranks (Munger / Naval / Buffett / Greene): decisions get better when
you write them down, then check yourself 30 days later against what
actually happened. Without a cron + surface, the check-yourself step
never happens consistently.

Pre-existing scaffolding that we could reuse:

- `MasteryDecision` model · captures + tracks decisions
- `DecisionReplay` model · already has every field needed for the
  retrospective (`decisionId · reviewAt · reviewed · outcome ·
  outcomeScore · lesson · reviewedAt · idempotencyKey`)
- `BrainMemory(category="wisdom")` corpus · ~991 wisdom rows ranked
  by confidence with persona keys (`wisdom_munger_...`, etc.)
- `morning-brief` cron · already runs daily and consumes a fixed
  budget of items to show
- `Ultron` dashboard tiles · the operator's "what needs attention
  today" surface

The build question was how to wire these together without inventing
new tables or new operator surfaces.

## Decision

Adopt a 5-stage pipeline at `lib/services/decision-replay-coach.ts`,
queued by a daily cron, surfaced through morning-brief + an Ultron
tile, closed via a mark-consumed POST that the operator triggers from
the tile.

The 5 stages:

1. **`pickDueReplays(limit)`** · returns `MasteryDecision` rows whose
   `createdAt + 30d ≤ now` AND have no `DecisionReplay.reviewed=true`
   row. Filters via Prisma `findMany` + in-memory exclusion (cheap
   at the daily candidate volume).
2. **`gatherOutcomeSignals(decision)`** · 30-day-window scan after the
   decision date. Counts: tasks completed/abandoned, drift alerts,
   topical BrainMemory updates (filtered by decision keywords),
   commitment status delta (broken / completed / still-active).
3. **`matchWisdom(decision, signals)`** · scores wisdom-corpus rows
   by Jaccard keyword-overlap × persona-boost × confidence. Returns
   one wisdom with `similarity ≥ 0.3` or null (prompt falls back to
   a generic "what did this teach you" frame).
4. **`composeReplayPrompt(decision, signals, wisdom)`** · formats
   the operator-facing prompt · 4-5 line shape · HTML-safe for
   Telegram delivery.
5. **`markReplayed({decisionId, outcome, outcomeScore?, lesson?})`** ·
   upserts the `DecisionReplay` row keyed by
   `idempotencyKey = "decision_<id>_30d"`. Writes a
   `BrainMemory(category="decision_replay_outcome")` row so the
   lesson is recall-able the next time a similar decision shows up.

Surfaces:

- **Daily cron** · `app/api/cron/decision-replay/route.ts` runs once
  daily as part of the consolidated morning cron · queues
  `BrainMemory(category="decision_replay_due")` rows for the top N
  due replays.
- **Morning brief** · consumes the top 3 queued replays as part of
  its daily budget.
- **Ultron tile** · `components/ultron/decision-replay-card.tsx`
  surfaces remaining queued replays. Tap → opens `/chat?seed=...`
  with the composed prompt pre-loaded · operator answers in chat ·
  the model records the answer via `markReplayed`.
- **Mark-consumed POST** · `app/api/system/decision-replays/[id]/
  mark/route.ts` closes the loop. Idempotent via the
  `idempotencyKey`.

Idempotency contract · `pickDueReplays` filters out already-reviewed
decisions, so cron retries are safe. `markReplayed` upserts via the
idempotency key, so two writes don't double-create the queue row.

### Why keyword Jaccard not embedding similarity for wisdom match

The wisdom corpus is small (~991 rows). Jaccard runs in-process with
zero network cost. The embedding path costs one Cohere rerank call
per replay. With ≤5 replays/day that's nothing financially · but
the keyword version removes a failure mode (embedding provider down
→ no wisdom citation). The 0.3 similarity floor means we drop low-
confidence matches before they show up in the prompt · the operator
sees a generic frame rather than a nonsensical citation.

## Consequences

**Positive:**

- **NO new tables · NO schema migration.** Reuses `MasteryDecision`
  (already captured), `DecisionReplay` (already had every needed
  field · it had been a sleeping model awaiting a writer), and
  `BrainMemory` (the queue category + the outcome category are new
  values in an existing schema column).
- Single-operator UX · the prompt arrives in morning-brief or the
  Ultron tile · the operator answers in chat · the model records.
  No new product surface, no new screen, no new auth.
- Cron budget consumes 1 slot, folded into the mega-morning cron run.
  Cost · the pipeline scans ≤200 candidate rows, runs one wisdom
  match per due decision, writes ≤5 queue rows. Sub-second total.
- The wisdom-citation feature compounds with ADR-0002 (CoALA 3-lane
  recall) · the next time the operator faces a similar decision,
  the `decision_replay_outcome` brain memory is recall-able as
  episodic context. The retrospective loops back into prospective
  reasoning.

**Negative:**

- The keyword-overlap signal for "what happened in the 30d window"
  has weak coupling for abstract decisions ("change my approach to
  X" doesn't map to a clean task-event filter). Mitigated by the
  topical-memory scan and the explicit "no measurable signals in
  the 30d window" fallback in the prompt. The retrospective still
  has value · the operator answers from memory not from the prompt's
  signals.
- 30 days is a fixed horizon · short-horizon decisions (intra-week)
  and long-horizon decisions (90+ day strategic bets) don't fit
  cleanly. The horizon is a constant in the module
  (`REPLAY_HORIZON_DAYS = 30`) · trivial to tune but a single value
  means we optimize for the median decision.
- The persona-boost (Munger / Naval / Buffett / Greene get 1.25×)
  encodes the operator's current preferences into the algorithm.
  If the operator's preferred lenses drift, the boost table needs
  updating. Acceptable · the lenses ARE the explicit framing the
  operator selected, this isn't accidental coupling.
- Cron scheduling depends on the consolidated morning cron staying
  healthy · a cron outage means replays back up but eventually
  flush (the candidate set just grows).

## Alternatives considered

- **Dedicated `DecisionReplayQueue` table writes.** Rejected ·
  `DecisionReplay` already exists with all fields needed. Adding a
  parallel queue table would duplicate the model. Using BrainMemory
  with `category="decision_replay_due"` for the queue and writing
  to `DecisionReplay` only on mark-consumed keeps the model count
  flat.
- **Email digest.** Rejected · the operator already has the morning
  Telegram alert. Adding email noise reduces signal. The Telegram
  channel is the operator's source of truth for "what does Nick want
  me to look at."
- **In-prompt context auto-injection.** Rejected · the operator wants
  CONTROL over when to engage with a decision replay. Auto-injecting
  the retrospective into every chat that touches a similar topic
  removes operator agency and dilutes the deliberate-review framing.
  The tile-and-tap pattern preserves agency · the operator chooses
  when to engage.
- **Embedding similarity for wisdom match.** Deferred · see "Why
  keyword Jaccard not embedding similarity" above. The Cohere rerank
  path (ADR-0007 stack) is available if keyword Jaccard proves
  insufficient · today it's good enough.
- **LLM-generated retrospective summary.** Considered for the wisdom
  match · rejected for v1. A frontier-model summary of "did the
  predicted outcome match the actual outcome" would be higher
  quality than the bullet-counted signals, but costs $0.01-0.05 per
  replay and adds 1-3s latency. Worth piloting after the v1 ships
  and we have telemetry on how often the keyword bullets feel
  inadequate.

## References

- `lib/services/decision-replay-coach.ts` — the 5-stage pipeline
- `app/api/cron/decision-replay/route.ts` — daily queue writer
- `app/api/system/decision-replays/[id]/mark/route.ts` —
  mark-consumed endpoint
- `components/ultron/decision-replay-card.tsx` — Ultron tile
- `prisma/schema.prisma` · `MasteryDecision` + `DecisionReplay` +
  `BrainMemory` (categories `decision_replay_due` +
  `decision_replay_outcome` + `wisdom`)
- v10.0.528 commit (`1c04668`) · WAVE 6 ship · coach + cron + tile
  scaffold
- v10.0.529 commit (`2e70833`) · Ultron decision-replay surface
- v10.0.529.7 commit (`03fd75c`) · tile became actionable
  (tap → /chat?seed=...)
- ADR-0002 · CoALA 3-lane recall · provides the episodic-memory lane
  that consumes the `decision_replay_outcome` rows
- ADR-0007 · skill semantic recall · the embedding-similarity infra
  available if we ever swap out the keyword-Jaccard wisdom match

## Open items

- Telemetry · how often does the operator actually engage with the
  tile vs let it accumulate? Worth tracking
  `decision_replay_view` and `decision_replay_marked` events in
  `SystemMetric` to know if the surface is working.
- Horizon tuning · current single 30d horizon may not fit all
  decision shapes. A future enhancement could classify the decision
  at capture time and select a horizon from `{7, 30, 90}` based on
  the decision domain.
- The wisdom corpus is ~991 rows · re-curate quarterly so the persona-
  boost continues matching the operator's evolving lens preferences.
- Consider an `outcomeScore` rubric · today operators self-rate
  freely · a 1-5 scale with anchors might produce more comparable
  data across decisions.

---

**Reconciled at v10.0.529.9** · 2026-05-12 EOD · ADR shipped alongside
the WAVE-6 ship + Ultron surface so the rationale is durable before
context rotates.
