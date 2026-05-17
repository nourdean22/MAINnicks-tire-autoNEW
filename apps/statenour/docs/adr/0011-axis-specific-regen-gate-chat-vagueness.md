# ADR-0011 · Axis-specific regen gate · the chat-vagueness fix

**Status:** Accepted (Tier 1 shipped v10.0.490 · Tier 2 + Tier 3 sequenced)
**Date adopted:** v10.0.490 (2026-05-12)

## Context

By 2026-05-12 the OS had landed 6+ prompt-quality features specifically
targeting Nick's reply quality:

- v1 ↔ v2 prompt builder split (ADR-0003)
- Causation magnitudes removed · LIVE SCOREBOARD dedup · response-style
  unified (v10.0.444-447)
- BROADEN_AND_SUGGEST operator rule (v10.0.482)
- Creativity dial bumped on 6 intents (v10.0.481)
- ANTICIPATE_AND_ELEVATE directive + `/strict` + `/chill` modes (v10.0.488)
- GSC bridge wired closing the SEO-fabrication loop (v10.0.487)
- L1-L5 fabrication-defense stack already documented

And yet the operator reported: **Nick still feels "very vague and generic."**

That's a systemic complaint, not a single-rule miss. The first instinct
("add another rule to the system prompt") had been tried six times and
had not moved the needle. Before adding rule #7, we measured.

### The measurement

`GET /api/system/quality?limit=20` against the live 217 last-30-day Nick
replies returned:

| Axis | Score | Verdict |
|---|---|---|
| Cliché | 99/100 | ✅ no stock phrases (cliche-detector working) |
| Anti-Nour | 95-97/100 | ✅ no corporate-speak ("utilize", "leverage") |
| Length | 90-95/100 | ✅ right size per output shape |
| **Specificity** | **50-53/100** | ❌ chronically generic |
| Overall avg | 80/100 | misleadingly healthy |
| **regenRate** | **1%** | critic almost never blocks |

76% of turns are intent=`factual` — the case where specifics matter most.

### Why the masking happened

`output-critic.ts` (built v9.x, weights frozen Apr 19) computes:

```
overall = 0.35×spec + 0.25×cliché + 0.20×antiNour + 0.20×length
shouldRegen = overall < 55
```

A wholly-generic reply (spec=30, cliché=100, antiNour=100, length=100)
scores `0.35×30 + 0.25×100 + 0.20×100 + 0.20×100 = 75.5` → passes the
55 threshold → ships.

The cliché-detector + anti-Nour fixes were so effective that they
permanently boost 3 of the 4 axes to ~95+, mathematically masking
specificity gaps. The very success of those earlier fixes is what
made the spec axis invisible.

Plus: the critic runs **post-stream** in `persist-assistant-turn.ts`.
By the time `shouldRegen=true` lands in the DB, the user has already
seen the reply. The only operator-facing surface is a subtle UI hint.

### Compounding root causes

1. **Weighting math hides axis-specific failures** when other axes are
   near-perfect (the current state for cliché + antiNour + length).
2. **Critic is observation-only** — no auto-regen on the streaming
   path, so even when `shouldRegen=true` the reply already shipped.
3. **System prompt's "be concrete" rule is abstract** — when the brain
   context doesn't contain numbers/names/dates, Nick reverts to
   LLM-default vague rather than refusing.
4. **Bridge data surface is narrow** — only 13 nour-os-query handlers
   in nickstire-dev (revenue/leads/bookings/work-orders + a handful
   more). Outside those domains, Nick has nothing to cite.

## Decision

**Three-tier fix, sequenced smallest-to-largest, each tier independently
shippable.**

### Tier 1 · axis-specific regen gate (v10.0.490 · shipped)

`output-critic.ts:critiqueOutput()` now fires `shouldRegen` on EITHER:

- `overall < 55` (the existing weighted gate), OR
- ANY single critical-axis miss:
  - `specScore <= 30` (spec_density < 0.5/100w · the "generic" bucket)
  - `clicheScore <= 20` (cliche_density >= 2.0/100w)
  - `antiScore <= 20` (3+ anti-Nour hits)
  - `lengthScore <= 30` (way off shape range)

When the axis-gate fires (and not the overall gate), `reasons[]` gets
`axis-gate · spec alone fires regen` so the post-stream log + UI hint
surfaces WHY.

Test coverage: `tests/ai/output-critic.test.ts` (3 tests · spec=critical
alone fires regen · all-axes-pass doesn't fire · overall<55 path
preserved).

**What this does:** measurement only. Vague-but-clean replies now
get flagged with `shouldRegen=true`. The reply still ships (critic
is post-stream). Expected outcome: regenRate jumps from 1% to ~30-40%
within 24h once new replies land. If it does, the diagnosis is proven
and Tier 2 is justified.

**What this does NOT do:** doesn't actually improve reply quality.
The critic just sees the problem accurately now. The reply still
streams generic on first generation.

### Tier 2 · evolved into TWO shipping paths

#### Tier 2a · high-specificity gate (v10.0.499 · SHIPPED, env-flagged)

