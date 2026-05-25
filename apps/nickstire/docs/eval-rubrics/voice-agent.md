# Voice Agent Evaluation Rubric · v1.0 (2026-05-26)

**Used by:** `apps/nickstire/server/cron/jobs/vapiCallEval.ts` (daily eval cron)
**Skill port:** PORT 10 · agent-evaluation + llm-evaluation framework
**Storage:** `vapi_call_logs.eval_score / eval_outcome / eval_reasoning / eval_at`

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

### 4. Conversion progression (0-20)

> Did the agent move the caller toward a desired action?

| Score | Criteria |
|---|---|
| 20 | Booked a slot OR captured a callback request OR sent confirmation SMS |
| 15 | Offered next step + caller agreed but no booking yet (e.g. "I'll think about it, call me back") |
| 10 | Offered next step but caller deferred / declined |
| 5 | Provided info but didn't suggest a next step |
| 0 | Caller hung up frustrated · OR agent escalated to human without trying |

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

`vapiCallEval.ts` daily cron loads each unevaluated call's transcript,
passes this rubric + transcript to the LLM, requests structured JSON
output of the 5 dimensions + a 1-paragraph `eval_reasoning`. Total is
computed server-side from the dimensions (don't trust the LLM's math).

## Future extensions

- Calibration runs · pick 10 known-good + 10 known-bad calls, ask LLM
  to score them, measure variance across runs. High variance = rubric
  ambiguity, refine criteria.
- Cross-judge agreement · run rubric through 2 different models, flag
  calls where they disagree by >15 points · those are usually edge
  cases worth human review.
- Per-dimension threshold alerts · "if avg `tool_usage` score < 12
  for 24h, alert operator" · catches model-swap regressions.
