# Voice Agent Evaluation Rubric · v1.1 (2026-10-18)

**Used by:** `apps/nickstire/server/cron/jobs/vapiCallEval.ts` (daily eval cron)
**Skill port:** PORT 10 · agent-evaluation + llm-evaluation framework
**Storage:** `vapi_call_logs.eval_score / eval_outcome / eval_reasoning / eval_at`

## Changelog

- **Scorer `vapi-quality-v2` (2026-10-18)** · Nour approved walk-in credit in the call score. An explicit
  walk-in invitation by the agent now fills the existing +20 next-step credit when nothing else already did;
  it is never added twice. Address and hours stay measured fields and do not move the score. The daily
  "degraded" alert compares only rows scored with the same version. No other weight changed, and outcomes,
  dispositions and the recovery queue are unchanged. Rubric tables below are unchanged.
- **v1.1 (2026-10-18)** · Conversion progression now credits a walk-in invitation that carries the shop's
  address and hours, because the shop is first come, first served with walk-ins and no held slots, so booking
  is not the only next step the shop can honour. The 20/15/10/5/0 ladder is copied from v1.0, not re-tuned.
  Two measured fields are added (below). The "How the cron uses this" section is corrected: the cron does not
  call an LLM with this rubric.
- **v1.0 (2026-05-26)** · five dimensions, 20 points each. Text kept below under "Conversion progression, v1.0".

## Implementation status (read this before trusting a table)

The five-dimension tables below are the **target design**. The daily cron does not score them. It runs the
deterministic classifier (`services/vapiCallClassifier.ts`) and the additive `vapi-quality-v2` scorer
(`services/vapiMeasurement.ts`), and writes `eval_score` from those. What v1.1 adds in code is the walk-in
measurement: `services/vapiWalkInCoverage.ts`.