`NICK_HIGH_SPEC_GATE=on` env flag activates a preemptive specificity
directive prepended to the system prompt on `factual / decision /
instructional / procedural / analytical` intents (5 intents per
`shouldGateForIntent()` in `lib/ai/chat/pre-stream-regen.ts`). The
directive (REGEN_SYSTEM_PREFIX) demands:

- SPECIFIC numbers · names · dates · system names · cite sources
- Admit "I don't have X · the bridge doesn't expose that yet" instead
  of approximating
- No hedging language (might / could / may / depending)
- No stock phrases
- Ask ONE clarifying question if unanswerable instead of guessing

Wiring in `app/api/ai/chat/route.ts` after `finalSystemPrompt` is
finalized (line 794). Surgical · 25 LOC · zero impact when flag off.

**Cost:** ~150 extra system-prompt tokens per gated turn. No extra
LLM call. No latency tax. Reversible by `NICK_HIGH_SPEC_GATE=off`.

**Why this before Tier 2b:** the original ADR proposed pre-stream
generate → critic → regen → stream-winner. Implementing it cleanly
needs UI-stream-compat work (the AI SDK's `streamText` doesn't
trivially accept a pre-computed string as a stream). Tier 2a tests
the hypothesis ("if Nick gets the hard prompt, he generates
specific replies") at much lower cost. If 2a moves the spec axis
from 50 → 65+ over 7 days · Tier 2b is unnecessary. If 2a doesn't
help (the LLM just hedges anyway), Tier 2b becomes justified.

**Acceptance:** post-Tier-2a specificity axis mean should rise to
65+ over a 7-day window with the flag on. Operator-reported "vague"
complaints should drop.

#### Tier 2b · pre-stream auto-regen with winner-selection (UNBLOCKED v10.0.507)

Original Tier 2 design · two LLM calls per gated turn that fails
the critic · winner-select between first attempt and regen ·
stream the winner. Helper module shipped at v10.0.492 in
`lib/ai/chat/pre-stream-regen.ts` (`maybePreStreamRegen()`).

**v10.0.507 unblock:** the UI-stream-compat utility shipped at
`lib/ai/chat/simulate-stream-from-text.ts` (`simulateStreamFromText()`).
Uses AI SDK's `createUIMessageStream` + `createUIMessageStreamResponse`
to wrap a pre-computed string as a UIMessage stream identical to the
wire format `streamText().toUIMessageStreamResponse()` produces. 8
tests pass · works for single-chunk + typewriter (chunked) emission.

Tier 2b wiring is now ready to ship:
1. ✅ UI-stream-compat utility (`simulateStreamFromText`) — DONE v10.0.507
2. **Wire** `maybePreStreamRegen` into the chat route gated by a
   `NICK_PRESTREAM_REGEN=on` env flag (separate from `HIGH_SPEC_GATE`).
   On flag-on AND `shouldGateForIntent(intent)`:
   - Call `generateText` for first attempt
   - Run critic
   - If `shouldRegen`, call `generateText` again with REGEN_SYSTEM_PREFIX +
     temperature bump
   - Use `simulateStreamFromText` with the winner-selected text to ship
     it back as a UIMessage stream
   - Telemetry: `formatRegenTelemetry()` writes to SystemMetric
3. Cost: +1-2s latency on regen path · double LLM call cost on regen
   turns only (no extra cost on first-pass-passes turns)

**Deferred decision:** wire Tier 2b only if Tier 2a telemetry shows the
spec axis NOT moving from 50 → 65+ after 7 days of `NICK_HIGH_SPEC_GATE=on`.
If Tier 2a is enough, the cost/complexity of 2b is unjustified · the
helpers stay shipped but dormant for the rainy-day case.

### Tier 3 · expand the bridge data surface

The GSC bridge fix at v10.0.487 was the proof of concept · making one
data category grounded collapsed a whole category of vague replies into
specific data. Continuing that pattern · the candidate categories are:

- ~~`customer_lookup`~~ · **ALREADY COVERED** by the existing
  `findCustomer` tool (`lib/ai/tools.ts:2315`) which combines
  `customer_search` bridge + brain memories + person profile into a
  360° timeline. v10.0.494 verification confirmed this. No new
  handler needed · the open question is "why isn't Nick reaching for
  findCustomer when he hallucinates customer details" · likely
  needs description-clarity work OR the chat-route to surface it
  more aggressively for customer-shaped questions.
- `marketing_channel_attribution` (which lead source funded today's
  revenue · 30d ROI per source) · **NOT BUILT** · highest-leverage
  gap given how often Nour asks "what's working"
- `inventory_by_tire_size` (live stock numbers, not approximations) ·
  **NOT BUILT** · removes "Nick guesses about stock" failure mode
- `open_work_orders` (cars in bays right now · with parts-waiting
  flags) · **NOT BUILT** · removes "Nick guesses about shop state"
- `appointment_book_next_7d` (which slots are still open) ·
  **NOT BUILT** · removes "Nick approximates availability"

Each handler is ~20-40 LOC matching the `revenue_range` pattern at
`server/routes/nour-os-query.ts:61-80`. After each ship, register a
matching tool in statenour-os `lib/ai/tools.ts` so Nick can call it.

Sequencing: ship `marketing_channel_attribution` first (highest
leverage per operator complaint frequency), then inventory, then
work orders, then appointment book. Validate the specificity axis
lift per handler via `/api/system/quality` dashboard.

## Consequences

**Positive:**

- The earlier 6 prompt-quality fixes (cliché-detector, anti-Nour,
  length tuning, BROADEN_AND_SUGGEST, etc.) keep paying off — Tier 1
  just stops them from masking the spec axis. Net gain compounds.
- Tier 2 is the smallest move that actually changes Nick's first
  reply (vs the previous 6 fixes that all targeted the prompt and
  hoped the LLM would comply).
- Tier 3 turns "Nick fabricates SEO numbers" / "Nick hedges on
  inventory" / "Nick guesses about callbacks" into "Nick cites the
  bridge or refuses cleanly." Each handler removes a whole category
  of vague.
- The 3-tier sequencing means Tier 1 + 2 are reversible (env-flag
  rollback). Tier 3 adds new data surfaces; the only risk is unused
  handlers, which is reversible by removing them.

**Negative:**

- Tier 2 adds ~1-2s latency on factual/decision turns. Acceptable
  trade-off — the operator has stated repeatedly that quality wins
  over speed.
- Tier 2 doubles the per-turn LLM cost on regen turns. Mitigated by
  the 4-provider chain (ADR-0001) — regen can serve from Venice
  flux2/Ollama which are cheap.
- Tier 3 is genuinely a lot of work to do well. Each handler needs
  the bridge endpoint + the statenour tool registration + prompt
  awareness + a test. Easy to half-ship.
- The cliché-detector / anti-Nour / length tuning earned axis scores
  near 100 because those rules are simple regex checks. Specificity
  is harder — there is no clean regex for "did Nick cite real
  numbers." The `SPECIFICITY_PATTERNS` regex is narrow (misses ISO
  dates, file paths, non-business nouns) so the score is itself
  under-estimating. Worth tightening separately.

