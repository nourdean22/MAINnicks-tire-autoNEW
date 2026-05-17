# ADR-0008 · Customer 360 + predictive brain (per-customer preferences)

> **Status**: Accepted (2026-05-17 · Wave-200 Phase 6 · partial)
> **Decision drivers**: customer view is operator-pull today (tab-by-
> tab admin) · need one pane · need cached preferences so the chat
> and morning brief can reference what we know without round-tripping
> the bridge per turn

---

## Context

Today, when the operator wants to know "everything about Brennen Smith",
they tab through five admin pages (customer search · invoices ·
estimates · ALG · callbacks) and synthesize mentally. Wave-200 Phase 6
ships the substrate for "one pane, one read, zero synthesis".

The original Phase 6 spec mentioned three layers:
1. **Convex** as a real-time read sync over nickstire's MySQL —
   high-overhead infrastructure decision (new DB · new auth · new bill)
2. **Mem0** for per-customer preference layer — Python-first SaaS
3. **Letta** for episodic memory — Python-first, early stage

All three are real possibilities but each adds operator action items
that delay shipping. This ADR documents what we ship NOW with the
existing stack (Prisma · BrainMemory · the existing bridge) and what
remains parked for follow-up.

## Decision

**Ship the read path + inference layer entirely on the existing stack.
Defer Convex/Mem0/Letta until evidence demands them.**

### What ships in Phase 6

1. **`customer_detail` query** added to nickstire's nour-os-query
   handler. Single query returns:
   - customer record
   - last 10 invoices
   - last 5 estimates
   - last 5 ALG estimates
   - last 5 callbacks
   Statenour's bridge module (`lib/nickstire/query.ts`) calls this
   to populate the Customer 360 view.

2. **`lib/brain/customer-preferences.ts`** · pure-function inference
   layer (Mem0 lite). Computes structured preferences from raw
   activity:
   - `visitFrequency` (rare · occasional · regular · frequent)
   - `paymentBehavior` (prompt · typical · slow)
   - `conversionRate`
   - `declinedValueCents` (TAM for recovery campaigns)
   - `avgTicketCents`
   - `ltvTier` (low · mid · high)
   - `hasOpenCallback` · `openRecoveryCount`
   - `summary` — one-line human-readable
   Persisted to `BrainMemory(category="customer_preference", key=
   customerId)` — same row keying pattern the rest of brain uses.

3. **`/api/customer-360/[customerId]`** · owner-only GET. Fetches
   detail from bridge · runs inference · persists fresh prefs (fire-
   and-forget) · returns `{ detail, preferences, bridgeStatus,
   fetchedAt }`. Graceful when bridge is down: returns cached prefs.

4. **`/customer-360/[customerId]`** · React surface in `app/(mastery)/`.
   Bridge banner when degraded · LTV badge in header · one-line
   preference summary · 6-stat grid · 4-tab timeline (invoices ·
   estimates · ALG declined · callbacks). Mobile-first.

5. **`customerPreferencesRecompute` Inngest function** · daily 11:00 UTC.
   Pulls active customer IDs (last 90 days) from a new bridge query
   `recent_customer_ids` · runs per-customer recompute as separate
   `step.run` checkpoints · concurrency limit 4 · soft-degrades if
   the bridge query isn't shipped yet.

6. **ADR-0008** (this file) documenting the layered approach + what
   we deferred.

### What's deferred (with reasons)

- **Convex** · would give us real-time sync from nickstire → statenour.
  Today's read path uses the bridge with ~200-1500ms latency. That's
  acceptable for Customer 360 (rare interactive flow). Defer until
  the operator has a workflow that NEEDS real-time customer state
  (e.g. live receptionist co-pilot).
- **Mem0 SaaS** · our pure-function inference already covers the
  preference axes we use. Mem0's value-add (LLM-driven preference
  extraction · long-tail patterns) is real but premature. Revisit
  when our inferences feel narrow.
- **Letta episodic memory** · "what did Nour decide last time about X"
  is a real ask but the substrate (BrainMemory rows with explicit
  category) already supports it. The scaffolding is there · the
  consumer that asks the question is the missing piece. Punted to
  the chat assistant's next planning cycle.

## Surfacing strategy

The Customer 360 view is *one* surface. The preferences layer's real
value is in *consumers*:

1. **Chat surface (already wired via brain recall)** — when the
   operator says "what do we know about Brennen", the prompt
   builder's recall path can surface
   `BrainMemory(category="customer_preference", key=*)` rows that
   match by name. No new code · the existing recall does this.
