# Defect shapes · a field guide

> **Filename is historical.** This began as one shape (the orphaned subject, 2026-08-22) and
> grew into the taxonomy. The name is kept because `CONTROL-CANARY-COVERAGE.md` and the
> agent-memory index already point at it; renaming breaks both for no gain.

**Status:** four shapes as of 2026-08-23.

---

## The argument, first

Four defect shapes. Four different detection heuristics. **Each heuristic independently scores
its own shape GREEN.** Existence, readership, non-nullness and a clean log are four ways of
asking "is something there?" -- and all four are answered *yes* by a defect that is completely
dead. That is the whole case for why a canary must **assert behaviour, never presence**.

**The shape table lives in
[`CONTROL-CANARY-COVERAGE.md` -> "Four shapes, and the heuristic each one defeats"](CONTROL-CANARY-COVERAGE.md).**
It is canonical there and deliberately NOT repeated here. Both files carried their own copy for
part of 2026-08-23, which is how the next drift starts -- two statements of one idea, diverging
on the first edit. That file is linked from root `AGENTS.md` and is the one a reader reaches
first, so it keeps the summary.

**What THIS file adds, and why it is separate:** the summary tells you a shape exists; it does not
tell you how to find one. Below, per shape: the probe that detects it, the worked example with
receipts, and the traps that defeated the first attempt at each probe. Plus the stated rules and
the recorded decisions, neither of which belongs in a per-control ledger.

## Stated rules

Short enough to remember, each earned by an incident this file records.

1. **Assert behaviour, never presence.** A canary that checks a control exists is defeated by
   all four shapes above. One that breaks the control and asserts the break is detected is not.
2. **A ratio computed inside a filtered population is not a finding about the population.**
   State the base rate beside it, always. This was violated twice on 2026-08-23 alone — by a
   session and by its reviewer — after already having cost a misdirected investigation on
   2026-08-08, when "72% of failed calls are short" turned out to be an 18% base rate and a
   mechanism that one measurement refuted outright. Recent examples: `energyRequired` is 0.00
   bits across the 12-row subtask population and **0.82 bits across all tasks**; `blind_spot` is
   98.3% of the unjudged in-window queue and **75.7%** of all discovery rows ever.
3. **Plant a positive before believing a zero.** "Nothing happened" and "I cannot see" render
   identically until you do.
4. **A real symptom is not a diagnosis.** See the recorded NO below — a genuine incident pointed
   confidently at the wrong root cause, and only measurement separated them.

5. **A rate over time is not a finding about a contiguous window — and a rate over a population
   containing a REPLAY is not a rate about the schedule.** Sibling to rule 2: both are aggregation
   destroying the signal. `ingest-reviews` failed **4 of 4 runs every day for 16 consecutive days**
   (2026-08-04 -> 08-19), a 100% in-window outage. Its lifetime rate is 2.49% (64/2,572) against an
   estate rate of 5.4% counting `failed` only, or 9.23% counting `partial` too -- so **by rate the
   totally-broken job looks better than average.** Worse, the lifetime denominator is dominated by a
   single backfill: 2026-08-20 alone contributed **2,505 runs at 400-470/hour** to a job scheduled
   4x/day. Excluding that replay, the real rate on scheduled runs is **64/67 = 95.5%**. The
   aggregate inverted the truth by 38x. Before quoting a rate, ask what window it spans and whether
   anything in the denominator was not a scheduled run.

## How this file relates to CONTROL-CANARY-COVERAGE.md

They are **complementary, not overlapping**, and the split is deliberate:

| | [`CONTROL-CANARY-COVERAGE.md`](CONTROL-CANARY-COVERAGE.md) | this file |
|---|---|---|
| Unit | one **control** (a hook, gate, lint, guard, probe) | one **defect shape** |
| Question | "does this control have a canary that breaks it?" | "what kind of wrong is this, and what probe finds it?" |
| Output | an instance ledger — Proven / Unproven, counted | a detection procedure per shape |

