# Voice → Recovery → Revenue · independent audit and repair · 2026-09-18

**The 1,118-row "Missed Revenue Queue" was substantially a census of calls that were
ANSWERED, not a backlog of lost demand.** The classifier scored `transcript + aiSummary`,
which contains Nick's own turns, and two tokens in his greeting were load-bearing:

| Assistant-only text | Matched | Outcome | Queue candidate? |
|---|---|---|---|
| `"17625 Euclid Ave"` | `euclid` in `inferredWalkIn` | `walk_in_directed` | yes |
| `"Nick's Tire & Auto"` | `auto` in the fallback | `lost_opportunity` | yes |

Nick's greeting necessarily contains one or the other. So a call where the caller never
spoke a word produced a queue row — and so did a caller who only asked what time the shop
closes. The queue could not emit "no demand" for the exact case it existed to detect. That
is a silent instrument, and it was manufacturing its own backlog.

Measured against the real function before the fix (`server/services/vapiCallClassifier.ts`):

```
greeting w/ address + brand  -> walk_in_directed    (queue)
brand only                   -> lost_opportunity    (queue)
address only                 -> walk_in_directed    (queue)
bare "Auto"                  -> lost_opportunity    (queue)
neither                      -> unknown             (not queued)
```

After the fix all five return `abandoned_before_connect`, which is not a queue candidate.

**Neither prior audit found this.** Audit A concluded "there is no exclusion in this query
for no-speech calls" — true but downstream; the rows were being *created* upstream by
misclassification. Audit B observed no-speech rows in the UI and could not explain them.

---

## 1 · Corrections to the two prior audits

| Prior claim | Verdict | What is actually true |
|---|---|---|
| "1,118 pending = untouched viable leads" | **Both audits correct to doubt it; both understated why** | Not merely padded by `walk_in_directed`. A large share was manufactured by the classifier reading the assistant's greeting. |
| "SMS varies by only 2 templates (tire vs non-tire)" — Audit B | **Refuted** | There are 8 intent branches in `getSmsDraft`. |
| "Templates are intent-specific but context-poor" — Audit A | **Confirmed** | Zero interpolation; every string a constant. |
| "`before 6 PM today` is wrong on Sundays" | **Confirmed** | `BUSINESS.hours.structured.sunday` is `09:00-16:00`. |
| "`transferOutcomeEvidence.ts` is in `server/services/`" — Audit A | **Wrong path** | It is `server/lib/transferOutcomeEvidence.ts`. Substance of the claim was right. |
| "(440) 444-2383 is the manager transfer number" — Audit B | **Unverifiable from code** | The string does not appear anywhere in the repository. It exists only in live Vapi config. |
| "Repeat Caller (+3) over-triggers" | **Confirmed** | `phoneCounts[phone] > 1` across the entire 90-day population. |
| "Three assistants, two duplicates" — Audit B | **Refuted** | Inbound and outbound are intentionally separate (`VAPI_RECEPTIONIST_ASSISTANT_ID` / `VAPI_FOLLOWUP_ASSISTANT_ID`). Do not delete either. |
| "The outcome list is duplicated" | **Both understated it** | **Ten copies across seven non-identical sets**, with two live contradictions (below). |
| "Transfer failure is the dominant root cause" — Audit A's prior | **Not supported, and not measurable today** | See §3. |

### Two live contradictions neither audit found

1. **`walk_in_directed` is simultaneously SUCCESS and MISSED REVENUE.**
   `promptEvolution.ts:125` lists it in `SUCCESS_OUTCOMES`; `vapi.ts:298` counts it as
   ACTIONABLE; `vapiCallEval.ts:248` and `vapi.ts:500` bill it as a recovery obligation. A
   caller who said "I'll come by" was scored as a win and as lost money at the same time.

2. **`tech_failure` is simultaneously NOT-A-CONVERSATION and AN OBLIGATION.**
   `vapi.ts:287` excludes it from quality scoring and from every "qualified" denominator;
   the same dashboard puts it in the operator's work queue.

---

## 2 · External evidence

Graded. Vendor claims are marked as such; three widely-repeated statistics did not survive.

