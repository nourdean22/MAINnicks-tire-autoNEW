# Operator Writing Discipline

**Skill port:** B9 · diary + doc-coauthoring + internal-comms (3 skills bundled · the writing layer)
**Applies to:** statenour `/journal` · ADRs in `docs/adr/` · RECONCILIATION docs · MEMORY.md updates · postmortems · runbooks · operator's own daily writing practice.
**Authored:** 2026-05-26.

## Why this doc exists

The operator (Nour) ships 30+ commits per active day, writes 10-20 brain-memory entries, occasionally publishes ADRs, frequently writes operator-facing notes that future-operator (himself in 90 days) won't be able to decode. Without a writing discipline, the volume becomes noise · valuable signals get lost · context decays.

This framework codifies WHEN to write WHAT, in WHICH SURFACE, and to WHICH STANDARD. It absorbs three audit-list skills (diary · doc-coauthoring · internal-comms) into one operator-grade reference.

## The 5 surfaces (each has a specific job)

### Surface 1 · `/journal` (daily reflection · operator-only · operator-grade)

**When** · end of every active day · OR after any non-routine event (incident · big win · operator-state shift)
**Length** · 200-800 words · stream-of-consciousness OK · DON'T edit to perfection
**Audience** · operator's future self · NOT shareable as-is
**Tone** · honest · including the messy parts · "I was tired and pushed a broken commit and didn't catch it"
**Structure** · loose · don't force a template

What makes a journal entry GOOD (per ADR-0010 reflection skill):
- Names the day's BIGGEST emotional thing (frustration · pride · confusion)
- Names ONE thing operator learned (could be technical OR about himself)
- Names ONE thing he'd do differently
- Optional · what's tomorrow's CRITICAL move?

The pattern · journal entries become the raw material for ADRs · postmortems · OS upgrades. If you don't journal, the brain doesn't grow.

### Surface 2 · `brain_memory` rows (semantic facts · agent-readable)

**When** · whenever a NEW BELIEF or FACT crystallizes that future-agent should know
**Length** · 1-3 sentences max
**Audience** · the AI agent (Nick) + future-operator looking up "what do we believe about X"
**Tone** · factual · third-person OK · no hedging unless explicit ("we believe X is true, but haven't measured")
**Structure** · matches `lib/brain/categories.ts` · pick the right category

Categories per the codebase (cross-ref `lib/brain/categories.ts`):
- `wisdom` · timeless principle that applies cross-domain
- `insight` · short-term observation about a specific situation
- `pattern` · recurring observation across multiple events
- `decision_pattern` · "we always pick X over Y in situation Z"
- `domain_knowledge` · objective fact about tires/brakes/biz
- `industry_intel` · what competitors/the market are doing
- `belief` · operator-held position that may or may not be true
- `nick_advice` · stuff the operator wants Nick AI to say back

**Anti-pattern · "Add memory for every chat turn."** Memory bloat dilutes recall. Memory should crystallize SOMETHING THAT SURVIVES THE WEEK. If 90 days from now the row is irrelevant, it shouldn't have been added.

### Surface 3 · ADRs (Architecture Decision Records · `docs/adr/NNNN-name.md`)

**When** · when a structural decision changes the system in a way that affects future operators
**Length** · 200-1500 words · always include Context · Decision · Consequences
**Audience** · future operator + agents · IS shareable as standalone artifact
**Tone** · neutral · "we decided X because Y" · NOT marketing copy
**Structure** · matches the existing ADR template

Standard ADR sections:
1. **Title** · "ADR-NNNN · <decision phrase>"
2. **Status** · proposed / accepted / deprecated / superseded
3. **Context** · what problem were we solving · what constraints applied
4. **Decision** · what we chose · the alternatives we considered + rejected
5. **Consequences** · positive + negative outcomes · what we trade away

**Anti-pattern · "ADR for every code change."** ADRs are for STRUCTURAL choices · not bug fixes. "Switched lib X to lib Y" deserves an ADR. "Fixed nil-pointer in handler" doesn't.

### Surface 4 · Postmortems (`docs/postmortems/YYYY-MM-DD-name.md`)

**When** · after any incident with customer impact OR data loss OR > 1hr operator time-cost
**Length** · 500-2000 words · always include 5-whys + remediation
**Audience** · future operator · future agent · auditor (sometimes)
**Tone** · blameless · "this happened" not "I caused this"
**Structure** · cross-ref `apps/nickstire/docs/postmortems/2026-05-24-prerender-to-all-users.md` (the canonical example)

Standard postmortem sections:
1. **TL;DR** · 2 sentences · what broke + how it was fixed
2. **Timeline** · timestamped events from first signal to resolution
3. **Root cause** · 5-whys to the actual structural cause
4. **Immediate fix** · what we shipped to stop the bleeding
5. **Long-term fix** · what we'll change to prevent recurrence
6. **Lessons** · what we learned · what we'd do differently next time

**Anti-pattern · "Postmortem for everything that went weird."** Postmortems are for INCIDENTS · not "I was confused for 20 minutes." Have a SLO breach OR a customer-impact threshold · only write postmortems when you trip it.

### Surface 5 · Runbooks (`docs/runbooks/<name>.md`)

**When** · ANY procedure that the operator (or future operator) might need to run again
**Length** · 200-800 words · step-by-step · numbered list
**Audience** · operator OR junior staff member following along · NOT agent (agents have separate tool definitions)
**Tone** · imperative · "click X" · "run Y" · NOT abstract
**Structure** · matches existing runbooks (e.g. `apps/nickstire/docs/runbooks/HOTFIX_RUNBOOK.md`)

