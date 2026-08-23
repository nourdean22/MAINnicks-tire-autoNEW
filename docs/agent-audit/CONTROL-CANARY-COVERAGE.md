**Both landed 2026-08-22, together, as argued.** The widening, the wiring into `verify:hard`, the
programmatic seed and a canary shipped as one change, because each is useless alone: a widened script
nothing invokes is a dated warn tier with no caller, and wiring an unsatisfiable gate red-lines every
local push. Post-seed the gate reports `✅ all 20 autonomous-action rules have policies · ✅ all 74
active crons have policies`, exit 0, and the rule tier is HARD from the first commit — an earlier draft
made it WARN "until the seeder is switched", but that switch shipped in the same commit, so the warn
window would have been a 24-day hole for the exact defect the gate exists to catch.

### Three near-misses, recorded because the next session hits the same fork

Closing this gap had three ways to go wrong, none of which a test would have caught:

1. **Derived-from-declaration is not derived-from-policy.** Every rule in the registry — all twenty — declares
   `approval: "auto"`. Reading "derive policies from the rule list" literally — taking `approvalClass`
   from `rule.approval` — would have armed **17 lanes** to fire unattended (18 `send_telegram`, and the
   registry also holds 1 `send_email`, 1 `promote_memory`). The repo already encoded the answer: the
   lead-emailing rule is curated `"pending"` **despite** its own `approval: "auto"`. A rule DECLARES
   what it would do unattended; a policy RECORDS whether the operator has agreed to that. They are
   different facts and only one of them is an authorisation. **Which lane is protected by what is also
   easy to invert:** the 17 at risk are all telegram; the one customer-emailing lane is protected by
   *curation* winning last, not by the derived baseline.
2. **A seed script that runs on import.** `seed-policies.ts` calls `main()` at module load. A test
   importing it to assert completeness would have executed a **production write as a side effect of a
   unit test**. The derivation lives in `lib/automation/derive-rule-policies.ts` so it can be imported
   without that.
3. **A status-string rename that empties a queue.** Marking the bootstrap gap by changing
   `result: "pending_approval"` to a new value looked cleaner. `lib/services/action-receipt-feed.ts:73`
   classifies on that exact string — the rename would have silently dropped every affected row out of
   the approvals queue while every test passed. The marker rides in `payload` instead.

# Control canary coverage