That file is the register; this one is the field guide. A shape described here should end up
*used* there — its "Writing one" section is where a canary for one of these shapes gets built.

**The reciprocal cross-link is not yet in that file.** It is owned by a concurrent session and
was last written by #1791; adding a line to it from here would race them. Whoever next edits it
should add a pointer back to this file under its shape discussion.

---

# Shape 1 · the unwired control

The dominant class in this repo — eleven confirmed instances on 2026-08-21 alone. A correct
control that was never connected to anything. Fully covered in
[`CONTROL-CANARY-COVERAGE.md`](CONTROL-CANARY-COVERAGE.md); recorded here only so the four
heuristics can be compared side by side.

**Defeats:** *"does the code exist?"* — it does, it is correct, and it never runs.

---

# Shape 2 · the orphaned subject

**First confirmed 2026-08-22 (statenour `/brain` -> Discover).**

> **A feedback loop whose write survives, but whose subject does not.**

The control is present. It fires. It persists. Its consumer exists and reads it. Every
link in the chain passes inspection **individually** — and the loop is still dead, because the
row the signal was attached to is replaced by the producer before the signal is ever used.

The signal is not lost. Its *referent* is.

## Why the standard audit scores it GREEN

The dominant defect class in this repo — eleven confirmed instances on 2026-08-21 alone — is
*a correct control that was never wired to anything*. The standard probe is:

```
grep for readers of <the thing the control writes>
```

Zero readers → dead control. One or more readers → wired.

**That probe cannot see this shape.** Run against Discover on 2026-08-22:

- `discoveryVerdict` — written by `rateDiscovery()`, read by `listDiscoveries()`. Wired.
- `IntelligenceOutcome.decision` — written, read by `outcomesNeedingReview()`. Wired.
- `outcomeUseful` — written, read by the weekly `outcome-harvest` cron. Wired.
- One ledger row had closed end-to-end with a real `result_ref='task:cmt0kz8qw…'`. Proven live.

Every check green. The feature was nonetheless asking for verdicts that could not survive
24 hours, because the producer wrote its rows under

```ts
`blindspot_${spot.domain}_${Date.now()}`
```

and `remember()` upserts on `(category, key)`. A clock in the key asserts *"today's sighting of
this fact is a different fact from yesterday's."* Every nightly run therefore minted new rows,
and the operator's verdict stayed attached to a row nothing would ever look at again.

## The prod receipt

All six rows the live engine had ever written, at the moment of diagnosis:

| key | content head | created | verdict |
|---|---|---|---|
| `blindspot_PERSONAL_1787367702183` | `[HIGH] Open loop untouched: "Research and compile…` | 2026-08-22 | **null** |
| `blindspot_PERSONAL_1787367702048` | `[HIGH] Open loop untouched: "Review day's outcomes…` | 2026-08-22 | **null** |
| `blindspot_BUSINESS_1787367701580` | `[HIGH] Open loop untouched: "Create recurring Monday…` | 2026-08-22 | **null** |
| `blindspot_PERSONAL_1787281352755` | `[HIGH] Open loop untouched: "Research and compile…` | 2026-08-21 | `noise` |
| `blindspot_PERSONAL_1787281352607` | `[HIGH] Open loop untouched: "Review day's outcomes…` | 2026-08-21 | `noise` |
| `blindspot_BUSINESS_1787281352472` | `[HIGH] Open loop untouched: "Create recurring Monday…` | 2026-08-21 | `investigate` |

**3 of 3 verdicts given, 3 of 3 regenerated as unjudged within 24 hours — a 100% erasure rate
against a 100% participation rate.** The operator did everything the UI asked and the system
retained none of it.

Aggravating factor: `getBlindSpotContext()` read the newest rows into the model's system prompt
with no verdict filter, so a spot explicitly marked *Noise* was recited back to the system
nightly. The operator's instruction to disregard something became an instruction to attend to it.

## The probe that DOES detect it

Grepping for readers asks *"is the signal consumed?"* — the wrong question. Ask instead:

