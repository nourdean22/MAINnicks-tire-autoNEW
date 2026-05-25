# Autonomous Action Tiers · who can do what without operator approval

**Skill port:** A5 · autonomous-agent-patterns + autonomous-agents
**Applies to:** `apps/nickstire/server/cron/jobs/nickAutoActions.ts`,
`agenticAuditor.ts`, `improveAgent`, voice-agent escalations, any
future agent that takes actions without operator-in-the-loop.
**Authored:** 2026-05-26 · operator review pending.

---

## Why this doc exists

Today the codebase has multiple autonomous code paths · SMS crons,
voice-agent tool calls, intelligence-engine auto-actions, improve-agent.
Each was built with the operator's instinct on what's safe. As the
agent surface grows, the instinct doesn't scale. This doc codifies
the rules so a NEW agent can be classified before it ships:

> **"Can this agent take action X without asking the operator?"**

is answered by mapping X to a TIER, not by re-deriving the answer
each time. Adopted from the audit's autonomous-agent-patterns
skill-port (A5 in Round 2 deep-pass).

---

## The 5 tiers

### Tier 0 · NEVER auto-execute · always human-in-loop

Actions that move money, change schema, or contact customers in
ways that can't be unwound.

- Issuing refunds (Stripe / cash / credit)
- Sending email or SMS campaigns to >50 recipients in one batch
- Schema migrations to prod (DDL · ALTER · DROP · CREATE)
- Stripe webhook secret rotation or API key rotation
- Pricing changes affecting customer-facing surfaces (tireMarkup, service prices)
- Changing the SMS sender number (F25e gateway settings)
- Deleting customer records (CCPA "right to be forgotten" requires audit trail · but the DELETE itself is human-confirmed)
- Voice-agent commitments to a specific time slot without simultaneous `bookSlot` tool fire

**Implementation:** these MUST require an explicit operator confirmation
step (admin button, Telegram callback, in-chat approval). The
`bookSlot` ↔ "Done!" race in #285 was a Tier-0 violation · agent
SAID it booked, didn't actually book.

### Tier 1 · Auto-execute with mandatory pre-action audit trail

Actions that are reversible OR low-impact but must leave a paper
trail before they happen.

- Sending a single SMS to ONE customer (booking confirm, follow-up,
  drip · NOT marketing blast)
- Creating a single booking row from voice-agent input
- Creating a single lead row
- Marking a single invoice as paid (when triggered by Stripe webhook
  · the webhook signature is the audit trail)
- Triggering a single cron job manually (admin "Run Now" buttons)
- Setting a customer segment (lapsed → active, etc.)

**Implementation:** every action writes to a structured log table
BEFORE the action fires. If the action errors, the log row still
exists · operator can see "we tried to send SMS to X at T,
failed for reason Y."

### Tier 2 · Auto-execute, post-action notification

Actions that happen in batch and don't need pre-approval but the
operator should know happened.

- Cross-sell SMS batch (`crossSellOutreach.ts`)
- Drip campaign progression (`dripProcessor.ts`)
- Decline-recovery SMS (`declinedWorkRecovery.ts`)
- Win-back campaigns (`winbackProcessor.ts`)
- Auto-segmentation refresh (`customer-segment-refresh`)
- Review-request sends (`reviewRequests.ts`)
- Service-affinity prediction compute (`serviceAffinityCompute`)

**Implementation:** cron runs · summarized via Telegram at end of
run. Operator gets "Sent 8/10 cross-sell SMS for 2026-05-26 11:00
tick · 2 skipped (cooldown · opt-out)." If the batch is >MAX_SMS_PER_RUN
of 10 it must auto-throttle, NOT auto-escalate the cap.

### Tier 3 · Self-healing · execute + audit but no operator notify (silent unless escalates to Tier 1+)

Infrastructure-recovery actions that should "just work."

- DB connection reset (after lost connection · `resetDbConnection()`)
- Cron lock release on TTL expiry
- Cache invalidation
- In-memory state reset on detected drift
- Re-fetching stale data after Railway pod restart
- Garbage collection trigger on memory pressure

**Implementation:** logs at INFO level for observability · NO
Telegram alert unless the recovery FAILS (which would be a Tier 0
escalation · "self-healing tried to recover DB and couldn't").