**Measured 2026-08-22.** Referenced from root [`AGENTS.md`](../../AGENTS.md) -> *Ship the canary, not
just the control*. That file deliberately carries **no count** — counts rot faster than a policy file
gets re-read. This one is dated, and every number below is reproducible with the commands in
[Regenerating](#regenerating).

**The rule:** no hook, gate, lint, guard, alert or probe ships without a test that breaks it and
asserts it fails.

**Why a table and not a vibe:** a control that silently stopped working and a control that is passing
look *identical* from the outside. The only way to tell them apart is to break it on purpose and watch
it complain.

---

## Four shapes, and the heuristic each one defeats

Everything found on 2026-08-23 — across this session and the Brain session working the same estate —
collapses into four defect shapes. What makes them worth naming separately is not the symptom, which
is always "a thing that looks fine and is not". It is that **each one is invisible to a different
standard check**, so a reviewer running the obvious test comes away reassured.

| shape | what it is | the heuristic it defeats |
|---|---|---|
| **unwired control** | a gate, guard or probe that exists and is never called | *"does the code exist"* — it does, and it is correct, and nothing invokes it |
| **orphaned subject** | a reader with no writer, or a writer with no reader | *"grep for readers"* — there IS a reader; the producer is what is missing |
| **populated-but-unused** | a column that is full of values nobody consumes, or whose values are a placeholder | *"is the column null"* — it is not null, on every row |
| **blind instrument** | a control that is wired, running, and pointed at nothing | *"check the logs"* — the log is clean because it cannot record the thing |

**On the third one, which is the newest and the easiest to miss: a column's name is a claim about its
contents, and a populated column is not a used column.** `NOT NULL` on every row proves that
something wrote a value. It does not prove the value means what the column is called, that anything
reads it, or that it varies. Three live examples, all found by opening the data rather than the schema:

- **`Mission.successMetric`** is populated on six of nine missions. Four of those six hold the
  sentence *"Catch-all for business tasks with no specific project."* That is not a success metric;
  it is a description, and specifically a description saying the mission has no success condition.
  A gate keyed on `successMetric IS NOT NULL` would have rendered a completion bar on exactly the
  missions that declare they cannot complete.
- **`Task.energyRequired` on AI-generated subtasks** was 12 of 12 MEDIUM — 0.00 bits — because the
  insert hardcoded the string. **With its denominator, which the finding is worthless without:**
  across all tasks the column is MEDIUM 82.7 / LOW 11.8 / HIGH 5.5 percent, about 0.82 bits. The
  column is alive and genuinely varies. Only the generator's rows were constant, and reporting the
  0.00 without the 0.82 would have condemned a working column.
- **The priority label** sits at 92.5 percent in its top two tiers. A scale that almost never uses
  its lower half is not ranking anything.

The right check is not `IS NOT NULL`. It is **entropy plus a consumer**: does the value vary, and
does anything branch on it? A constant is a placeholder wearing a measurement's name, and a column
nobody reads is a comment with storage costs.

**A caution that belongs beside this shape.** Every figure above is a ratio inside a filtered
population, and each is only meaningful next to its base rate — that is why both numbers appear on
the energy line. The house precedent is the 2026-08-08 call archive, where "72 percent of failed
calls are short" was quoted against an 18 percent base rate, and the ratio turned out to be nearly
definitional: a call where nobody spoke cannot be scored a success. It aimed the operator's next
priority at working code. Name the denominator, or do not quote the number.

## Counting unit

**One control = one thing that can independently stop working without anyone noticing.** A `verify`
chain of 14 links is 14 controls, because link 9 can rot while 1-8 stay green and the chain still
reports pass. The denominator below is what is enumerated here, not a claim that the enumeration is
complete — an unlisted control is not a covered one.

> **The unit is applied asymmetrically, and the asymmetry flatters this table.** `verify:hard` is
> counted as 16 because its links rot independently — but `check-adapters.mjs` is counted as **1**
> despite carrying dozens of assertions that demonstrably rot independently too
> (a raw count is deliberately omitted here: this document's numbers are gated by
> `coverage-doc.test.mjs`, which compares every stated check count against the CURRENT
> checker, so a historical figure would read as drift): this very PR found 6 of them inert
> because a file was missing from a fixture list, and ~21 more that a one-line change would have taken
> dark. Only 11 have a break-test today. Assertions still uncanaried include the `CODEOWNERS`,
> `apps/voice`, `Two apps share this repo`, `mcp_config.json` and the three MCP `requireMatch`es.
> Applied consistently the denominator grows, so the true figure is **lower than the ratio in the table below**. That is
> therefore an upper bound on coverage, not an estimate of it. It is left as-is rather than silently
> recomputed, because picking a new denominator mid-table is how a number stops meaning anything.

| Surface | Controls | With a canary | Notes |
|---|---:|---:|---|
| Claude policy **matcher** — `policy.mjs`, 13 rules / 57 denyExamples | 1 | **1** | Proven by `policy.test.mjs` |
| Claude hook **wiring** — `pretool.mjs` exit-2, `settings.json` registration, `notebook_path`→`filePath` | 1 | 0 | **Never exercised.** See [proven ≠ connected](#proven-is-not-connected) |
| Claude hooks — `Stop`, `SessionStart` | 2 | 0 | `stop-check.mjs` fails **open** on its own bugs |
| agent-os parity — `check-adapters.mjs` | 1 | **1** | 135 checks, proven as of this PR |
| lefthook `pre-commit` | 9 | 0 | 2 of the 9 invoke a proven control (`nickstire-lint-brand`, `agent-os-verify`) |
| lefthook `pre-push` | 1 | 0 | `turbo-build-affected` |
| statenour `verify:hard` | 16 | 0 | 12 are `tsx scripts/*.ts`, and `scripts/` is **excluded from tsc** |
| statenour `check:policy-coverage` | 1 | **1** | Was wired into **nothing** for months; wired into `verify:hard` and canaried 2026-08-22 — see [the dead control](#the-dead-control) |
| nickstire `verify` | 14 | **1** | `lint:brand-voice` proven by `lintGateFailClosed.test.ts` |
| Product alert paths — daily brief end-to-end | 1 | 0 | See [instance ten](#the-worked-example--instance-ten) |
| **This document** — its own derived numbers | 1 | **1** | [Instance twelve](#instance-twelve--this-document). Proven by `coverage-doc.test.mjs` |
| statenour `cron-heartbeat` **outcome lane** | 1 | **1** | Detects run-but-fail, which the silence check structurally cannot. Proven by `cron-heartbeat-failing-lane.test.ts` |
| statenour `ingest-reviews` zero-fetch assert | 1 | **1** | A 200 with an empty payload now throws. Proven in `tests/cron/ingest-reviews.test.ts` |
| `cron_job_logs.resultCount` producer | 1 | **1** | The schema can now tell a full ingest from a zero-result one, and `cron-manager-result-count.test.ts` proves it DISCRIMINATES rather than merely exists |
| Task-completion observability | 1 | **1** | The `completed` event, the failure log, and the queryable writeback — three blind instruments, all canaried and mutation-fired |
| Structural vs transient error copy | 1 | **1** | A missing relation no longer reads as a retryable hiccup; ordering is pinned by a canary that reproduces the month-long bug |
| Subtask next-action gate — `filterGeneratedSubtasks` + its call site | 1 | 1 | validator unit tests PLUS a wiring canary in `ai-tasks-decompose.test.ts`; deleting the gate block fails 6 |
| Mission progress end-state gate — `missionHasEndState` | 1 | 1 | behavioural render; swapping the ternary branches fails 3 where source-text assertions passed 11 |
| Witnessed-commitment resolver — opt-in guard on `emitTaskEvent` | 1 | 1 | asserts the completion emit does NOT set the flag, on both the ONCE and recurring paths |
| **Total** | **56** | **13** | **23.2 %** |

---

## Proven — the ones that fire

> The summary table above is the count; this section shows the shape. An earlier
> heading said "the three that fire" and went stale the moment the total moved,
> because the number canary matches DIGITS and cannot see a spelled-out word.

| Control | Guards | Canary | Runs in |
|---|---|---|---|
| `config/agent-os/policy.json` (13 rules, 57 denyExamples) | destructive git/DB/install commands | `scripts/agent-os/policy.test.mjs` — *"every denyExample is actually blocked, **by its own rule**"* | `pnpm agent:verify`, CI |
| `scripts/agent-os/check-adapters.mjs` (135 checks) | adapter parity, line caps, line length, `@`-imports, stale claims | `scripts/agent-os/adapters.test.mjs` — 17 tests: 11 breaks, 3 spare-cases, a cap boundary pair, 1 invariant, 1 positive control | `pnpm agent:verify`, lefthook, CI |
| nickstire `lint:brand-voice` | claim safety on staged content | `server/lintGateFailClosed.test.ts` — *"an UNREADABLE staged diff exits non-zero and prints NO pass line"* | `pnpm run verify`, lefthook |

They share one shape worth copying: **they break the control AND assert an unbroken run still
passes.** Without that second half, a control that failed unconditionally would score 100 %.

## Unproven — the rest

| Control | Guards | Why it matters that it is unproven |
|---|---|---|
| `pretool.mjs` **hook wiring** | that a matched rule actually blocks the call | The matcher is proven; the wiring that runs it is not. See below |
| `stop-check.mjs` (Stop hook) | uncommitted changes on `main` | Fails **open** on its own bugs (`pretool.mjs:9-12`) — silence is not a green |
| `graphify-session-context.ps1` (SessionStart) | injects graph context | A silent failure degrades every later decision invisibly |
| statenour `check:env`, `check:runbooks`, `check:prompt-injection`, `check:audit-deps`, `check:lint-baseline`, `check:raw-sql`, `check:crons`, `check:soft-delete`, `check:get-auth`, `check:mutations:strict`, `check:stale-docs`, `prompt:size-check` | 12 distinct invariants | `tsconfig.json` excludes `scripts/`, so **none of these is typechecked**; a broken import passes every gate and fails only at runtime |
| lefthook `pre-commit` x9, `pre-push` x1 | staged lint, typecheck, secrets, build | Git-level, applies to **every** agent and human — the widest blast radius and the least proof |
| nickstire `verify` — 13 of 14 links | PII, routes, prerender, migrations, SQL | Only `lint:brand-voice` is proven |
| Daily-brief delivery path | that the operator actually sees a P1 | Instance ten, below |

---

## The worked example — instance ten

The strongest entry, because every per-stage instrument reported success.

**Detection ✓ · composition ✓ · persistence ✓ · push ✓ · routing ✓ · render ✗** — as it stood for 18 days.
The render defect is now fixed (#1781); see **Status** below. What is still missing is the canary.

The loose version — *"the alert never reached him"* — is **wrong**, and less useful than the truth:
**the alert reached the operator 18 times and the destination contradicted it 18 times.**

| Phase | Window | Span | What was true |
|---|---|---:|---|
| Latent | 2026-06-23 -> 07-29 | 37 d | Defect present in the page's **first commit** (`5999d24f2`); no briefs existed, so nothing revealed it |
| Active | 2026-07-30 -> 08-22 | 24 d | **24 daily briefs** composed and persisted — every one unrenderable |
| Contradicted | 2026-08-04 -> 08-22 | 18 d | **18 push deliveries**, `sent > 0`, `failed: 0` every time, into a page reading "No Briefing Generated Today" |

**Cause:** the page read `data.brief` from an `apiHandler`-enveloped `{ok, data: {brief}}` body.
`apiHandler` shipped 2026-05-17, five weeks *before* the page — so this was never drift between two
evolving things, it was a consumer that never matched a contract that already existed. The fetch line
was byte-identical at birth and after #1353 (2026-08-04): across those 60 days the screen rendered a
brief exactly **zero** times.

> **Status: the render defect is FIXED.** #1781 (`ec69d8347`, 2026-08-22) changed the page to
> `const payload = body?.data ?? body;` — it is closed on the merge base this table is written against,
> and the tenses above are historical. An earlier draft of this section said "the screen has **never
> once** rendered a brief" in the present tense, describing as live a defect the author had already
> fixed. In a document whose stated purpose is measurement honesty, that is the same class of error as
> the reconstructed receipt below it, so it is recorded rather than quietly amended.
>
> **The entry stays in the table, and its row still reads 0.** What was fixed is the *bug*. What is
> still missing is the *canary*: nothing asserts end-to-end that a composed brief reaches a rendered
> page. The identical failure could recur tomorrow on any of the other panels reading this envelope,
> and every per-stage instrument would stay green exactly as it did for 18 days.

**Evidence:** `"AuditEvent"` rows where `eventType = 'push_sent'` — and `push.ts:289` writes that type
only when `sent > 0`, so the row itself is the proof. Zero `push_undelivered` rows exist.

**The lesson this instance teaches, which no single-stage test can:** every layer had a success signal
and every layer was telling the truth about its own hop. Cron logged success, the composer logged
success, push logged `failed: 0`. **End-to-end proof is not the sum of per-stage greens.**

> **Base-rate note.** `push_sent` totals 2,322 rows, but **2,286 of the trailing 14 days landed on
> 2026-08-20 alone** — the #1735 notification recursion (`push.ts:73`: 2,279 CRITICAL pushes in ~5.5
> hours). Quoting the headline total as routine volume would be wrong by ~50x. The 18 figure above is
> the brief series specifically.

---

## Proven is not connected

A canary proves a control *fires*. It does not prove the control is *wired*, and it does not prove the
control *measures the right thing*. Three states, not two — and the last two both produce green:

| | fires when broken? | actually invoked? | measures the right thing? |
|---|---|---|---|
| **Proven** | yes | yes | yes |
| **Unproven** | unknown | — | — |
| **Proven but unwired** | yes | **no** | — |
| **Proven but blind** | yes | yes | **no** |

Two live examples, both found while writing this table:

**Proven but unwired — the policy matcher.** `policy.test.mjs` is the best canary in the repo: it
asserts every `denyExample` is blocked *by its own rule*. But it imports `policy.mjs` directly and
**never spawns `pretool.mjs`**. So the matcher is proven and the hook that runs it is not — not its
exit-2 behaviour, not its registration in `.claude/settings.json`, not its `notebook_path`→`filePath`
mapping (which the test's own comment names as pretool's job). Delete the hook's registration and every
test still passes. That is why the two are counted as separate controls above.

**Proven but blind — the line cap.** `requireThin` has a canary in `adapters.test.mjs`
(*"line caps are real — a fat adapter is rejected"*), and it genuinely fires. It counts **lines**.
On 2026-08-22, seven wrapped passages in this repo's root policy file were reflowed into single long
lines to make room for new content. Not one word was removed — the reflow freed lines without
reducing anything an agent loads — and every gate stayed green throughout.
Lines are not the context cost; bytes are. A gate that fires reliably on the wrong metric is more
dangerous than one that never fires, because it emits positive evidence of a constraint that is not
constraining. The repo's own audit proposed a max-line-length canary for exactly this and it was never
built. **It is now**: `forbidLongLine` rejects any non-table line over 140 chars, with canaries in both
directions (a 200-char prose line must fail; a wide markdown table row must be spared). The line cap
itself was also off by one — `lineCount` counted the trailing empty string after a file's final
newline, so `cap 200` silently meant 199 for every newline-terminated file. Fixed, and proved at the
boundary. Root `AGENTS.md` is no longer an exception: **200 lines, the same cap as the per-app files**,
reached by 21 verified relocations rather than by moving the number.

---

## The dead control

The failure class in its purest form: **a control that works correctly, whose hard-mode ratchet expired
2026-05-10, and which has never once run inside a gate.**

`apps/statenour/scripts/check-policy-coverage.ts` was defined as `check:policy-coverage` in
`package.json` and invoked by **nothing** — not `verify:hard` (17 links today; it was 16 and none of
them was this), not `.github/workflows`, not `lefthook.yml`. Run by hand on 2026-08-22 it exited **1**
immediately. Verbatim, not reconstructed:

```
  ❌  3 active crons missing AutomationPolicy entry:
     · cron.tool-description-rewrite
     · cron.outcome-harvest
     · cron.conversation-compile

  fix: add the cron to scripts/seed-policies.ts (or run the script if
       it's already declared) — `pnpm tsx scripts/seed-policies.ts`

  emergency override: POLICY_GATE_SOFT=1 to demote to warning.
```

Three crons have been running unaudited for months behind a gate that would have named them on the
first push. Nobody weakened it, nobody disabled it — **it was simply never connected**, which is
indistinguishable from passing right up until someone runs it.

> **An earlier draft of this section printed a receipt this script cannot emit** — it showed a second
> `⚠️ 17/20 autonomous-action rules` line, ordered above the cron block, from a since-reverted local
> change. Both details were wrong: the code prints the rule tier *first*, and that tier is not on this
> branch at all. A reconstructed receipt inside a document arguing that receipts must be real is the
> same defect the document is about, so it is recorded here rather than quietly corrected.

**The same gate is also blind, separately from being unwired.** It enumerates only `cron.*`. The
autonomous-action engine registers **20** rules (`listRuleNames()`), and `scripts/seed-policies.ts`
carries **4** `autonomous-action.*` ids of which only **3** match a real rule name — so **17 of 20
rules have no policy**, and the fail-closed engine parks every match as pending forever. That figure is
derived from source, not from this script: it cannot see rules, which is the point. A fourth seeded id,
`autonomous-action.auto_score_applicant`, matches **no** rule in `RULES` — a dangling policy row.

**Why neither the widening nor the wiring is in this PR.** Connecting the gate turns `verify:hard` red
for every session sharing this checkout, and the remedy — seeding the missing policies — is a
**production database write**, a protected operation needing explicit operator authorisation. A widened
script with no caller is no better: a dated warn tier inside something nothing invokes is the same
failure with a timestamp on it. Both land with the seed, together, with a canary. Shipping a gate you
know is red, softening its tier to make it green, or adding an uncalled one, are three wrong repairs.

---

## The worked example — four blind instruments and a wrong clock

2026-08-23. The operator reported that completing a task threw an error. Diagnosing it meant asking
the system what had happened. **Every instrument reached for was structurally incapable of answering,
and each one's silence was nearly read as evidence.**

**Structurally blind means the instrument could not have answered even if the system were on fire.**
Not "it happened to be empty" — empty is the symptom. Each row below names the mechanism.

| instrument | what it was asked | why it was STRUCTURALLY unable to answer |
|---|---|---|
| `task_events` | did the completion land? | Two emitters of `kind: "completed"` existed — and neither could fire. One (`tasks.ts:1038`) is annotated in-source as UNREACHABLE, because every real TODO→DONE PATCH short-circuits into `checkTask` before it. The other is voice-only. The spine every UI route funnels through emitted nothing, so the log had **zero** completions across 294 rows. |
| `error_logs` | did the completion fail? | The completion path had no write to it at all. `checkTask` threw `ServiceError`, the tRPC handler converted it to a `TRPCError`, and the catch recorded nothing — so a failed completion could not produce a row by any route. Querying it and finding nothing was querying a table the feature was not plumbed into. |
| `reality_gap_writeback_failed` | did the side-write fail? | Exactly **one** reference repo-wide: its own writer. A log line nothing reads is not an instrument, it is a comment that costs disk. |
| `api_request_logs` (Brain session) | which requests failed? | It does not instrument tRPC or the task routes. Every mutation in this incident travels one of those two paths, so the table was structurally incapable of holding a single relevant row. |
| the clock | when did this happen? | Inferred from the newest row in a query result instead of read. A write **thirteen hours old** was reported as six minutes old. |

The shared mechanism is worth stating flatly: **in every row, the query returned an empty set and the
empty set was read as a finding about the world.** It was a finding about the instrument.

**The clock is the one to sit with.** It is not a control, and no canary would have caught it — but it
is the same error as the other three: taking a fact off an instrument that was not measuring it. The
newest row in a result set is not the present. It nearly caused a healthy migration to be rolled back.

> **The rule it produces:** during a live diagnosis, establish the current time **explicitly** — from
> the database or the system — before any reasoning about recency. Never infer "now" from data.

**An absence is only evidence if the instrument can record a presence.** Before reading silence as a
finding, prove the thing can speak: plant a positive control, or check that the value has ever been
non-empty. Three times in one hour that check would have changed the conclusion, and once it did —
the "no completion in three days" inference was withdrawn after the operator challenged it, because
absence of successes is not evidence of failure.

**The defect these share is not "unwired".** A wired control that cannot observe its subject reports
green forever and is indistinguishable from a healthy system. That is the fourth category, alongside
proven, unproven, and proven-but-blind: **wired, running, and pointed at nothing.**

### What was fixed

- `checkTask` now emits `kind: "completed"`, so the append-only log records the most important event
  in a task's lifecycle for the first time. **The first attempt at this fix was itself blind**, and
  the correction is the more useful record: the emit went in near the end of the function, and the
  DAILY/WEEKLY branch returns roughly three hundred lines before it — so every recurring completion,
  which is the lane `/missions` routes habits through, still emitted nothing. The test that
  "proved" it asserted the string `kind: "completed"` appeared between two function declarations,
  which is true whether or not the line is reachable. It was green over a live blind spot. It is now
  a behavioural test that drives `checkTask` and asserts on the emit; deleting the recurring emit
  turns it red.
- Wiring that emit also revealed that the voice route already emitted the same event immediately
  after calling `checkTask`, under a comment reading "checkTask does not emit a TaskEvent itself" —
  true when written, falsified by this change. The two payloads differ, so the 60-second idempotency
  key would not have collided and every voice completion would have written **two** rows into a table
  that `getDoneTodayCount()` counts. Fixing a silent instrument nearly produced a double-counting one.
- The completion mutation logs its own failures — a 4xx at `warn`, anything else at `error`, so
  operator typos do not train the reader to ignore the channel.
- The swallowed reality-gap writeback still swallows (it must never break a completion, and
  verifiably cannot — there is no transaction in that file) but now also lands somewhere queryable.
- Each is canaried, and each canary mutation-fires: remove the emit, the logging, or the queryable
  write, and the suite goes red naming the specific loss.

### The month-old error underneath it

The actual thrown error was `42P01 relation "drift_alerts" does not exist` — **first seen a month
earlier, 814 occurrences, nobody investigating.** Two un-typechecked raw queries outlived the Prisma
model they read; the feature itself had migrated to BrainMemory-backed storage, and the table was
dropped without pruning its readers. `safeQuery` swallows only quota errors, so this failed the entire
hub payload rather than degrading one sub-rollup.

It went uninvestigated for a month because the operator-facing copy classified it as **"Database
hiccup · try again in a moment"** — the transient branch matched on the word `prisma`. A missing
relation is structural: retrying can never fix it. Structural errors are now classified before
transient ones and say so plainly, because error copy that calls a broken schema "flaky" is an
instrument that misreports its own reading.

---

## Known landmines — armed, disclosed, not defused

Things a canary now detects but that nobody has fixed. Each names its trigger condition, because a
hazard described only as "we should clean that up" gets cleaned up by someone who does not know what
it was guarding.

### `autonomous-action.auto_score_applicant` — a live `auto` policy for an automation that does not exist

There is an enabled AutomationPolicy row with `approvalClass: "auto"` whose `name` matches **no rule
in `RULES`**, and whose declared trigger `/api/webhooks/applicant` is **not a route** — `app/api/webhooks/`
contains only `inbound-crm`, `make`, `nickstire` and `stripe`.

**Trigger condition, spelled out.** The day someone implements a rule named `auto_score_applicant`:

1. The derived baseline in `lib/automation/derive-rule-policies.ts` would give it `"pending"`.
2. The curated entry in `scripts/seed-policies.ts` is spread **last** and wins — `"auto"`.
3. On re-seed, `upsertPolicy`'s `update` block **omits `approvalClass`**, so the existing `auto` row
   survives untouched.

The rule is born **armed**, unattended, with no operator decision anywhere in the loop — and every
existing test stays green, because completeness runs one way (every rule has a policy) and nothing
asserted the inverse (every curated policy names a real rule).

**Status:** the inverse direction is now asserted in `derive-rule-policies.test.ts`, with this id in a
named `KNOWN_ORPHAN_POLICY_IDS` allowlist. That stops NEW orphans; it does not defuse this one.
Defusing it means deleting or disabling a production row — a protected operation, operator-only.

### The witnessed-commitment resolver — dormant code that an observability fix nearly executed

`lib/brain/task-events.ts` is documented at the top as *"Append-only. Never updated, never deleted."*
It is not. When `kind === "completed"`, it loads **every** ACTIVE `WITNESSED_COMMITMENT` agenda item —
no `taskId` filter, no `take` — and sets any whose title matches the task's title, in either
direction, to `RESOLVED`. No confirmation, no undo.

**It had never run.** Measured 2026-08-23 against prod: `task_events` held zero `completed` rows ever,
and `agenda_items` held zero rows in any RESOLVED state. Wiring the first working completion emit
would have been the first execution of that code — in production, against 35 live commitments, several
of them personal.

This is the shape recorded in `statenour-publish-status-arc-2026-08-03`: **repairing a no-op re-arms
every dormant path behind it.** The emit was reasoned about as a log write. It was a mutation.

Simulated read-only before anything shipped, so the decision has numbers attached: 5 matches across
110 tasks x 35 commitments, all five genuine title-identical pairs, and **zero of the five matched on
the intended `meta.taskId` link** — the fuzzy title branch does all of the work. Nothing matched a
recurring task, so nothing would fire daily today.

**Status: gated, not fixed.** The resolver is now opt-in via `resolveWitnessedCommitments` on the
event input, default false, and no caller sets it. That preserves the observed behaviour exactly — it
has never fired and still will not — while making arming it a deliberate decision rather than a side
effect of adding a log line. Whether the operator wants completions to resolve commitments, and
whether a bidirectional title `includes()` is the right matcher for that, are product questions.
A canary asserts the emit does not set the flag.

### Two disclosures carried forward, still open

- **The stale-window multiplier** in `apps/worker/src/scheduler.ts`. The FORM (a threshold expressed
  as a count of intervals) is grounded in incident.io's "missed tolerance". The multiplier itself and
  the `+ 5` minutes are judgment calls, marked as such in-code. Prometheus is explicitly named there
  as the WRONG precedent so nobody re-adds it: its primary docs use a fixed five-minute lookback
  delta, not a multiple of the scrape interval.
- **The `policyBootstrap` marker** written by the autonomous engine when a lane has no policy row has
  **no reader**. Nothing queries it, nothing surfaces it, no test covers it. The real protection is
  the coverage gate now wired into `verify:hard`; the marker is belt-and-braces that nobody has
  buckled. Surface it in the approvals UI or delete it.

---

## Instance twelve — this document

**The rule caught its own defining document.**

This file argues that no control ships without a canary. It shipped carrying roughly fifteen
hand-written derived numbers — check counts, test counts, chain-link counts, line counts, a coverage
ratio — and **nothing checked any of them.** By the taxonomy in [proven ≠ connected](#proven-is-not-connected)
it was an unproven control: a claim nobody verifies is a claim that rots.

It rotted immediately, and in the most ordinary way available. Every fix made while writing the PR
invalidated a number written earlier in the same PR. The check count moved **123 → 131 → 133 → 135** as
assertions were added, and the prose kept whichever value happened to be true when the sentence was
typed. A third adversarial review found six such numbers by hand. A fourth would have found more,
because the fixes for the third invalidated others — an unbounded proofreading loop, doing by hand the
one job a gate does perfectly.

**The fix is the thesis applied to itself.** `scripts/agent-os/coverage-doc.test.mjs` recomputes every
derived number from the command or source that produces it and fails when this prose disagrees. It is
itself canaried in three directions: corrupt one number and the audit must name it; break the table's
arithmetic and it must fail; and **delete a claim rather than correct it** and it must still fail —
otherwise the cheapest way to fix a wrong number would be to remove it.

That last case is the one worth copying. A number-checking gate that only compares present numbers
teaches people to delete numbers.

---

## The irony, recorded

**This system asked for this rule about itself.** Its 2026-08-22 brief recommended *"a health-check
heartbeat to every external feed so a zero-result cycle auto-pages"* — a canary, derived independently,
by the same brief that ten cycles running could not be read. Fixing its self-awareness gaps and
shipping the canary rule are the same project.

---

## Writing one

Copy the shape from any of the three proven controls:

1. **Copy the real inputs** to a throwaway location — never mutate the repo's own files.
2. **Break exactly one thing.** One canary, one defect; a canary that breaks two things cannot tell you
   which assertion caught it.
3. **Assert the message, not just the exit code** — otherwise an unrelated failure masquerades as your
   canary passing. (This bit two of the adapter canaries on first run: the denial prints the
   regex *source*, not the human phrasing.)
4. **Add the positive control.** Assert an unbroken copy still passes.
5. If the control is not reachable from a test, **make it reachable** — `check-adapters.mjs` needed an
   `AGENT_OS_ROOT` override before it could be pointed at a fixture at all. That change is part of the
   canary, not a prerequisite for it.

## Regenerating

```bash
node scripts/agent-os/check-adapters.mjs            # prints its own check count
node --test scripts/agent-os/adapters.test.mjs      # the adapter canaries
pnpm agent:verify                                   # both canary suites + parity
```

Per-chain link counts come from `apps/<app>/package.json` (`verify:hard`, `verify`) and `lefthook.yml`.