> **Does the producer and the consumer agree on what identifies the thing?**

Concretely, for any control whose state attaches to a persisted row:

1. **Find the producer's identity expression** — the upsert key, primary key, dedup hash,
   correlation id, or content hash. Read the literal expression, not its name.
2. **Check it for non-determinism.** `Date.now()`, `Math.random()`, `uuid()`, an
   auto-increment, a request id, a run id, a wall-clock bucket. Any of these means the producer
   mints a new identity per run.
3. **Check what the consumer assumes.** If the consumer's state (a verdict, an ack, a mute, a
   snooze, a "seen" flag, a resolution) is stored *on the row*, and step 2 found a
   non-deterministic key, **the loop is dead regardless of how many readers exist.**
4. **Prove it across a boundary, not within one.** See the trap below.

### The trap that nearly hid it a second time

The first canary written for this fix — "run the generator twice, assert zero new rows" —
**passed against the defect**. Both calls landed in the same millisecond, so `Date.now()`
returned the same value and even the broken key produced one row.

A test for a time-derived identity bug must **cross the boundary the producer runs on**. The
fixed canary advances a fake clock 24 hours between the two passes, and is paired with a
negative arm that drives the *old* key scheme through the same store and asserts it yields two
rows — so a harness that cannot see the failure cannot score green either.

This generalises: **an idempotence test that does not advance whatever the key is derived from
is not an idempotence test.**

## Fix landed

`lib/brain/blind-spot-identity.ts` — identity-derived stable key, plus an explicit recurrence
policy (suppress by default; resurface only on severity escalation, bounded at three per spot in
its lifetime, per Ancker et al. PMC5387195 on repeat-alert override). Canaries:
`tests/brain/blind-spot-identity.test.ts` (idempotence proven across a 24h boundary, with the
breaking arm) and `tests/brain/blind-spot-context.test.ts` (verdict-aware prompt read, with a
canary for the Prisma JSON-path null trap that kept 1 of 241 rows).


---

# Shape 3 · populated-but-unused

**Named 2026-08-23.** Credit to the concurrent session, which caught it *before* building on it.

> **A column's name is a claim about its contents. A populated column is not a used column.**

The field exists, is non-null, and type-checks. Schema inspection scores it GREEN. A null-check
scores it GREEN. And the contents carry no information — or state the opposite of what the name
implies.

## The worked example — `Mission.successMetric`

The sibling was about to gate a progress bar on whether a mission has a `successMetric`. It read
the values first. Verified independently against prod, 2026-08-23:

| mission | successMetric |
|---|---|
| Nick's Tire Revenue Recovery | `Recover $18k in dormant customer revenue this month.` |
| STATENOUR OS MVP Launch | `Ship the first live operating console.` |
| GENERAL PERSONAL | `Catch-all for personal tasks with no specific project.` |
| GENERAL MIND | `Catch-all for mind tasks with no specific project.` |
| GENERAL SOCIAL | `Catch-all for social tasks with no specific project.` |
| GENERAL BUSINESS | `Catch-all for business tasks with no specific project.` |

**9 missions · 6 populated · 4 of those 6 literally declare there is no project.**

The column is used as a free-text *description*, not a metric. Gating a completion bar on
non-null would have rendered a progress bar on exactly the missions stating they have no
completion. A null-check cannot see this. Only reading the values can.

## The second instance — `Task.energyRequired`, with its base rate

Across **subtasks** (`parent_task_id IS NOT NULL`): **12 rows, 1 distinct value, all `MEDIUM` —
exactly 0.00 bits.** Alive in the schema, inert in the data.

**State the base rate beside it** (`base-rate-check`): across *all* tasks the distribution is
`MEDIUM` 82.7% · `LOW` 11.8% · `HIGH` 5.5% ~= **0.82 bits**. So "0.00 bits" is true of the
subtask population and **not** true of tasks generally. A ratio computed inside a filtered
population is not a finding about the population — the same discipline that turned a
"72% of failed calls" claim into an 18% base rate.