| Claim | Verdict | Source |
|---|---|---|
| `assistant-forwarded-call` proves the destination ANSWERED | **Refuted — proves initiation only** | Vapi docs: "confirms that Vapi initiated the transfer. It does not confirm that the downstream telephony provider completed it." Troubleshooting has a row for "reason present, destination never rings." |
| A real answer signal exists | **Yes — `call.artifact.transfers[].status`** | Enum: `connected · no-answer · busy · voicemail · failed · completed · cancelled`, documented for warm **and blind**. Gated on org-level outcome detection — verify empirically before relying on it. |
| Vapi supports native simultaneous/sequential ring | **Refuted** | Multiple `destinations` are choices for the model, not a ring list. No `ringAll`/hunt-group field exists. `fallbackPlan` speaks a message and optionally ends the call; it does not dial a second number. |
| Configurable ring timeout on the default path | **Refuted** | `dialTimeout` applies only when `sipVerb: "dial"`; default is SIP `refer`, where Vapi has already left the call. |
| Warm transfer that verifies a HUMAN answered | **Exists, labelled experimental** | `warm-transfer-experimental` with `transferSuccessful` / `transferCancel`. |
| No-answer / voicemail detection is impossible inside Vapi | **Refuted — both prior audits assumed this** | `warm-transfer-experimental` + the always-available `transferCancel` tool + `fallbackPlan` **does** detect voicemail, busy, IVR and no-answer and returns the caller to the assistant. The real trade-off is depending on a mode Vapi labels *Experimental* — not building custom Twilio orchestration. This materially reorders the roadmap: see §9 P3. |
| A ring-timeout exists on the default transfer path | **Refuted** | `maxDurationSeconds` (default 120s) bounds the *transfer-assistant leg*, not destination ring time. No ring timer is documented for blind transfer. |
| Multiple `destinations` on a transfer tool give failover | **Refuted** | "it does not call every destination in the array" — the model selects ONE by description. Not a ring strategy. |
| Vapi assistant/tool versioning + rollback | **Exists** | Assistants and tools both version; an assistant restore publishes immediately, a tool restore only loads a draft. Version pinning does not work with a transient inline assistant. |
| Webhook idempotency guarantee | **None documented** | No delivery id, no retry policy. Dedupe on `call.id` yourself. |
| FCC treats AI voices as "artificial or prerecorded" | **Verified** | FCC 24-17, adopted 2026-02-02, docket CG 23-362 (not 02-278). |
| Informational reply to an inbound caller vs promotional | **Materially different consent tiers** | 47 CFR 64.1200(a)(1) vs (a)(2). Adding an offer changes the tier. |
| One-to-one consent rule | **Vacated and removed** | 11th Cir. 2026-01-24; FCC conformed the CFR 2026-08-29. |
| Opt-out requires the literal word STOP | **Refuted** | 64.1200(a)(10): "any reasonable method", honored within 10 business days. |
| 8am–9pm quiet hours clearly cover texts | **Contested** | EIA petition (DA 25-216) unresolved; 7th Cir. *Steidinger* (2026-07-14) held texts are not "calls" under §227(c)(5). Cleveland is in the 6th Circuit, which has ruled on neither. Keep the 8–8 window regardless. |
| "Respond in 5 minutes → 8x conversion" | **Refuted as stated** | Original located and read. The real figures are **100× (contacting)** and **21× (qualifying)** at 5 vs 30 minutes, and the study says in terms: *"This study did not address close ratios."* So the common "8x conversion" is wrong on both the multiplier and the outcome measured. Funded by InsideSales.com, which sells the remedy; the population is **outbound calls to web-form leads** — the opposite motion from an inbound caller to a tire shop. No independent 2023-2026 replication found. |
| "78% buy from the first responder" | **Unsourced** | No traceable study in any year. |
| "Up to 85% of callers who don't reach a human never call back" | **Unsourced** | Six vendors citing each other; no study. |
| Text is the preferred service-update channel | **Secondary-sourced only — do not cite as primary** | One research pass reached J.D. Power's 2025 ASI figure via trade press and found the 56% covers tire replacement **and quick oil change customers combined**, not tire customers alone. A second, independent pass could not retrieve it at all (jdpower.com returned 403). Directionally useful, **unciteable** until someone puts the actual release in front of you. |
| Price-shopper close rate ~8.3% vs ~44% overall | **Published, vendor-origin** | 3,144 opportunities, 40 stores; author consults for a firm selling sales training. No methodology disclosed. |
| Missed-call text-back conversion lift | **No credible independent evidence exists** | Every trail ends at a vendor. Treat any lift number as an assumption to be measured, not cited. |

