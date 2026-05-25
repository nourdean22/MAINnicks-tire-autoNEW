# Multi-Advisor Board Pattern

**Skill port:** PORT 7 · multi-advisor + multi-agent-patterns + brainstorming
**Applies to:** statenour `/brain/board` consultBoard (the operator's "ask N advisors at once" surface · per memory's #23/#24/#54 multi-advisor wave).
**Authored:** 2026-05-26.

## Why this doc exists

The current `consultBoard` fires 6 parallel aiChat calls. Each advisor returns its response · the operator reads 6 outputs. Problem · without explicit structure, all 6 sound similar · agreeable · same model + similar system prompt = same output style.

The multi-advisor skill argues: a real advisory board adds value through DISSENT, not consensus. Each advisor should bring a distinct reasoning lens AND be required to surface at least one objection to the operator's framing.

## The 5-element advisor spec

Every advisor on the board has:

### 1 · Distinct reasoning lens

Not just "a model" · a defined cognitive style. Examples from the operator's existing persona library:

- **Karpathy** · think first · simplest thing that works · surgical edits
- **Elon** · first principles · question/delete/simplify/accelerate
- **Jobs** · taste-first · what would they tell their grandmother
- **Buffett** · downside-first · margin-of-safety · "I'm only smart enough to avoid stupid"
- **Sutskever** · scaling-laws-first · what does this look like at 100x current scale
- **Hinton** · empirical-first · what experiments would prove or disprove this
- **Lecun** · architecture-first · what's the right abstraction layer
- **Bezos** · day-one-thinking · what would the customer notice
- **Brooks** · second-system-effect · what gets worse before it gets better

The board picks 4-6 of these per consult. The lens determines the system prompt for that advisor.

### 2 · Mandatory dissent quota

Each advisor MUST surface ≥1 specific objection · NOT agreement. The system prompt enforces:

> Before answering, identify ONE specific objection to the user's framing OR ONE risk they haven't named. Open your response with that objection. THEN give your recommendation.

This breaks the "all advisors agree" failure mode. If an advisor genuinely sees no objection · they say so explicitly · "no objection, but here's the risk you should still hedge against."

### 3 · Stakes-aware framing

The advisor's reasoning style maps to the DECISION CLASS:

- **Strategic / 5-year decisions** · Buffett, Bezos, Karpathy
- **Tactical / this-month decisions** · Jobs, Elon, Brooks
- **Technical / architecture decisions** · Lecun, Sutskever, Hinton
- **Mixed / both** · the operator picks the panel

A consult that mixes Buffett + Elon on a "should I rebuild the brain memory architecture" decision produces useful tension. A consult that asks Buffett + Bezos for tactical SMS template wording produces noise.

### 4 · Pre-consult brainstorm step

Per the brainstorming skill: validate the QUESTION before asking the advisors.

Current flow: operator types question · 6 calls fire · 6 responses come back.

New flow:
1. Operator types question
2. A "brainstorm" pre-step fires (1 fast model call) · reformulates the question 3 ways · asks operator to pick which to send to the board (or proceeds with the original)
3. The selected formulation goes to the advisors

Why · most "bad advisor board outputs" are because the QUESTION was ambiguous. Spending 5 seconds clarifying the question saves the 6 × 30-second advisor calls from producing noise.

### 5 · Post-consult synthesis

After the 6 advisors respond · ONE more call fires (the "synthesizer") that:
- Surfaces the ≥1 dissent each advisor raised
- Identifies the genuine disagreement points (where 2+ advisors took opposite sides)
- Recommends ONE specific action with explicit acknowledgment of which advisor's dissent it accepts

The synthesizer is NOT another advisor · it's a meta-step. Its system prompt is `synthesize · don't introduce a 7th opinion`.

## Cost discipline (pairs with claude-monitor.md)

A full consult is 1 (brainstorm) + 6 (advisors) + 1 (synth) = 8 calls. At $0.50/call · ~$4/consult. Per the budget gate (Wave V autonomous-tiers · Tier 4 operator-triggered), this is acceptable IF used sparingly.

Recommended cap · 5 consults/day MAX (logged via claude-monitor). Operator gets a Telegram nudge at 5 · "you've used today's board budget."

## Anti-patterns

### "Same model, different name"

All 6 advisors are Claude Sonnet with slightly different system prompts. The DIFFERENCE in output is marginal. Real differentiation requires either (a) different models OR (b) very different reasoning prompts. Lean into (b) · the lens is what matters, not the model.

### "Consensus collapse"

After several consults, the operator notices the board agrees on everything. Dissent quota was working, then drift set in. Re-audit prompts every 2 weeks.

### "Synth as 7th opinion"

The synthesizer says "I think you should do X" instead of "Advisor-A says X, Advisor-B says Y, here's the disagreement." The synth's job is to surface tension, not resolve it. Tension is the value.

### "Pre-brainstorm skipped"

Operator hits "consult" with a vague question · 6 advisors give 6 answers to 6 different interpretations · useless. Brainstorm step is non-negotiable.

## Implementation plan (queued)

1. Audit current `consultBoard` system prompts · are they sufficiently differentiated?
2. Add dissent-quota to each advisor's system prompt
3. Build the brainstorm pre-step (single fast-model call · returns 3 reformulations + pick-one UI)
4. Build the post-consult synthesizer
5. Wire into claude-monitor for cost tracking + budget gate

## Skill-port lineage

PORT 7 from the audit's Round 1 ROI ranking. Pairs with:
- Wave V · autonomous-action tiers (operator-triggered tier classification)
- B4 · claude-monitor (budget tracking)
- Wave R · agent-eval rubric (could be adapted to score advisor quality)

Memory references · #23/#24/#54 are the multi-advisor wave's prior implementation. This doc is the NEXT iteration · ports the framework discipline that was missing.