## Retroactive reclassification

Two findings from 2026-08-22 were this shape, recorded under the vaguer label "uniform labels":

- **The Discover priority tag.** 92.5% of all blind spots ever written carry `CRITICAL` or
  `HIGH` — ~0.4 bits. Populated on every row, non-null, nearly information-free. Dropped from
  display and demoted to the recurrence threshold, where it does real work.
- **The energy tags above.**

Naming the class is what makes them one finding instead of two anecdotes.

## The probe

1. **Read the values before building on the column** — not the schema, not the null-rate, a
   sample of actual contents.
2. **Measure the entropy.** One distinct value across the population = zero bits = inert,
   whatever the type says.
3. **Check whether the contents contradict the name.** `successMetric` containing
   "no specific project" is the signature.
4. **State the base rate beside any in-population ratio.**

---

# Shape 4 · the blind instrument

**Named 2026-08-23.** Four instances in one day, which is what forced the name. All four surfaced
during the /task completion incident; none came from Discover.

> **A measuring device that cannot observe its own subject — and reports success anyway.**

This is a *nastier* failure than an unwired control, and the difference is worth being precise
about. An unwired control is silent: it produces no signal, and a careful reader notices the
absence. A blind instrument produces a **confident, well-formed, wrong** signal. It does not fail
to answer; it answers, and the answer is about something other than what you asked.

Shape 2 is a defect in a *loop*. This is a defect in a *measurement*. They compound: a blind
instrument is exactly what lets an orphaned subject survive an audit.

## The instances, 2026-08-23

| Instrument | Appeared to measure | Actually measured | Receipt |
|---|---|---|---|
| `task_events` | task completions | everything except completions | 294 rows, 5 kinds (`created` 119 · `revived` 74 · `reframed` 56 · `started` 43 · `snoozed` 2), **`completed` = 0, ever** |
| `error_logs` | server errors on the failing path | errors on routes that go through `apiHandler` | the tRPC path converts to `TRPCError`; `lib/trpc/` has no equivalent global write |
| `api_request_logs` | HTTP traffic | a **10% production sample** of `apiHandler`-wrapped routes | `/api/tasks%` -> **0 rows, all time** |
| The clock | UTC timestamps | local time | `timestamp without time zone` in the reader's zone: **+4 h on ET** |

Three corrections, all of which are themselves instances of the shape:

**`task_events` is not unwired — it is alive and specifically blind to one kind.** The table
takes writes (latest 2026-08-23 09:00) and a producer exists at `lib/services/tasks.ts:1038`
(`emitTaskEventAsync({ kind: "completed" })`). So "no call site emits it" is refuted by code.
The truth is narrower and worse: the emitter exists, the table works, and `completed` has
**never** landed. An unwired-control diagnosis would have sent someone to write a producer that
was already there.

**`api_request_logs` — right conclusion, wrong mechanism.** An earlier draft of this file said it
"instruments five path prefixes". There is no prefix list. The writer is `apiHandler`
(`lib/utils/http.ts:243`) and it logs whatever route it wraps, gated by
`duration_ms > 1000 || Math.random() < 0.1`. `/api/tasks/*` **is** wrapped. The blinding is (a)
routes that bypass `apiHandler` entirely — the pattern already documented at
`lib/services/diagnose-chat.ts:17-20` — and (b) a 10% sampler that makes any low-volume path
invisible in a short window. The empirical claim held (0 rows for `/api/tasks%`); the stated
reason was invented. **A field guide against blind instruments that misreads an instrument's
blinding mechanism is the shape it names.**

**The count differs from the sibling ledger, deliberately.**
[`CONTROL-CANARY-COVERAGE.md`](CONTROL-CANARY-COVERAGE.md) lists `task_events`, `error_logs`,
**`reality_gap_writeback_failed`** and the clock, and counts **three** blind instruments because
it holds that the clock "is not a control". Both are defensible and the divergence is real:

- That file counts by CONTROL, so a clock is out of scope for it. This file counts by SHAPE, and
  a clock that reports the wrong frame is the purest instance of the shape — so it is counted here.