Standard runbook sections:
1. **What this is** · 1-3 sentences · audience-aware
2. **When to use** · the triggering event/condition
3. **Prerequisites** · what must already be set up
4. **Steps** · numbered · each step has a verification check
5. **Rollback** · if things break · how to back out
6. **Anti-patterns** · common ways operator might mess this up

**Anti-pattern · "Detailed prose runbook."** Runbooks are CHECKLISTS. If your runbook has paragraphs longer than 3 sentences, you're losing the operator under stress. Bullet-list everything.

## When to write what · the decision tree

```
Daily wind-down → JOURNAL entry (Surface 1)
NEW fact crystallized → BRAIN_MEMORY row (Surface 2)
Structural choice made → ADR (Surface 3)
Incident with impact → POSTMORTEM (Surface 4)
Procedure needs repeating → RUNBOOK (Surface 5)
```

**Anti-decision-trees** · don't try to fit a journal entry into an ADR · don't pretend a runbook is a postmortem. Each surface has a DIFFERENT JOB. Cross-posting between surfaces dilutes both.

## Co-authoring with the agent (doc-coauthoring skill)

When operator + agent collaborate on a doc (ADR · postmortem · runbook), the agent's job is:
1. **Structure scaffolding** · drop in the standard sections + headings · operator fills the meat
2. **Cross-reference** · "this overlaps with ADR-0017 · should we link?" · let operator decide
3. **Consistency check** · "the timeline says 12:00 but the root-cause says 11:30 · which is correct?"
4. **Tone normalization** · soften emotional language for shareable docs · preserve it for journals

The agent is the SECOND brain reading what operator wrote · the operator stays the FIRST brain producing it. Agent doesn't write FOR the operator · agent makes operator's writing 20% better with 5% effort.

**Anti-pattern · "Agent writes the whole postmortem."** Agent doesn't know the emotional truth. Operator writes the rough draft · agent polishes structure. Reverse is generic.

## Internal-comms layer (the team-facing slice)

When/if Nick's Tire & Auto adds staff (CTO · advisor · contract dev), internal-comms become a thing:

**Status updates** · weekly · format · 3-bullet "what shipped" + 1-bullet "what's stuck" + 1-bullet "what I need from team"
**Decision broadcasts** · ADR link + 2-sentence summary · sent in operator's Slack/Discord/Telegram channel
**Incident retros** · postmortem link + verbal walkthrough in next standup · NOT email-broadcast for solo-operator stage
**Q&A** · async first · synchronous only when context-loading exceeds 5 min of writing

Until there's a team, this surface is dormant · journal + brain_memory + ADRs are the operator-only equivalents.

## Writing-discipline anti-patterns

### "Performative perfectionism"

Operator rewrites a journal entry 8 times to make it sound clever. Defeats the purpose · journal is supposed to be raw. Ship at 70% polish · the value is in the WRITING ACT not the artifact.

### "Documentation-as-procrastination"

Writing 8 ADRs about future architecture choices instead of shipping the next bug fix. Documentation is leverage · NOT escape from execution. The 80/20 · 80% shipping · 20% documenting · NOT 50/50.

### "Tone shifts mid-doc"

ADR starts neutral, ends with operator's personal frustration about a vendor. Journal entry pivots into a runbook. Pick ONE surface per doc · the structure-of-writing teaches future-self something about WHEN to write WHAT.

### "Stale runbooks"

Operator updates the code, doesn't update the runbook · 6 months later operator follows the runbook · doesn't work · 2hrs debugging. Discipline · every PR that changes a runbook's referenced code MUST update the runbook in the same PR. Add lint.

### "Memory bloat"

Operator adds 5 `brain_memory` rows per chat turn. After 6 months, retrieval is full of low-signal entries · agent's `/brain` recall is noisy. Memory is for FACTS THAT SURVIVE THE WEEK · not for every observation.

## Implementation plan (queued)

1. **Lint enforcement** · pre-commit hook · every doc in `docs/` must declare its surface (ADR/runbook/postmortem) via frontmatter OR filename convention
2. **`/journal` writing-streak surface** · statenour shows last 30 days · highlights gaps · operator can't game the streak by writing one-liner entries (length floor)
3. **Memory bloat detector** · monthly cron · flags `brain_memory` rows that have no retrievals in 90 days · operator decides to archive
4. **Auto-cross-ref** · agent reads a new ADR/postmortem · suggests related existing docs · operator includes the cross-refs in the final
5. **Runbook stale-detector** · weekly cron · grep runbooks for filenames/paths that no longer exist in the codebase · ping operator

## Skill-port lineage

B9 from the audit's Round 2 (diary + doc-coauthoring + internal-comms bundled). Pairs with:

- `docs/eval-rubrics/task-intelligence.md` (the operator-state signal feeds into which surface to write where · "Reflective" → journal)
- `docs/eval-rubrics/dashboard-storytelling.md` (statenour `/journal` and `/seo` are themselves docs · same writing discipline applies to the auto-generated text on those surfaces)
- `docs/eval-rubrics/code-craft-review.md` (comment quality · the in-code writing layer · runs the same discipline at a smaller granularity)
- `docs/eval-rubrics/incident-response.md` (postmortems are the formalization of incident-response's "after" phase)
- Memory · `pattern` + `wisdom` + `decision_pattern` brain categories (the SEMANTIC equivalents of ADRs)

Future · agent reads the operator's writing across all 5 surfaces · synthesizes the writing-style profile · drafts in the operator's voice (cross-ref NickGPT moat play · Wave AE Cat 12). Same as how the SMS-reply corpus trains the voice · the doc-writing corpus trains the doc-voice.