2. **Morning brief composer** — extend the brief slice that touches
   shop activity to pull preferences for the top-3 callbacks ·
   "Brennen prefers afternoons" added to the brief line.
3. **Outreach campaigns** — when the operator drafts a bulk-SMS to
   declined-work customers (the v10.0.526 surface), the preferences
   feed segmentation ("split into prompt-payers vs slow-payers ·
   slow-payers get the autopay option mentioned").

Each consumer is a 1-line read from BrainMemory. Zero new tables ·
zero new infrastructure.

## Rejected alternatives

### Build Customer 360 on the nickstire admin side

Customer data lives in nickstire's MySQL. Natural place to render
the view. Rejected because:
- The OPERATOR's customer interactions are increasingly via statenour
  (the chat surface · morning brief · voice loop) · the brain-side
  preferences live where the brain lives
- Operator goes to statenour for "what do I know" and nickstire admin
  for "what do I do" · this view is firmly the first kind
- The bridge already exists for cross-app reads · adding a route on
  the same side as the brain is more cohesive

### Compute preferences on every chat turn (no persistence)

Bypass BrainMemory · run inference live whenever the chat needs it.
Rejected because:
- Bridge latency (~200-1500ms) · feels sluggish vs. ~10ms cache hit
- Stable preferences are the right primitive · the operator can pin
  them · the brain can correlate them with outcomes
- Persistence enables the morning-brief and outreach campaign
  consumers (they don't have time to fan out per-customer bridge
  queries)

### Use raw vector embeddings of customer text as the preference

Embed every customer's full timeline · do similarity search at recall
time. Rejected because:
- Vector embeddings collapse too much detail · "high LTV slow payer"
  and "low LTV prompt payer" should not collide
- Structured preferences are queryable (e.g. "all customers with
  declinedValueCents > $1000") · vectors aren't
- We can layer vector search ON TOP later for "customers similar to
  this one" features · doesn't conflict with structured prefs

## Consequences

### Positive

- One-pane Customer 360 ships in ONE statenour deploy
- Preferences are operator-auditable · the inference is rule-based
  and lives in 250 LOC
- Daily Inngest recompute keeps the cache fresh even when the
  operator doesn't visit individual customer pages
- Chat / morning brief / outreach consumers light up automatically
  via the existing brain-recall path
- No new database · no new SaaS bill · no new auth boundary
- Bridge query is additive · nickstire-side change is one new case
  in the QUERY_HANDLERS map (no schema · no migration · no service)

### Negative

- **Cached preferences can be ~24h stale** if no one visits the page
  in between Inngest runs. Acceptable for monthly-cadence behaviors
  (LTV tier · payment behavior); riskier for fast-changing signals
  (hasOpenCallback)
- **Bridge dependency** — if nickstire is down, the live view loses
  fresh data. Mitigated by serving cached prefs in degraded mode.
- **`recent_customer_ids` bridge query is not yet shipped** (operator
  action item) — the daily Inngest function soft-degrades to a no-op
  until it's there. The per-visit live recompute still works fine.

### Neutral

- We can layer Convex / Mem0 / Letta on top later without re-
  architecting · the BrainMemory category becomes the contract

## Operator action items

1. **Add `recent_customer_ids` query handler** to nickstire's
   `server/routes/nour-os-query.ts`:
   ```ts
   "recent_customer_ids": async (filters) => {
     const sinceDays = Number(filters.sinceDays ?? 90);
     // SELECT id FROM customers
     // WHERE lastVisitDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
     // ORDER BY lastVisitDate DESC LIMIT 500
     return { customerIds: [...] };
   }
   ```
   Until this lands, the daily Inngest cron logs "no_active_customers"
   and exits cleanly · zero noise.

2. **Verify Inngest cron** appears in dashboard after Phase 3 prereqs
   land · the new `customer-preferences-recompute` function joins
   the existing two fan-outs.

## References

- `apps/nickstire/server/routes/nour-os-query.ts` · `customer_detail`
  handler (added in this commit)
- `apps/statenour/lib/brain/customer-preferences.ts` · inference
  helper
- `apps/statenour/app/api/customer-360/[customerId]/route.ts` ·
  read endpoint
- `apps/statenour/app/(mastery)/customer-360/[customerId]/page.tsx` ·
  React surface
- `apps/statenour/src/inngest/functions/customer-preferences.ts` ·
  daily recompute function
- ADR-0001 · Mastra (the chat consumer of these prefs)
- ADR-0005 · Inngest (the runtime for the daily recompute)
- ADR-0007 · Morning brief (the morning-brief consumer of these prefs
  in a follow-up wave)
- `docs/WAVE-200-PLAN.md` · Phase 6 entries