- `reality_gap_writeback_failed` is listed there as having "exactly one reference repo-wide: its
  own writer. Nothing read it." That is the **unwired-control** shape, not this one. It is
  correctly in that ledger and correctly absent from this table.
- `api_request_logs` appears here and not there because it surfaced during the /task incident
  after that file was last written (#1791).

**Do not reconcile these to one number without re-reading both definitions.** Four by shape,
three by control, and the sets are not the same members.

## Worked example — the alerting question (four instruments, three blind)

> **A second, distinct incident.** [`CONTROL-CANARY-COVERAGE.md`](CONTROL-CANARY-COVERAGE.md)
> carries its own four-blind-instruments example from the **/task completion** incident
> (`task_events`, `error_logs`, `reality_gap_writeback_failed`, `api_request_logs`, the clock).
> This one is a different question, different instruments, same shape — which is the point: two
> independent incidents on one day each needed four sources and each found three that could not
> speak.

One question, 2026-08-23: **"did anything alert on those 64 failures?"** Answering it needed four
sources. Three could not speak, and each was blind in a different way.

| instrument | what it should have answered | why it could not |
|---|---|---|
| `automation_policies.lastFiredAt` | when the alerter last ran | its write path changed the same day — unreliable by construction |
| `cron_job_logs` | did an alert job run | **0 rows for any telegram/alert/notify job**, while other jobs log normally in the same table. Blind *specifically to the alerters* — the worst possible blind spot for an alerting question |
| `automation_policies.lastResult` | is the job healthy | reads **`'success'`**. It tracks the most recent run, not the streak, so a job failing 4/4 daily for 16 days could never have shown the outage while it was happening |
| `AuditEvent` | what was actually delivered | **the only one that could answer** — it records deliveries, not intentions |

That is *"check the logs"* failing four different ways on one question.

### And the finding underneath it

Over the 16-day, 100%-broken window the system sent **32 push notifications**, in exactly three
distinct titles:

| title | count |
|---|---|
| `high: Morning brief` | 16 |
| `high: Daily Executive Brief` | 15 |
| **`critical: 5 crons not firing`** | **1** |

**0 of 32 name `ingest-reviews`.**

State this precisely, because the loose version is wrong in three ways and the precise version is
worse. It is NOT true that "nothing alerted" — one alert fired. It is NOT true that "every push was
the daily brief". And they were not stamped `Drift: CRITICAL` — the severity prefixes are `high:`
(31) and `critical:` (1).

What IS true: **31 of 32 pushes during a total outage were routine briefs, and the single alert
fired once, never repeated across sixteen days, and never named the failing job.** That is worse
than silence, because it looks like coverage. An alerting system that fires once and then goes
quiet through a continuing fault has reported "handled" for a fault it never identified.

> A first pass at this filtered pushes with `detail ILIKE '%fail%' OR payload::text ILIKE '%fail%'`
> and got 32 of 32 — a filter matching everything, which cannot support a negative. The refined
> query (`ILIKE '%ingest-reviews%'`) returned 0. **A negative finding from an unvalidated filter is
> shape 4 on your own query.**

## The probe

For any instrument you are about to trust:

1. **Plant a positive.** Before believing a zero, produce one known-true row and confirm the
   instrument sees it. `task_events` returning zero and `task_events` being unwired are the same
   observation until you do this.
2. **Read the instrument's own scope, not its name.** `api_request_logs` sounds total. Its
   filter list is five path prefixes. The name is a claim; the filter is the fact.
3. **Ask what frame the number is in.** Timezone, unit, currency, sample window, filtered
   population. A number without its frame is not yet evidence — see
   `base-rate-check` for the denominator half of the same discipline.
4. **Check whether absence is distinguishable from silence.** If "nothing happened" and "I
   cannot see" render identically, the instrument cannot support a negative conclusion.

## Count as of 2026-08-23

Twelve-plus confirmed instances of the dominant unwired-control class
([`CONTROL-CANARY-COVERAGE.md`](CONTROL-CANARY-COVERAGE.md) is authoritative — it counts by
control, this file counts by shape, so the two numbers are **not** interchangeable), plus one
orthaned subject, two populated-but-unused columns, and four blind instruments BY SHAPE
(three by control — see the divergence note in shape 4; the sets differ in membership, not just
in count).

The blind instruments all landed on **one day**, which is the finding. Four independent
measuring devices, none broken, none reporting an error, all incapable of observing the thing
they were consulted about. That rate suggests the class is under-counted historically rather
than newly common — nobody was looking for it, because a blind instrument never raises its hand.

---

## Where else to look

Candidates for the probes above, not yet audited. The first three are orphaned-subject
signatures; the last two are shape 3 and shape 4:

- Every `remember()` call site whose key is built with a template literal — a key containing an
  expression rather than a stable referent is the signature.
- Ack / mute / snooze / dismiss flags stored in `metadata` on rows a cron regenerates.
- Any `contentHash` dedup where the hashed content includes a timestamp, a count, or a
  rendered date.
- Any column you are about to branch on: read its values first, and measure its entropy.
- Any log or metrics table consulted for a NEGATIVE conclusion: confirm it can see a positive.

---

# Recorded decisions

A measured NO is worth as much as a fix: it stops the next person relitigating it from the same
intuition. Record the reasoning, not just the verdict.

## REJECTED 2026-08-23 · migrate all `timestamp` columns to `timestamptz`

**Proposed because of a real incident.** On 2026-08-23 a 13-hour-old write was read as ~6
minutes old, and a rollback of a healthy production migration was very nearly ordered on it.
Storing UTC in `timestamp without time zone` is on PostgreSQL's own
[Don't Do This](https://wiki.postgresql.org/wiki/Don%27t_Do_This) list. The story was good.

**Rejected because the story pointed at the wrong layer.** Measured, not argued:

| reader | same row | vs `now()` = 14:26:02Z |
|---|---|---|
| **Prisma** | `2026-08-23T13:45:04.469Z` | 0.68 h — **correct** |
| **node-pg** | `2026-08-23T17:45:04.469Z` | 3.32 h — **+4 h skew** |

**Prisma's engine parses these columns as UTC. The application was never affected.** The skew
lives entirely in raw-`pg` tooling, and `TZ=UTC` on the process removes it — reproduced
directly: without the pin the newest write appears **3.91 h in the future**; with it, 5 minutes
ago.

**What the migration would have cost**, measured against prod:

- **272 columns across 103 tables, 4,155 MB** (`vector_embeddings` alone is 2,881 MB).
- The form matters and the obvious form is the expensive one. Three trials on a 50,000-row
  scratch table, PostgreSQL 17.11, server TimeZone `GMT`:

  | variant | rewrite? | time | values |
  |---|---|---|---|
  | `USING at AT TIME ZONE 'UTC'`, TZ=UTC | **YES** — full table + index rebuild | 117 ms | correct |
  | no `USING`, TZ=UTC | **NO** — metadata-only | 60 ms | correct |
  | no `USING`, TZ=`America/New_York` | **YES** | 117 ms | **WRONG, silently — off by 4 h** |

- That third row is the disqualifier: **getting the session timezone wrong produces wrong
  instants with no error.** A 4 GB migration whose failure mode is silent data corruption,
  against a problem that only manifests in raw psql output.

**Decision:** pin the reader, not the schema. `process.env.TZ = "UTC"` in
`scripts/apply-pending-migration.ts` and `scripts/probe-bdn310-preflight.ts`, each carrying the
reasoning inline so the naive columns do not re-trigger the proposal in six months.

**What makes this worth recording:** the incident was real, the anti-pattern is real, and the
proposed fix was still wrong. Symptom, anti-pattern and root cause were three different things,
and only a measurement separated them. That is shape 4 operating on the diagnosis itself — a
confident, well-formed reading of the wrong quantity.

---

# Shape 5 · the lying surface (doc-facing)

**Named 2026-08-23.** Five instances in one sweep.

> **A doc claim is an unwired control — and worse, because a doc actively stops people looking.**

An unwired control is merely absent. A false doc claim asserts a mechanism, nothing verifies the
assertion, and a reader who finds the sentence stops searching. **The aggravating factor: a false
COMPLETENESS claim does not just mislead, it closes a search.**

## The worked example

`apps/nickstire/docs/admin-surface-audit/code-underneath-audit-logic.md:37`:

> "every job in it duplicates a tiered job EXCEPT the two above."

Measured against origin/main 2026-08-23: **33 registered jobs, 8 absent from every tier by name.**
Six are name-mismatches with real coverage (`retention-all` at `scheduler.ts:1675` imports all six
`processRetention*`; `statenour-live-sync` at `:863`). **Two are genuinely dead** —
`campaign-resume` (`index.ts:347`, calls `resumeStuckCampaigns()`, so stuck SMS campaigns are never
recovered after a restart) and `sms-learning-digest` (`index.ts:368`).

**That one sentence converted an incomplete search into a closed question, and the class stopped
being swept.**

The same table is stale a second way: its headline row says `confirmation-calls` and
`voice-recovery` "never fire on a timer". Both are now tiered — `scheduler.ts:992` and `:1003`,
with a comment reading "MOVED to the hourly tier". The doc records a defect that has since been
fixed, and the completeness clause is anchored to those two, so the sentence is wrong on both
halves.

## The other four

| claim | reality |
|---|---|
| `apps/statenour/docs/DESIGN.md:5` — "Anti-slop **verified at push time**… (gate 13/13)" | script exists; in **no hook, workflow or composite gate** |
| `apps/statenour/scripts/check-anti-slop.sh:76` — prints `emergency override: ANTI_SLOP_GATE_SOFT=1 git push` | advertises a push hook that does not exist |
| `agent-os/standards/nourcity/enforced-gates.md:32` — lists `check:anti-slop` | file is titled **Enforced Gates** and opens "These scripts are codified standards… not optional" |
| `apps/statenour/docs/SECURITY.md:234` — "`pnpm audit` runs in `pre-push-check.sh`" | that script **is not in the tree** |

**Ground truth: `lefthook.yml` pre-push runs exactly one command — `pnpm run build:affected`.**
Every "verified at push time" claim in the repo except that one is false.

## The probe

`scripts/check-doc-claims.mjs` resolves three claim kinds across both apps. It **caught its own
defect twice while being written**, which is the argument for it: v1 cleared `DESIGN.md:5` because
the script appears in `package.json` (an npm alias is not a gate); v2 still cleared it because
`"check:anti-slop": "bash scripts/check-anti-slop.sh"` is a script *value*. A composite must
actually chain (`&&`). **Defining a script is not running it.**

1. **GATE claims** — the named script must exist AND appear in a hook, workflow, or composite.
   Mechanically decidable; `--strict` gates on these.
2. **COMPLETENESS clauses** — either a script keeps the question open, or the sentence is rewritten
   as a dated measurement: *"as of \<date\>, measured N of M."*
3. **COUNT claims** — flagged unless the reproducing command sits nearby. A number without its
   command is a cache with no invalidation.

## Turning a clause into a check — reuse, do not reinvent

The nickstire half of this is already shipped in **PR #1808**
(`apps/nickstire/scripts/lint-cron-wiring.ts` + `server/cron/registry-tier-map.ts`). Its allowlist
design is the pattern to copy, and its two refinements are what make it a guard rather than a
permission slip:

- **each entry names the tier job that actually covers it**, and the check verifies *that* job is
  itself wired — so an entry cannot outlive its justification;
- **a redundant entry is rejected**, so the list cannot accumulate permanent excuses;
- **exact names only** — a `retention-*` pattern would have silently absorbed a genuinely stranded
  `retention-30day`.

Any second implementation of this idea in this repo is where the next drift starts. Extend that
script; do not write another.