**Consequence for this shop:** do not quote a monthly dollar figure built on any of the
last five rows. The `$6–15k/mo` figure in the dashboard's own copy has no located source.

---

## 2b · Ohio repair law — verified against the primary rule text

A supplied report urged encoding "Ohio's repair rule changed 2026-03-21; estimates over $50; 10%
re-authorization" as software. The rule is real and the 10% test is real, but **four of the five
framing claims are wrong**, and each would have produced a defective guard. Source throughout:
[OAC 109:4-3-13](https://codes.ohio.gov/ohio-administrative-code/rule-109:4-3-13), full text
retrieved and diffed against the archived 2015 version.

| Claim | Verdict | What the rule actually says |
|---|---|---|
| "The rule changed 2026-03-21" | **Technically true, materially false** | The date is real; the amendment is **purely editorial** — "his" → "the consumer's" in four places. Zero substantive change. **The 10% obligation has been in force since at least 2015; the rule dates to 1978.** Presenting it as a new duty to adapt to would misdirect whoever schedules the work. |
| "Estimates required over $50" | **Incomplete, and wrong for this channel** | The $50 floor governs **paragraph (A) only** — face-to-face, at the shop, during posted hours. **A phone call is the no-face-to-face path, governed by (B), which has NO dollar floor at all.** (B)(2) requires informing the consumer of the right to an estimate "upon the first contact". A guard keyed on `cost > 50` **under-triggers on precisely the channel Nick operates in.** |
| "10% or more of the original estimate" | **Verified verbatim — with four parameters, not one** | (C)(2): "ten per cent **or more** (excluding tax) of the original estimate", and **only where an estimate was requested**. So: `>=` not `>`; excluding tax; against the original estimate; gated on an estimate having been requested. A customer who chose "no estimate" falls under (C)(3) instead, whose trigger is a $50 running total. |
| "Record-retention requirements" | **Refuted — none exist** | No retention period appears in 109:4-3-13, or anywhere in Chapter 109:4-3 (all 31 rules enumerated). The "two years" in circulation is **ORC 1345.10(C)'s statute of limitations** — a different thing. Logging oral authorizations is sound defensive practice; the rule does not command it, and a comment claiming it does would be false. |
| — | **Trap neither report flagged** | **(J) expressly disapplies 109:4-3-05 to motor vehicles.** That general rule uses **$25** and "$5 or 10%, whichever is greater". The Ohio AG's own business guide blurs the two. Importing those numbers would be wrong. |

**Also corrected, same pass:** "NHTSA says replace tires at 6–10 years" is a **misattribution to a
regulator** — NHTSA's words are "*Some vehicle and tire manufacturers recommend*…"; it sets no
interval. The AWD drivetrain-damage warning rests on a single Subaru bulletin **scoped to the 2015
WRX STI**, about a warning light — not a general law of AWD, and the per-brand tread tolerance
tables in circulation are unsourced retailer marketing. Google's anti-review-gating rule is real
and current but **was live by June 2024 and traces to 2018** — the "April 2026" date is wrong.

None of this is encoded yet. It is recorded here so the guard, when written, is written against the
rule rather than against a summary of it.

## 3 · Is transfer failure the dominant root cause?

**Unknown, and not measurable with today's instrumentation — which is itself the finding.**

`transferOutcomeEvidence.ts` is honest about this: it measures redial behaviour, not
connection, and returns `quiet` ("may have been helped, or may have given up") rather than
claiming success. That is the right epistemics. But it means:

- Any metric built on `assistant-forwarded-call` counts **dial attempts**, not handoffs. A
  call that rang an empty counter eight times and hit voicemail scores identically to one
  Nick picked up.
- The ground truth is `call.artifact.transfers[].status` from the `end-of-call-report`
  webhook, or the provider's own call record for the child leg. Neither is being read.

Until one of those is wired, "transfer failure is the biggest leak" and "transfers are
fine" are equally unsupported. **Measure before re-architecting the transfer path.**

---

## 4 · What shipped in this pass

Four commits on `claude/nicks-tire-audit-1e7439`. No migration — everything rides the
existing `metadata` JSON column, which is deliberate (the ROS-059 lesson: no hand-applied
DDL to forget).

| Commit | Change |
|---|---|
| `b212ccce5` | **Speaker attribution.** Demand may only be inferred from customer speech; assistant speech may only ever *remove* a call from the queue. Prefers Vapi role-tagged `artifact.messages`, falls back to prefix parsing, and reports `speakerAttribution` so coverage is measurable. Unattributable transcripts yield `unknown`, not a fabricated `lost_opportunity`. |
| `3a1c28422` | **`shared/callTaxonomy.ts`** — one kernel replacing ten hand-maintained lists, resolving both contradictions. **`recoveryQueue.ts`** collapses calls into episodes: one customer with one need is one row. `RECOVERY_FETCH_OUTCOMES` is derived from the kernel so the SQL filter cannot drift from the decision. |
| `47cd632ee` | **`callDemandExtraction.ts`** — deterministic tire size / quantity / condition / vehicle / urgency from the caller's turns, handling the spoken forms ("two fifteen sixty seventeen"). **`smsFactCompiler.ts`** — states only observed facts, canonical shop facts and asks. Fixes the fifth copy of the shop hours in `afterHours.ts`. |
| `51a9c01cc` | Replaces the eight hardcoded SMS templates in the admin UI with the compiler, so the operator's preview is the exact string the server would send. |

**Receipts:** 140 tests across 6 new suites; 94 downstream voice-consumer tests; 49
adjacent admin/metrics tests; typecheck exit 0; all six pre-commit gates green on every
commit.

### The reuse finding that shaped this

`extractCustomerTurns` already existed, fully tested, and its own header diagnosed this
exact contamination on 2026-07-26 — *"`aiSummary` is written BY a tire-first assistant, so
keyword-counting it measures the assistant's vocabulary"* — and documented `firstSubstantive`
as "the field demand classification should read." It was wired into the webhook **recorder**
and never into the **decider**. `metadata.customerSpeech` has been written since then and
read by nothing. That is BUILT-UNWIRED, the pattern this repo has already named and paid for
three times. The fix was wiring, not building.

### What was deliberately NOT built

There are already **two** missed-call systems over `vapi_call_logs`. `revenue_opportunities`
is live, cron-wired, dedupes on `(source_type, source_id)`, has a state machine and a guarded
send path through the `sendSms` chokepoint. The `vapi.ts` queue is a clipboard dead-end. A
third queue was not built. The long-term move is to retire the dead-end and fold voice
evidence into `revenue_opportunities` — that is P2, and it is a decision, not a refactor.

---

## 5 · Verification checklist — BEFORE anyone clicks "Reset to Shop"

None of this could be verified from the repository. `(440) 444-2383` does not appear in the
codebase at all.

1. Open the Vapi console. Record, for the **inbound receptionist**: assistant id, name,
   the phone number bound to it, transfer tool id and version, destination number,
   `transferPlan.mode`, and `sipVerb`.
2. Record the same, independently, for the **outbound follow-up caller**.
3. Confirm which of the two the "Follow-Up Caller Transfer / OFF SHOP NUMBER" card belongs
   to. Audit A is right that it is the **outbound** assistant — resetting it may fix nothing
   about inbound caller transfers.
4. Determine where `(440) 444-2383` exists, if anywhere, and confirm that person knows they
   are the transfer destination.
5. Snapshot the current assistant JSON before changing anything.
6. Place a test call. Let the transfer ring out unanswered. Read
   `call.artifact.transfers[0].status` on the resulting `end-of-call-report`. **If that field
   is absent, blind-transfer outcome detection is not enabled for this org** and no
   connection metric is possible without a provider-side callback.
7. Repeat for: answered, busy, voicemail, declined, after-hours.
8. Confirm the local DB captured each `endedReason` correctly.
9. Only then change routing.

Also verify, independently of the above:

10. **Counter answer rate before a call ever reaches Nick.** Audit B is right that this is
    the largest unmeasured quantity in the system, and nothing in this codebase can see it.
    Pull the ring strategy from the carrier or Vapi.
11. **Production `SMS_CONSENT_GATE`.** It defaults to shadow. `smsOps` exposes
    `consentGateShadowMisses`; that count is the input to the arming decision.

---

## 6 · KPI definitions — every ratio gets its denominator

| KPI | Numerator / denominator | Note |
|---|---|---|
| Human answer rate | answered by staff ÷ total inbound | **Unmeasured today.** Priority #1. |
| AI containment | resolved without transfer, no same-intent repeat in 24h ÷ AI-handled | Repeat check is what makes it honest. |
| Attributable-speech rate | calls with `speakerAttribution ≠ "unavailable"` ÷ all calls | New. Drive toward 100%; it is the trust floor for every rate below. |
| Qualified demand | recovery-lane episodes ÷ episodes excluding spam / no-speech / unattributable | **Episodes, not calls.** |
| Transfer attempted | transfer attempts ÷ qualified calls | Countable today. |
| Transfer **connected** | `transfers[].status === "connected"` ÷ attempts | **Not countable today.** Never derive from `assistant-forwarded-call`. |
| Callback SLA attainment | contacted within lane SLA ÷ obligations in that lane | SLAs are Nick's operating targets, not benchmarks. |
| SMS states | queued / accepted / uncertain / delivered / failed, tracked separately | Never render "delivered" when you only know "accepted". |
| Expected-arrival rate | arrived ÷ expected arrivals | This is what makes `walk_in_directed` measurable rather than assumed. |
| Revenue | **linked** vs **recovered** vs **incremental**, always labelled separately | Only the third requires a control, and only the third justifies a spend claim. |

**Version-migration rule:** tag every card with its evaluation coverage ("X of Y scored").
A 0% on 100% coverage is a signal; a 0% on 0% coverage is a pipeline gap. They must never
render identically. `VoiceBrief.tsx`'s "Awaiting v1 evaluations" state is the correct
pattern — extend it.

---

## 7 · Economics — the formula, not a number

```
incremental gross profit
  = N × (R − B) × A × G

N = genuine unresolved qualified episodes per month   (measure after the taxonomy fix)
B = baseline conversion with no recovery              (measure — needs a holdout)
R = conversion with recovery
A = average paid invoice for those cases              (Nick's data)
G = gross margin                                      (Nick's data)
```

Three of five inputs are unknown to this audit and two are unknowable without a control
group. **Do not publish a monthly figure until N is measured post-fix and Nick supplies A
and G.** The `$6–15k/mo` in the current UI copy should be removed, not restated.

---

## 8 · Decision log

**KNOWN (verified against code or primary sources in this session)**
- The classifier scored assistant speech as customer demand; proven by execution against the real function, and now fixed.
- The outcome list existed in ten copies across seven non-identical sets.
- `walk_in_directed` and `tech_failure` each had contradictory treatment.
- `getSmsDraft` had 8 branches, zero interpolation, no opt-out, four unverifiable claims, and a hardcoded closing hour false on Sundays.
- `afterHours.ts` held a fifth copy of the shop hours.
- `(440) 444-2383` does not appear in the repository.
- `assistant-forwarded-call` does not prove the destination answered.
- No structured tire size, vehicle, quantity or condition was extracted anywhere before this pass.

**INFERRED (strongly supported, not directly observed)**
- A large share of the 1,118 was manufactured by the misclassification. The mechanism is proven; the exact proportion requires a production query.
- Production Vapi transcripts are speaker-prefixed or role-tagged. `customerTurns.ts` and the webhook both assume it; if false, `speakerAttribution: "unavailable"` will spike — which is why that field is now reported rather than silently defaulted.

**UNKNOWN (must be measured)**
- Counter answer rate before AI pickup. The largest hole in all three audits.
- True transfer connection rate.
- Whether `artifact.transfers[].status` is populated for this org.
- Live `SMS_CONSENT_GATE` value and shadow-miss count.
- N, B, A and G in the economics model.

**DISPROVEN**
- "Only 2 SMS templates." "Three assistants, two duplicates." "`assistant-forwarded-call` means connected." "Vapi supports sequential ring natively." "The 5-minute rule is established, independently replicated evidence."

**What would change the recommendation**
- If a production query shows most recovery-lane episodes are verified transfer failures, transfer work becomes the first engineering target.
- If `artifact.transfers[].status` is populated, a real connection metric is a day of work and should precede any warm-transfer migration.
- If attributable-speech rate is low, transcript format is the bottleneck and everything downstream is provisional.

---

## 9 · Order of work — not a calendar

**This section used to be a 7/30/90-day roadmap. That was wrong twice over.**

It was wrong as policy: the standing instruction on this repo is to finish the
work in-session, not to hand back a schedule for work the agent can do now.
And it was wrong in substance — filing "reconcile the two transfer instruments"
under thirty days is how a *finding* becomes a *calendar entry*, and the
instruments then sat in two different procedures for a month with nobody able
to compute their disagreement.

What follows is the state of every item, in three honest buckets.

### Done, merged, and verifiable on `main`

| Item | Where |
|---|---|
| Classifier reads CUSTOMER speech only; one taxonomy kernel decides queue membership | #2444 |
| Episode collapse — one customer, one need, one row | #2444 |
| Fact-bound SMS compiler replacing eight asserting templates | #2444 |
| Transfer outcome read from `artifact.transfers[].status` | #2448 |
| Tire-safety claim guard, each boundary sourced to a primary document | #2451 |
| Four UI labels that were claims | #2451 |
| Attribution dedupe — an invoice can be paid once, so it is claimed once | #2453 |
| Repair-intake guard — no part named, no safe-to-drive verdict, over a phone | #2455 |
| Gamification demoted below live demand | #2457 |
| Scorecard no longer defaults to the one window it can never fill | #2460 |
| `LOOKBACK_DAYS` widened so a skipped tick cannot orphan a call forever | #2460 |
| Assistant resolution is deterministic, and ambiguity announces itself | #2462 |
| The panel says whether a config push reaches the line callers dial | #2462 |
| The redundant assistant is unreachable from this codebase | #2464 |
| Outbound pin health readable without dumping the environment | #2465, #2466 |
| **The two transfer instruments are compared, and a contradiction states what it implies** | this pass |
| **Attribution confidence bands, with the calibration caveat that must travel with them** | this pass |

### Open, and buildable without anyone's permission

Listed in the order they should be done, with why — no dates attached, because
a date is not a dependency.

1. **Retire the dead-end queue into `revenue_opportunities`.** The voice queue
   is a second opportunity store that dedupes separately and has no guarded
   send path. `revenue_opportunities` already has both. This is the largest
   remaining structural item and the one most likely to cause the *next*
   double-count, because two stores of the same thing is the shape that
   produced the last one.
2. **Recovery holdout.** Every revenue number here is *linked*, not
   *incremental* — it says this call preceded this invoice, never that the
   recovery caused it. A holdout is the only way to tell those apart, and
   without it the programme's headline number is an association.
3. **Seasonal routing priority.** The smallest of the three and the only one
   that is purely an optimisation rather than a correction.

### Blocked on a human, and that is the correct state

Not deferred — *blocked*. Each needs a decision or an action an agent should
not take alone.

- **Approval-first bulk SMS send.** Customer contact. The drafting and review
  path can be built; pressing send is the operator's, every time.
- **`sipVerb` refer→dial, and the warm-transfer canary.** Live VAPI config.
  These are now **decidable by measurement rather than taste** — the agreement
  instrument says whether they would help at all. If it reports a counter
  problem, they would not, and doing them anyway spends on the wrong half of
  the call.
- **Three production readings** nobody has taken: the classification count once
  the eval cron has run, transfer coverage once the account carries
  `artifact.transfers`, and the counter answer rate before AI pickup.

### Still do not build

A third opportunity queue. An ML lead score before outcomes are clean.
Multi-vendor telephony failover. Appointment scheduling for a
first-come-first-served shop. Any auto-send SMS before the approval-first path
has a clean hallucination record.

---

## 10 · Live verification on the deployed page — what the audit could not have learned by reading

Every capability-ledger entry written during this pass carries `liveRuns: NONE`. This
section closes four of them, and it exists because **opening the admin page found more in
ten minutes than re-reading either prior audit would have.**

Loaded `nickstire.org/admin?tab=voiceReceptionist` after the wave deployed.

| Shipped claim | What the live page shows |
|---|---|
| Tab rename | Reads **Needs Attention · 960** |
| Attribution collapse | **"13 same-invoice contact(s) collapsed across 3 invoice(s)… would have overstated attributed revenue by 3.17x"** |
| The collapse works on the cluster it was built from | Invoice **#5160005** — claimed by **eight** separate calls when the defect was found — is now claimed by **exactly one**, call #16260032 |
| Review queue shrank honestly | **20 weak matches → 7**, with the reason stated rather than the rows silently gone |
| Transfer connection measurable | **Forward Redials ≤15m (14d): 24% · 57/240 redialed · 183 quiet · 22 failed hand-offs** |

### The defect the live page found in the attribution path

The review query dedupes by `call_id` and **nothing deduped by `invoice_id`**. Eight calls
each said "this call produced invoice #5160005". Confirming them all would have counted that
invoice eight times.

This matters more than the queue defect at the top of this document. **That one inflated
demand, which wastes attention. This one inflated revenue** — the number the system is judged
by, and the one an operator would quote to justify the whole programme. A recovery tool that
over-reports its own winnings is the failure most likely to survive scrutiny, because nobody
audits a number they like.

Duplicates are **retained and rendered**, not dropped. Those seven other calls are real
contacts from the same customer; they stop being separate decisions about separate money,
they do not stop existing. A payload nobody displays is a row silently removed from the
operator's view — the sin this wave was fixing elsewhere.

### Still open after the live check — P1

The panel reads **AWAITING V1 EVALUATIONS · 0 v1 · 25 legacy excluded**, and all 25 of that
day's calls show outcome `Unknown`. The new classifier has scored none of them; the eval
cron had not processed the day at load time.

This is the **empty-vs-error discipline working**: the panel says *awaiting evaluations* and
shows its denominator instead of rendering a fabricated 0%. But it means **no voice KPI on
that page is trustworthy until the cron has run**, and the first-deploy classification count
— the amber "could not be read well enough to classify" number — is still unread. That
number is the single most important operator reading of this wave, because it says whether
production transcripts carry speaker attribution at all.

## 11 · What this audit got wrong about itself

Recorded because a self-audit that finds nothing is not a self-audit.

1. **A claim in the fix, of the exact kind the fix was removing.** The `VoiceAchievements`
   demotion said, in its source comment, its PR body and its shipped completion evidence,
   that the panel had moved *"to the bottom of the page"*. It had moved below Live Calls and
   stopped — still above the Performance Dashboard and the entire call list. Typecheck,
   lint, 1,434 client tests and the completion-authority gate were all green on a false
   comment. Only loading the page caught it.
2. **A guard that protected only the branches its author had thought of.** The
   `drivability_safety_verdict` pattern guarded two of its three alternatives against a
   preceding conditional and left the third bare, so *"let me know if you can make it here
   before six"* — routine scheduling speech — scored as a safety verdict. Every CLEAN test
   written at the time exercised the two guarded branches. Testing the false positives you
   already thought of is the same as not testing.
3. **A legend that had stopped describing its own list.** The daily voice-claim alert named
   three claim classes from 2026-07-27 while the guard grew to nine. A stale legend does not
   go quiet; it misinforms.
4. **Green gates that proved nothing, three times.** A vitest exit code swallowed by `tail`;
   a `\b` eaten into an invisible backspace byte by a shell heredoc; and
   `(data ?? []) as Array<...>`, a cast that *asserts* rather than checks and hid a live
   render break through every gate in the repo.