## Alternatives considered

- **Add a 7th prompt rule** ("be more specific!") · rejected. The
  first 6 didn't move the needle. The LLM follows the rules but
  generates plausible-looking generic output when it doesn't have
  real data. Prompt rules can't conjure data.
- **Raise specificity weight to 0.60+** · rejected. Reweighting
  changes one number, doesn't fix the structural masking. Plus,
  cliché and anti-Nour are real signals worth keeping.
- **Lower the overall threshold from 55 to 70** · rejected. Would
  flag too many borderline-OK replies. Axis-specific gating is
  more precise.
- **Block all replies that lack numerics** · rejected. Many valid
  replies (emotional, reflective, navigational) genuinely shouldn't
  have numerics. Intent-aware gating (Tier 2) is the right shape.
- **Switch the critic to an LLM-judge** · deferred. The judge-eval
  pipeline (ADR-0007 stack) already exists and could replace the
  regex critic. Higher quality but ~$0.05-0.20 per turn and
  ~500-1000ms latency. Worth piloting later; Tier 2 first to see
  if the cheap fix works.

## References

- `lib/ai/output-critic.ts` — the critic with axis-specific gate
- `lib/ai/cliche-detector.ts` — the cliché regex pack
- `lib/ai/nour-voice-profile.ts` — `SPECIFICITY_PATTERNS` + `ANTI_NOUR`
- `lib/services/chat/persist-assistant-turn.ts:395-431` — where the
  critic is invoked post-stream
- `app/api/system/quality/route.ts` — the dashboard endpoint that
  exposed the spec=50 / overall=80 gap
- `tests/ai/output-critic.test.ts` — Tier 1 test coverage
- ADR-0003 · v1/v2 prompt builder split — the rule-based fix layer
- ADR-0007 · skill semantic recall — judge-eval pipeline (Tier 2
  alternative)
- ADR-0009 · multi-agent parallel sub-agents — pre-task fan-out
  (could feed Tier 2 regen)
- v10.0.487 commit · GSC bridge wired (Tier 3 prototype)
- v10.0.490 commit · Tier 1 ship

## Open items

- Tier 2 build (1-2 versions estimated) — gates on Tier 1 telemetry
  proving the diagnosis (regenRate jump expected).
- `SPECIFICITY_PATTERNS` regex narrowing — currently misses ISO
  dates (2026-05-08), file paths (`scripts/foo.ts`), non-business
  noun counts (`12 BrainBusEvent rows`), code references. Widening
  would lift baseline spec score without changing reply quality —
  worth a separate measurement pass.
- Tier 3 handler queue prioritization — which 3 handlers ship first?
  Recommend by frequency of operator vague-complaint domains (SEO
  already done · customer lookup · inventory · open work orders are
  the next 3).

---

**Reconciled at v10.0.490** · 2026-05-12 · ADR shipped alongside the
Tier 1 commit so the diagnosis + plan are durable before context
rotates.