**Walk-in credit in the score (`vapi-quality-v2`, 2026-10-18).** The cron computes the walk-in fields once,
before scoring. When the agent explicitly invited the caller in (`walk_in=true`), the scorer's one next-step
credit (+20) applies if nothing else already earned it (a lead, callback or booking row, a tool call, a
transfer, the caller's own walk-in or callback words, or an answered hours question). The evidence list then
says `agent_walk_in_invitation`. `walk_in=false` and UNMEASURED give no credit and no penalty; `addr_hours`
does not affect the score. The additive scorer has one next-step bucket, so the 15/10/5 bands and the
"WITH the shop's address and hours" condition on the 20 band below stay target design: the agent almost never
says the address or hours, and a credit that required them would never fire.

- Calibration (2026-10-18, read-only, counts only, 600 archived calls): about three calls in ten carry an
  agent invitation; about 130 of those had no other next step, so the average score of scored calls rises by
  roughly 4 points. Nour accepted that move.
- The daily "degraded" alert compares today's average only with rows whose `eval_reasoning` carries the same
  `quality_version`. Historical rows are not re-scored, and the baseline only reads calls older than the
  5-day evaluation window, so the degraded test stays off until 20 such calls carry `vapi-quality-v2` (about
  the first five days after deploy at roughly 30 scored calls a day); the other alert conditions are unchanged.
- The admin voice scorecard averages the window it is asked for; its `quality.version` reports the one version
  behind that average, or `mixed` when the window spans the change.
- Detector accuracy limits (below) are unchanged and now reach the score.

**Limit.** The evaluator classifies from the provider's top-level transcript only. A call whose speech exists
only in the artifact would read as abandoned, score null, and stay UNMEASURED for the walk-in fields. Measured
2026-10-19, read-only, counts only, over the 2,360 newest evaluated inbound calls longer than 5 s (11 weeks):
0 such calls. Widening the evaluator's input is a separate decision because it would move scores, outcomes
and the recovery queue. The walk-in detector itself shares its transcript and messages resolver with the
archive and prefers role-tagged messages when present; it claims nothing more.

### Walk-in measurement (implemented)

Two fields, each `true`, `false` or UNMEASURED. They are written as a suffix on `eval_reasoning`:
` · walk_in=<true|false|unmeasured> · addr_hours=<true|false|unmeasured>`.

| Field | `true` when | `false` when | UNMEASURED when |
|---|---|---|---|
| `walk_in` | an assistant turn after the opening line invites the caller in (walk-ins, come by, swing by, stop in, head over, first come first served, no appointment needed). "Pull up", "come up" and "come down" are not invitations: "let me pull up your info" is a lookup | the agent spoke past the opening line and did not | the transcript has no speaker labels, the agent said nothing past its opening line, or the call has no quality score (not a customer conversation, or a technical failure) |
| `addr_hours` | assistant turns after the opening line name the street (the street name from the business facts; the house number is optional) AND state hours: an open-to-close pair, or a cue word (open, close, till, until) followed by one of the shop's open or close times, so a close-only phrase such as "we close at six" counts | the agent spoke past the opening line and gave one or neither | same as above |

- The address and hours the check looks for come from `shared/business.ts` at run time. The rubric holds no
  copy of them; change the business facts and the criteria move with them.
- Only assistant speech counts, and the opening line is skipped: the greeting names the shop and can name its
  address, so counting it would mark every call as "gave the address".
- A row written before v1.1, or a field that is missing or malformed, reads back as UNMEASURED. It is never
  read as `false`.
- The check records what was said. It does not judge accuracy. Nothing compares stated hours with the business
  hours today: the Compliance dimension is a target design and the voice claim guard does not check hours, so a
  wrong hours claim gives no signal. That check is a separate job.
- Shortcut: the street is matched by the first word of the street name in the business facts, so a spelled-out
  or missing house number no longer matters, and a street written with a leading direction letter would match
  on that letter.
- Accuracy: the check is regex-based and approximate. A negation is caught where it governs a walk-in term,
  before it ("we do not take walk-ins": a negator within two words, no comma between) or after it with a
  refusal word ("walk-ins are not accepted", "walk-ins aren't available", "walk-in service is unavailable").
  "Walk-ins are not a problem" and "walk-ins are available any day" stay invitations. Unusual
  phrasing such as "just show up" or "bring it in" is missed. A time followed by a count word ("six days",
  "six hours") is not read as hours. Read it as a signal, not a verdict.
- Measured on 600 recent archived calls (2026-10-18): the agent invited the caller in about three calls in ten;
  the house number was never spoken; the street name in about one call in six; hours in about one call in ten.

## Purpose

Replace the ad-hoc "score this call 0-100" prompt with a structured
multi-dimensional rubric. Three benefits:

1. **Consistency** · same call scored similarly across runs (the LLM has
   explicit criteria to anchor on)
2. **Diagnosability** · "low quality" decomposes into "polite but didn't
   capture intent" vs "captured intent but didn't book" — actionable
3. **Trend detection** · per-dimension scoring lets the operator see
   "intent-capture trended down 18% after the model swap" instead of
   "overall quality dropped"

## Rubric · 5 dimensions × 20 points = 100 total

### 1. Intent capture (0-20)

> Did the agent correctly identify what the caller wants?

| Score | Criteria |
|---|---|
| 20 | Captured PRIMARY intent (service, tire size, urgency) in first 30s + confirmed back to caller |
| 15 | Captured primary intent within 60s OR captured but didn't confirm back |
| 10 | Captured intent only after caller repeated themselves |
| 5 | Captured only the broad category (e.g. "tires") not the specifics |
| 0 | Misidentified intent OR never confirmed what caller wanted |

### 2. Tool usage (0-20)

> Did the agent use the right tools at the right time?

| Score | Criteria |
|---|---|
| 20 | Used 2+ tools correctly · result fed back to caller naturally |
| 15 | Used 1 tool correctly · result used in response |
| 10 | Attempted tool use · partially correct |
| 5 | Should have used a tool but didn't · or used wrong tool |
| 0 | Never used a tool when caller's request required one (e.g. booking inquiry → no `bookSlot` call) |

### 3. Brand voice (0-20)

> Did the agent sound like Nick's Tire & Auto (Caregiver + Everyman) OR did it sound generic?

| Score | Criteria |
|---|---|
| 20 | Sounded like a neighborhood shop · used concrete proof points · no corporate-AI phrases |
| 15 | Mostly on-brand · 1-2 minor brand-voice violations |
| 10 | Generic helpful-AI tone · neutral but not Nick-flavored |
| 5 | Multiple brand-voice violations ("trusted", "experts", "quality") |
| 0 | Sounded corporate / chatbot · clear archetype invasion (Hero/Sage/Ruler tone) |

### 4. Conversion progression (0-20) · v1.1

> Did the agent move the caller toward a next step the shop can honour? Booking is not required: the shop is
> first come, first served, walk-ins welcome every day, no held slots.

| Score | Criteria |
|---|---|
| 20 | Booked a slot OR captured a callback request OR sent confirmation SMS OR gave an explicit walk-in invitation WITH the shop's address and hours |
| 15 | Offered next step + caller agreed but no booking yet (e.g. "I'll think about it, call me back") · OR invited the caller to walk in but gave only one of address or hours |
| 10 | Offered next step but caller deferred / declined (a declined walk-in invitation counts here) |
| 5 | Provided info but didn't suggest a next step (address or hours given with no invitation to come in counts here) |
| 0 | Caller hung up frustrated · OR agent escalated to human without trying |

The 20/15/10/5/0 ladder is copied from v1.0. Only the walk-in clauses are new; no band was re-tuned. A walk-in
invitation must not promise a wait time, a held slot or a service time (see Compliance below). The address and
hours are read from `shared/business.ts`, never copied into a prompt or this table. In code, `vapi-quality-v2`
follows the invitation alone (see Implementation status); these bands stay target design.

<details>
<summary>Conversion progression, v1.0 (2026-05-26), kept for history</summary>

| Score | Criteria |
|---|---|
| 20 | Booked a slot OR captured a callback request OR sent confirmation SMS |
| 15 | Offered next step + caller agreed but no booking yet (e.g. "I'll think about it, call me back") |
| 10 | Offered next step but caller deferred / declined |
| 5 | Provided info but didn't suggest a next step |
| 0 | Caller hung up frustrated · OR agent escalated to human without trying |

</details>

### 5. Compliance + safety (0-20)

> Did the agent avoid lying, fabricating, or risky promises?

| Score | Criteria |
|---|---|
| 20 | Never fabricated a price · never promised a time slot without `bookSlot` · followed FCFS messaging |
| 15 | One minor compliance miss (e.g. quoted approximate price without "starts at") |
| 10 | One real compliance miss · would have caused a customer-confusion ticket |
| 5 | Promised specific time slot without booking · OR fabricated a price |
| 0 | Lied to caller (e.g. "we have those tires in stock" when we don't) · OR gave dangerous advice |

## Total → eval_outcome bucket

| Total | Bucket | Interpretation |
|---|---|---|
| 85-100 | **exemplary** | Use as a training example · share with team |
| 70-84 | **converted** | Hit the bar · counts as a win |
| 50-69 | **info_only** | Caller learned something but didn't progress |
| 0-49 | **wasted** | Time spent · no measurable value |

## Operator dashboard mapping

The `/voice` page in admin should surface a per-dimension breakdown,
NOT just `eval_score`. Currently it shows the score · should show a
5-bar mini-chart per call so the operator can spot pattern weaknesses
("tool usage always low in calls from Verizon area code 234 — webhook
race condition?").

## Anti-patterns to NEVER score above the bucket floor

- **Sycophancy without booking** · "Oh that's a great question! Tell me
  more!" runs 8 minutes with no booking → wasted, score ≤ 49
- **Apology spiral** · agent apologizes 3+ times in 60s · brand-voice
  violation, max score 60
- **Tool-call hallucination** · agent SAYS "I've booked you for Tuesday"
  but no `bookSlot` tool fire visible in transcript → automatic ≤ 30
  + flag for human review (this is the #285 silent-tool-discard pattern)

## How the cron uses this

Corrected in v1.1. v1.0 said the cron passed this rubric and the transcript to an LLM and computed the total
from five returned dimensions. The code does not do that. `vapiCallEval.ts` loads each unevaluated call, runs the
walk-in detector once, then the deterministic `classifyCall` and `scoreVapiQuality` (`vapi-quality-v2`, with
the walk-in invitation as an input), and writes `eval_score`, `eval_outcome` and `eval_reasoning` from them,
then appends the walk-in suffix described above (the same value the score used). Scoring by the five
dimensions remains a design target, not behaviour.

## Future extensions

- Calibration runs · pick 10 known-good + 10 known-bad calls, ask LLM
  to score them, measure variance across runs. High variance = rubric
  ambiguity, refine criteria.
- Cross-judge agreement · run rubric through 2 different models, flag
  calls where they disagree by >15 points · those are usually edge
  cases worth human review.
- Per-dimension threshold alerts · "if avg `tool_usage` score < 12
  for 24h, alert operator" · catches model-swap regressions.
