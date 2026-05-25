# SMS Sequence Objection-Preempt Framework

**Skill port:** PORT 4 · objection-preemptor + sequence-psychologist + scarcity-urgency-psychologist
**Applies to:** every SMS template under `apps/nickstire/server/cron/jobs/*Sequences.ts`, `crossSellOutreach.ts`, `winbackProcessor.ts`, `dripProcessor.ts`, `declinedWorkRecovery.ts`, `postInvoiceFollowUp.ts`.
**Authored:** 2026-05-26.

## Why this doc exists

Most SMS templates were written one at a time · operator instinct · "this feels right." The objection-preemptor skill says: every touch point has predictable objections AT THAT SPECIFIC stage. Pre-empt them in the message body and conversion lifts measurably (declined-work recovery 5×3 sequence in `#44` already validates this).

This doc generalizes the pattern · every NEW SMS template runs through it before ship.

## The 5 objection classes (by stage)

### Stage 1 · "Why are you texting me?"

**When:** first message after a quote/decline/visit · customer doesn't remember signing up.

**Pre-empt elements:**
- Mention the specific transaction ("After your brake estimate Tuesday")
- Use first-person shop voice ("Moe here from Nick's")
- One concrete proof point (date, vehicle, service)

**Bad:** "Hi! Following up on your service request."
**Good:** "Hi Sarah — Moe from Nick's. Following up on the brake estimate from Tuesday on the 2018 Camry."

### Stage 2 · "It's too expensive"

**When:** quote-to-followup sequences · winback for lapsed customers · cross-sell to existing.

**Pre-empt elements:**
- Anchor against the alternative cost (going somewhere else, doing nothing)
- Time-cost the deferral ("$0 today vs $200 next week when it gets worse")
- Concrete promise that removes risk ("written quote, no surprises, you don't pay until you say yes")

**Bad:** "Bring it in for service."
**Good:** "Brakes don't get cheaper waiting. $189 now vs $400+ if a rotor warps. Drop it off Saturday — free check, written quote, you don't pay until you say yes."

### Stage 3 · "I'll do it later"

**When:** D7 retention · D14/D30/D45 decline-recovery · D-anything follow-up.

**Pre-empt elements:**
- Concrete near-term anchor (THIS Saturday, before 5 PM)
- Friction-removal proof point (walk in, drop off, no appointment)
- Loss-aversion frame for the deferral, not the action

**Bad:** "Schedule your next service whenever you're ready."
**Good:** "Walk in this Saturday — first-come-first-served, no appointment. The longer you wait on the alignment, the more your tires cup. $89 now vs new tires later."

### Stage 4 · "I'm not sure if I need it"

**When:** cross-sell from intelligence engine · service-affinity v2 predictions.

**Pre-empt elements:**
- ONE diagnostic detail the customer can check themselves ("If you hear squealing when you brake, the pads are at the wear indicator")
- Free-check offer (no pressure to buy if it turns out fine)
- Customer-language ("we'll tell you what's wrong" not "comprehensive diagnostic inspection")

**Bad:** "Time for your annual brake inspection!"
**Good:** "If you hear any squeaking when you brake, the pads are at the wear indicator. Drop it off any time this week — free check, no pressure if it's fine."

### Stage 5 · "I already booked / got it fixed"

**When:** any sequence still firing for a customer who's already converted.

**Pre-empt elements:**
- Always check the latest customer state before sending
- Include opt-out anchor ("text STOP" OR "if you got it sorted, no need to reply")
- Don't double-down on the same offer · acknowledge possibility of progress

**Bad:** "Reminder: schedule your brake service!"
**Good:** "Following up on the brake quote — if you've already gotten it sorted, no need to reply. If not, Saturday walk-in is open, $189 / no appointment."

## Decision flowchart for new SMS templates

```
Q1: At what stage is the customer? (first touch · cold reminder · cross-sell · cooled-off)
  → Maps to ONE of the 5 stages above

Q2: What's the dominant objection at this stage?
  → "Why are you texting" · "Too expensive" · "I'll do it later"
  · "Not sure I need it" · "Already done"

Q3: Pick 3 of the 4 pre-empt elements for that stage
  → Combine into <160 chars (single SMS) or 320 chars (2-part)

Q4: Does the message pass the brand-voice lint + PII lint + unslop lint?
  → Run via the pre-commit gate · iterate

Q5: Does it include EXACTLY ONE call-to-action with a concrete next step?
  → If 2+ CTAs · cut · cognitive load kills conversion
```

## Anti-patterns

### "Greater than 1 CTA"

"Call us, book online, or stop by!" · this maxes out conversion at the LEAST-friction CTA. Just pick the one. Walk-in is usually the right pick for Nick's (FCFS model).

### "Vague urgency"

"Don't wait too long!" means nothing. Concrete: "Saturday or it goes to $X next week."

### "Service description without consequence"

"Brake pads · $189." · tell them what happens if they DON'T do it. Loss-aversion outperforms positive framing 2:1.

### "Long preamble before the ask"

Every word before the value proposition is conversion-cost. Lead with the proof point.

### "Assumed prior knowledge"

"Time for service!" assumes the customer remembers what's overdue. Specify · "Time for your tire rotation — it's been 6 months."

## Apply to existing sequences

`winback` (`apps/nickstire/server/cron/jobs/retentionSequences.ts`) · 4 SMS bodies should be re-audited against Stage 3 (I'll-do-it-later). Most likely missing the "concrete near-term anchor" element.

`crossSellOutreach` (`crossSellOutreach.ts`) · single SMS per prediction · should be Stage 4 (Not-sure-I-need-it). The current template uses SERVICE_LABELS map · check that each label has a customer-readable consequence attached.

`decline-recovery` (`declinedWorkRecovery.ts` + 3d/14d/45d columns from migration 0055) · these are Stage 2 (Too-expensive) · the 5×3 sequence from `#44` already follows the framework · use as the reference implementation.

`postInvoiceFollowUp` · 7-day thank-you + review request · this is Stage 1 (Why-are-you-texting) · most likely already correct but worth a re-audit.

## Skill-port lineage

Same shape as Wave V (autonomous-action tiers) · vendors the framework as a project artifact · every NEW SMS template runs through the flowchart before ship. Pairs with:
- Wave Q · archetype linter (catches HERO/SAGE tones at lint time)
- Wave T · unslop linter (catches LLM-output tells)
- Wave R · voice-agent eval rubric (parallels this for voice tools)
- Wave V · autonomous-action tiers (each SMS sequence has a tier classification)

PORT 4 from the audit's Round 1 ROI ranking. Standardizes what `#44` declined-work recovery already proved at one surface.