### Tier 4 · Pure read-only · no action, only signal

Audits, analyzers, intelligence engines. Output IS the action.

- `agenticAuditor.ts` cron
- `intelligenceAutopilot` (alerts only, no actions)
- `predictiveEscalation` (flags, doesn't act)
- `safetyMonitor` (reads + flags)
- `vapiCallEval` daily (reads transcripts, writes eval scores · scores ARE the output, no downstream action)

**Implementation:** writes to a structured analysis table. Operator
or another agent decides what to do with the signal. Never directly
fires Tier 0-2 actions.

---

## Classification flowchart for NEW agents

```
Does the action:
├─ Move money OR contact >50 customers OR alter schema?
│    YES → Tier 0 · require operator confirmation
│
├─ Touch exactly 1 customer + reversible within 24h?
│    YES → Tier 1 · audit-log pre-action
│
├─ Run as a scheduled batch under MAX-per-run cap?
│    YES → Tier 2 · post-batch summary
│
├─ Recover from a transient failure?
│    YES → Tier 3 · silent unless re-fails
│
└─ Only read + classify + signal?
     YES → Tier 4 · output IS the action
```

---

## Anti-patterns called out

### Tier creep · "this is just one customer"

The `dripProcessor` started life as Tier 1 ("one customer at a time")
but the cron tier runs it every 5 minutes · across the customer base
that's effectively Tier 2. Re-classify when cron frequency × scope
crosses the boundary.

### Silent Tier 0 · agent says "done" without verifying

Wave J audit #285 documented this for the voice agent · Mastra
streamed a tool call, didn't get a result, hallucinated "Done!"
This is a Tier 0 violation EVEN IF the underlying action would
have been Tier 1 had it executed. The lie is the violation.

**Rule:** if an agent claims an action happened, the audit trail
MUST contain evidence of the action. No evidence = the claim is
a lie, regardless of what the agent says.

### Aggregating Tier 1 into Tier 0

If a Tier 1 action (single-customer SMS) is called in a loop over
N customers, that's effectively Tier 0 IF N is large enough to
cause CAN-SPAM / TCPA exposure. Loop-of-single-actions ≠ batch.
The aggregator must be classified at the higher tier.

### "Just for testing" auto-actions

Test code that calls real Stripe / real SMS / real DB write is
Tier 0 regardless of intent. Use the dry-run flag pattern
(`{ dryRun: true }`) on all Tier 0/1 paths. Wave A1
(tool-use-guardian skill-port) defines the structured dry-run
wrapper · pending implementation.

---

## How to use this doc

When writing a new cron job, voice tool, or agent action:

1. Read the action's effect · what does it CAUSE?
2. Match to the flowchart above
3. Implement the audit/notify pattern for that tier
4. Document the tier in the function's doc comment:
   ```typescript
   /**
    * Tier 1 · single-customer SMS with pre-action log row.
    * See docs/eval-rubrics/autonomous-action-tiers.md
    */
   ```
5. PR review checks the tier match against the action's actual scope

---

## Skill-port lineage

This doc is the operator-facing version of the
autonomous-agent-patterns + autonomous-agents skills from the
1,400+ skill library. Port shape · the FRAMEWORK becomes a project
artifact, not external tooling. Same shape as:

- voice-agent eval rubric (Wave R · skill PORT 10)
- prerender-incident postmortem (Wave T · skill B1)
- brand-archetype lint patterns (Wave Q · skill PORT 5)
- unslop lint patterns (Wave T · skill S2)
- PII lint patterns (Wave U · skill B3)

Each port: discipline catalog · vendored once · compounds across
every future commit.

---

## Future extensions

- **`tier:` doc-comment lint** · CI rule that flags any new cron
  job without an explicit tier classification in its doc comment.
- **Tier-aware Telegram digest** · operator's daily Telegram summary
  groups actions by tier · "Tier 2 (auto): 47 SMS sent · Tier 1
  (single): 12 bookings · Tier 0 (confirmed): 3 refunds approved."
- **Action audit table** · per-tier query for compliance audits
  (CCPA · TCPA · CAN-SPAM all care about WHAT happened, not just
  THAT it happened).
